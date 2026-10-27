import { useCallback, useEffect, useMemo, useState } from "react";
import { dashboardsApi } from "@/modules/dashboards/api/dashboards.api";
import type { DashboardFilterValues } from "@/modules/dashboards/model/types";
import type {
  DashboardPreviewItem,
  DashboardPreviewQuery,
} from "@/modules/ai/model/chat-items";

export function useDashboardPreview(
  item: DashboardPreviewItem,
  busy: boolean,
  isLatestInteraction: boolean,
) {
  const [acknowledgedLimit, setAcknowledgedLimit] = useState(false);
  const [expired, setExpired] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [testedQueries, setTestedQueries] =
    useState<Record<string, DashboardPreviewQuery>>();
  const [testedIssues, setTestedIssues] = useState<string[]>();
  const [testingPreview, setTestingPreview] = useState(false);
  const [previewTestError, setPreviewTestError] = useState<string>();
  const initialPreviewFilters = useMemo<DashboardFilterValues>(
    () => item.contextValues ?? {},
    [item.contextValues],
  );
  const previewComponentIds = useMemo(
    () => new Set(item.previewComponentIds),
    [item.previewComponentIds],
  );
  const previewComponents = useMemo(
    () =>
      item.definition.components.filter((component) =>
        previewComponentIds.has(component.id),
      ),
    [item.definition.components, previewComponentIds],
  );
  const previewQueryIds = useMemo(
    () => new Set(previewComponents.map((component) => component.queryUuid)),
    [previewComponents],
  );
  const previewArgumentNames = useMemo(
    () =>
      new Set(
        item.definition.queryBindings
          .filter((binding) => previewQueryIds.has(binding.queryUuid))
          .flatMap((binding) =>
            Object.values(binding.parameters).flatMap((source) =>
              source.source === "context" ? [source.argument] : [],
            ),
          ),
      ),
    [item.definition.queryBindings, previewQueryIds],
  );
  const requiredArguments = useMemo(
    () =>
      item.definition.workspace.params.filter(
        (parameter) =>
          parameter.required && previewArgumentNames.has(parameter.name),
      ),
    [item.definition.workspace.params, previewArgumentNames],
  );
  const initialPreviewTruncated = Object.values(item.queries).some(
    (query) => query.truncated,
  );

  // reseta ao trocar de proposta/expiracao
  const resetKey = `${item.id}|${item.expiresAt}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setAcknowledgedLimit(false);
    setTestedQueries(undefined);
    setTestedIssues(undefined);
    setPreviewTestError(undefined);
    setExpired(false);
  }

  useEffect(() => {
    const remaining = new Date(item.expiresAt).getTime() - Date.now();
    const timer = window.setTimeout(
      () => setExpired(true),
      Math.max(remaining, 0),
    );
    return () => window.clearTimeout(timer);
  }, [item.id, item.expiresAt]);

  // previewOpen: abre ao mudar proposta/componentes; fecha se nao e a ultima interacao ou se salvou
  const [prevOpenDeps, setPrevOpenDeps] = useState<{
    id: string;
    previewComponents: typeof previewComponents;
    isLatestInteraction: boolean;
    saved?: boolean;
  }>();
  if (
    !prevOpenDeps ||
    prevOpenDeps.id !== item.id ||
    prevOpenDeps.previewComponents !== previewComponents ||
    prevOpenDeps.isLatestInteraction !== isLatestInteraction ||
    prevOpenDeps.saved !== item.saved
  ) {
    const reopen =
      !prevOpenDeps ||
      prevOpenDeps.id !== item.id ||
      prevOpenDeps.previewComponents !== previewComponents;
    setPrevOpenDeps({
      id: item.id,
      previewComponents,
      isLatestInteraction,
      saved: item.saved,
    });
    if (reopen) setPreviewOpen(previewComponents.length > 0);
    if (!isLatestInteraction || item.saved) setPreviewOpen(false);
  }

  const componentTitles = previewComponents.map((component) => component.title);
  const componentChangeSummary = item.changeSummary.find((summary) =>
    summary.startsWith("Componentes:"),
  );
  const queryCount = previewQueryIds.size;
  const pendingPreviewCount = Object.values(item.queries).filter(
    (query) => query.previewPending,
  ).length;
  const failedPreviewCount = Object.values(item.queries).filter(
    (query) => query.error,
  ).length;
  const runPreviewTest = async (values: DashboardFilterValues) => {
    if (testingPreview || busy || expired || item.stale) return;
    const contextValues = requiredArguments.reduce<
      Record<string, string | string[]>
    >((result, parameter) => {
      const value = values[parameter.name];
      if (value === undefined) return result;
      if (Array.isArray(value)) {
        if (value.length > 0) result[parameter.name] = value;
        return result;
      }
      if (value.trim()) result[parameter.name] = value;
      return result;
    }, {});
    setTestingPreview(true);
    setPreviewTestError(undefined);
    setTestedIssues(undefined);
    try {
      const result = await dashboardsApi.previewAiDashboardProposal(
        item.proposalId,
        contextValues,
        item.previewComponentIds,
      );
      setTestedQueries(result.queries);
      setTestedIssues(result.issues);
    } catch (error) {
      setPreviewTestError(
        error instanceof Error
          ? error.message
          : "Não foi possível testar os componentes.",
      );
    } finally {
      setTestingPreview(false);
    }
  };
  const onPreviewValuesChange = useCallback(() => {
    setTestedQueries(undefined);
    setTestedIssues(undefined);
    setPreviewTestError(undefined);
    setAcknowledgedLimit(false);
  }, []);
  const previewQueries = testedQueries ?? item.queries;
  const previewLookupData = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(previewQueries).map(([queryId, query]) => [
          queryId,
          { loading: false, ...query },
        ]),
      ),
    [previewQueries],
  );
  const truncated =
    initialPreviewTruncated ||
    Object.values(previewQueries).some((query) => query.truncated);
  const truncationDetails = [
    ...Object.entries(item.queries)
      .filter(([, query]) => query.truncated)
      .map(([queryId, query]) => ({
        label: "Amostra original",
        queryId,
        query,
      })),
    ...Object.entries(testedQueries ?? {})
      .filter(([, query]) => query.truncated)
      .map(([queryId, query]) => ({ label: "Teste atual", queryId, query })),
  ];
  const interactiveTestFailed = Boolean(
    testedQueries &&
    (Object.values(testedQueries).some(
      (query) => query.error || query.previewPending,
    ) ||
      (testedIssues?.length ?? 0) > 0),
  );
  const unavailable =
    !isLatestInteraction ||
    !item.canCommit ||
    item.saved ||
    item.stale ||
    item.saving ||
    expired ||
    (pendingPreviewCount > 0 && !testedQueries) ||
    interactiveTestFailed ||
    (truncated && !acknowledgedLimit) ||
    busy;

  return {
    acknowledgedLimit,
    setAcknowledgedLimit,
    expired,
    previewOpen,
    setPreviewOpen,
    testedQueries,
    testedIssues,
    testingPreview,
    previewTestError,
    initialPreviewFilters,
    previewComponents,
    requiredArguments,
    componentTitles,
    componentChangeSummary,
    queryCount,
    pendingPreviewCount,
    failedPreviewCount,
    runPreviewTest,
    onPreviewValuesChange,
    previewQueries,
    previewLookupData,
    truncated,
    truncationDetails,
    interactiveTestFailed,
    unavailable,
  };
}
