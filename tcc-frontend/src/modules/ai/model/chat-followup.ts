function normalizedText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const followUpActionPattern =
  /\b(adicion\w*|inclu\w*|coloc\w*|us\w*|aplic\w*|salv\w*|cria\w*|mont\w*|implement\w*)\b/;

export function shouldResurfaceQueryPreview(
  content: string,
  queryName: string,
) {
  const normalizedContent = normalizedText(content);
  if (shouldSendPendingPreviewContext(content)) return true;
  if (!followUpActionPattern.test(normalizedContent)) return false;
  const normalizedName = normalizedText(queryName.trim());
  if (normalizedName.length > 2 && normalizedContent.includes(normalizedName))
    return true;
  const refersToQueryOrDashboard =
    /\b(query|consulta|tabela|dashboard|painel|componente|filtros?|grafico)\b/.test(
      normalizedContent,
    ) ||
    /\b(essa|esta|dessa|desta|isso|ela|implementar|implemente)\b/.test(
      normalizedContent,
    );
  return refersToQueryOrDashboard;
}

export function shouldSendPendingPreviewContext(content: string) {
  const normalizedContent = normalizedText(content);
  const dashboardAddRequest =
    /\b(dashboard|painel)\b/.test(normalizedContent) &&
    /\b(adicion\w*|inclu\w*|coloc\w*|inser\w*|vincul\w*|acrescent\w*)\b/.test(
      normalizedContent,
    );
  const positionedMetricRequest =
    /\b(adicion\w*|inclu\w*|coloc\w*|inser\w*|cria\w*)\b/.test(
      normalizedContent,
    ) &&
    /\b(ao lado(?: direito| esquerdo)?|a direita|a esquerda|acima|abaixo)\b/.test(
      normalizedContent,
    ) &&
    /\b(somatoria|soma|total|quantidade|indicador|metrica|kpi)\b/.test(
      normalizedContent,
    );
  const queryReviewRequest =
    /\b(query|consulta)\b/.test(normalizedContent) &&
    /\b(revis\w*|salv\w*|aprova\w*|testa\w*)\b/.test(normalizedContent);
  const questionnaireAnswer = /\brespostas ao formulario\b/.test(
    normalizedContent,
  );
  const periodChoice = /\b(fix[oa]|dinamic\w*|acompanhar|manter)\b/.test(
    normalizedContent,
  );
  const proposalStatusFollowUp =
    /^[?!.…\s]+$/.test(normalizedContent) ||
    (/\b(aplicar|visualizar|proposta|previ\w*|cartao|botao)\b/.test(
      normalizedContent,
    ) &&
      /\b(nao|tem|cad[e]|onde|aparece|apareceu|sumiu)\b/.test(
        normalizedContent,
      ));
  return (
    dashboardAddRequest ||
    positionedMetricRequest ||
    queryReviewRequest ||
    questionnaireAnswer ||
    periodChoice ||
    proposalStatusFollowUp
  );
}

function normalizePreviewText(value: string) {
  return normalizedText(value).replace(/\s+/g, " ").trim();
}

export function choseDynamicPeriod(content: string) {
  const normalizedContent = normalizePreviewText(content);
  return /\b(dinamic\w*|acompanhar|seguir os filtros|conforme os filtros)\b/.test(
    normalizedContent,
  );
}

export function previewUsesDateParameters(preview: {
  sqlText: string;
  parameters: Array<{ name: string; type: string }>;
}) {
  const dateParameters = preview.parameters.filter(
    (parameter) => parameter.type === "date",
  );
  if (dateParameters.length === 0) return false;

  const usedDateParameters = dateParameters.filter((parameter) => {
    const escapedName = parameter.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\{\\{\\s*${escapedName}\\s*\\}\\}`).test(
      preview.sqlText,
    );
  });
  return usedDateParameters.length === dateParameters.length;
}

export function shouldInvalidateForDynamicPeriod(
  content: string,
  preview: {
    sqlText: string;
    parameters: Array<{ name: string; type: string }>;
  },
) {
  return choseDynamicPeriod(content) && !previewUsesDateParameters(preview);
}

type QueryPreviewState = {
  id: string;
  kind: string;
  stale?: boolean;
  savedQueryId?: string;
  savedQueryName?: string;
  testRunId?: string;
};

export function movePendingQueryPreviewToEnd<T extends QueryPreviewState>(
  items: T[],
  previewId: string,
): T[] {
  const index = items.findIndex(
    (item) => item.id === previewId && item.kind === "query_preview",
  );
  if (index < 0) return items;
  const preview = items[index];
  if (!preview || preview.stale || preview.savedQueryId) return items;
  return [...items.slice(0, index), ...items.slice(index + 1), preview];
}

export function markQueryPreviewSavedOnce<T extends QueryPreviewState>(
  items: T[],
  testRunId: string,
  queryId: string,
  queryName: string,
  fallback: T,
): T[] {
  let lastMatchingIndex = -1;
  items.forEach((item, index) => {
    if (item.kind === "query_preview" && item.testRunId === testRunId)
      lastMatchingIndex = index;
  });
  if (lastMatchingIndex < 0) return [...items, fallback];
  return items.flatMap((item, index) => {
    if (item.kind !== "query_preview" || item.testRunId !== testRunId)
      return [item];
    return index === lastMatchingIndex
      ? [
          {
            ...item,
            savedQueryId: queryId,
            savedQueryName: queryName,
            stale: false,
          } as T,
        ]
      : [];
  });
}
