import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { api, ApiError } from "@/api";
import {
  Bot,
  Check,
  CircleAlert,
  Eye,
  LoaderCircle,
  PanelRightClose,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  choseDynamicPeriod,
  previewUsesDateParameters,
  shouldInvalidateForDynamicPeriod,
  markQueryPreviewSavedOnce,
  shouldResurfaceQueryPreview,
  shouldSendPendingPreviewContext,
} from "@/components/ai/chat-followup";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  Message,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { useCurrentViewRefresh } from "@/context/CurrentViewRefreshContext";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import type { AiContextProposal, QueryPreview } from "@/types";
import type { DashboardDefinition, DashboardDocument } from "@/types";
import {
  DashboardFilters,
  DashboardProposalCanvas,
  type DashboardFilterValues,
} from "@/dashboard";
import { readChatStream, type ChatEvent } from "./chat-sse";
import {
  QuestionnaireCard,
  type QuestionnaireAnswers,
  type QuestionnaireChatItem,
} from "./QuestionnaireCard";

const ChatMarkdown = lazy(() =>
  import("./ChatMarkdown").then((module) => ({ default: module.ChatMarkdown })),
);

type ChatMessage = {
  id: string;
  kind: "message";
  role: "user" | "assistant";
  content: string;
  status: "complete" | "streaming" | "stopped" | "error";
  actionCard?: ChatActionCardRef;
};

type ChatActionCardKind =
  | "proposal"
  | "context_proposal"
  | "query_preview"
  | "dashboard_preview"
  | "questionnaire";
type ChatActionCardRef = { id: string; kind: ChatActionCardKind };

type ToolMessage = {
  id: string;
  kind: "tool";
  toolName: string;
  status: "running" | "success" | "failed";
};

type ProposalMessage = {
  id: string;
  kind: "proposal";
  title: string;
  summary: string;
  ownerMessageId?: string;
};
type ContextProposalMessage = {
  id: string;
  kind: "context_proposal";
  proposal: AiContextProposal;
  ownerMessageId?: string;
};

type ErrorMessage = {
  id: string;
  kind: "error";
  message: string;
  assistantId: string;
  retryable: boolean;
};
type QueryPreviewItem = QueryPreview & {
  id: string;
  kind: "query_preview";
  savedQueryId?: string;
  savedQueryName?: string;
  stale?: boolean;
  staleReason?: "dynamic_period_mismatch";
  ownerMessageId?: string;
};
type DashboardPreviewQuery = {
  rows: Record<string, unknown>[];
  rowLimit: number;
  byteLimit: number;
  bytes: number;
  truncated: boolean;
  truncationReason: "row_limit" | "byte_limit" | null;
  error?: string;
  previewPending?: string;
};
type DashboardPreviewItem = {
  id: string;
  kind: "dashboard_preview";
  toolCallId: string;
  proposalId: string;
  previewComponentIds: string[];
  expiresAt: string;
  canCommit: boolean;
  issues: string[];
  mode: "create" | "update";
  dashboardId: string;
  expectedDashboardFingerprint: string | null;
  document: DashboardDocument;
  definition: DashboardDefinition;
  changeSummary: string[];
  componentChanges: Record<string, "added" | "modified" | "unchanged">;
  requiresTruncationAcknowledgement: boolean;
  queries: Record<string, DashboardPreviewQuery>;
  saved?: boolean;
  stale?: boolean;
  saving?: boolean;
  ownerMessageId?: string;
};
type ChatItem =
  | ChatMessage
  | ToolMessage
  | ProposalMessage
  | ContextProposalMessage
  | ErrorMessage
  | QueryPreviewItem
  | DashboardPreviewItem
  | QuestionnaireChatItem;
type ChatActionCardItem =
  | ProposalMessage
  | ContextProposalMessage
  | QueryPreviewItem
  | DashboardPreviewItem
  | QuestionnaireChatItem;
type ChatRoleMessage = { role: "user" | "assistant"; content: string };

function getActionCardReference(item: ChatItem): ChatActionCardRef | undefined {
  switch (item.kind) {
    case "proposal":
    case "context_proposal":
    case "query_preview":
    case "dashboard_preview":
    case "questionnaire":
      return { id: item.id, kind: item.kind };
    default:
      return undefined;
  }
}

function withActionCardOwner(
  item: ChatActionCardItem,
  ownerMessageId: string,
): ChatActionCardItem {
  return { ...item, ownerMessageId };
}

function isActionCardItem(item: ChatItem): item is ChatActionCardItem {
  return getActionCardReference(item) !== undefined;
}

function normalizeQueryPreviewName(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

type AiContinuation =
  | { type: "query_saved"; queryId: string; queryName: string }
  | {
      type: "dashboard_saved";
      dashboardId: string;
      dashboardName: string;
      mode: "create" | "update";
    };
type AiPageContext = {
  pathname: string;
  dashboardId?: string;
  dashboardName?: string;
};
type SavedQueryReference = { id: string; name: string };
type SendOptions = {
  content?: string;
  retry?: boolean;
  silentUser?: boolean;
  continuation?: AiContinuation;
  pageContext?: AiPageContext;
  savedQueryContext?: SavedQueryReference;
};

const MAX_MESSAGE_CHARACTERS = 8_000;
const MAX_HISTORY_MESSAGES = 30;
const MAX_HISTORY_CHARACTERS = 32_000;
const MIN_AI_CHAT_WIDTH = 320;
const MAX_AI_CHAT_WIDTH = 680;
const DEFAULT_AI_CHAT_WIDTH = 448;
const REFRESH_TOOL_NAME = "refresh_current_view";
const DASHBOARD_ID_PATTERN =
  /^\/(?:dashboards|admin\/dashboards)\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/|$)/i;

function newId() {
  return crypto.randomUUID();
}

function pageContextForPath(pathname: string) {
  const match = DASHBOARD_ID_PATTERN.exec(pathname);
  return {
    pathname,
    ...(match ? { dashboardId: match[1] } : {}),
  };
}

function hasPendingDashboardComponentRequest(items: ChatItem[], pathname: string) {
  const userMessages = items.filter(
    (item): item is ChatMessage => item.kind === "message" && item.role === "user",
  );
  const latest = userMessages.at(-1)?.content ?? "";
  const normalizedLatest = latest
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const isQuestionnaireAnswer = /\b(respostas? ao formulario|respostas enviadas)\b/.test(normalizedLatest);
  const text = [
    ...(isQuestionnaireAnswer ? [userMessages.at(-2)?.content ?? ""] : []),
    latest,
  ].join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const asksForAction = /\b(adicionar|adicione|adiciona|inclui|inclua|incluir|criar|crie|montar|monte|colocar|coloque|inserir|insira|gerar|gere|faca|fazer)\b/.test(text);
  const asksForComponent = /\b(graficos?|dashboards?|paineis|componentes?|tabelas?|indicadores?|metricas?|kpis?)\b/.test(text);
  const requestsComponent = /\b(quero|preciso)\b/.test(text) && asksForComponent;
  const placementInstruction = /\b(ao lado(?: direito| esquerdo)?|a direita|a esquerda|acima|abaixo|antes|depois|apos)\b/.test(text);
  const metricDescription = /\b(somatoria|soma|total|quantidade|indicador|metrica|kpi)\b/.test(text);
  const dashboardContext = DASHBOARD_ID_PATTERN.test(pathname);
  const isConcreteVisualizationRequest = (requestText: string) => {
    const normalizedRequest = requestText
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return /\b(graficos?|tabelas?|indicadores?|metricas?|kpis?)\b/.test(normalizedRequest)
      && /\b(top\s*\d+|maiores?|menores?|por\s+(?:venda|faturamento|categoria|estado|cidade)|venda|faturamento)\b/.test(normalizedRequest);
  };
  const recentConcreteVisualization = userMessages.slice(-6, -1).some(
    (message) => isConcreteVisualizationRequest(message.content),
  );
  const confirmsImplementation = /\b(pode|poderia|vamos|sim)\b.{0,32}\b(implementar|implemente|adicionar|incluir|montar|criar)\b/.test(normalizedLatest)
    && recentConcreteVisualization;
  const isDashboardRequest = (requestText: string) => {
    const normalizedRequest = requestText
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    const action = /\b(adicionar|adicione|adiciona|inclui|inclua|incluir|criar|crie|montar|monte|colocar|coloque|inserir|insira|gerar|gere|faca|fazer)\b/.test(normalizedRequest);
    const component = /\b(graficos?|dashboards?|paineis|componentes?|tabelas?|indicadores?|metricas?|kpis?)\b/.test(normalizedRequest);
    const wantsComponent = /\b(quero|preciso)\b/.test(normalizedRequest) && component;
    const positionedMetric = /\b(ao lado(?: direito| esquerdo)?|a direita|a esquerda|acima|abaixo|antes|depois|apos)\b/.test(normalizedRequest)
      && /\b(somatoria|soma|total|quantidade|indicador|metrica|kpi)\b/.test(normalizedRequest);
    return (action && component)
      || wantsComponent
      || (action && positionedMetric)
      || isConcreteVisualizationRequest(requestText);
  };
  const isDirectDashboardRequest = (asksForAction && asksForComponent)
    || requestsComponent
    || (asksForAction && placementInstruction && (metricDescription || dashboardContext));
  if (isDirectDashboardRequest || isDashboardRequest(text) || confirmsImplementation) return true;
  const latestIsStatusFollowUp = /^[?!.…\s]+$/.test(normalizedLatest)
    || (/\b(aplicar|visualizar|proposta|previ\w*|cartao|botao)\b/.test(normalizedLatest)
      && /\b(nao|tem|cade|onde|aparece|apareceu|sumiu)\b/.test(normalizedLatest));
  return (latestIsStatusFollowUp && userMessages.slice(-5, -1).some(
    (message) => isDashboardRequest(message.content),
  )) || (isQuestionnaireAnswer && recentConcreteVisualization);
}

function completedConversation(
  items: ChatItem[],
  limits: { reserveMessages?: number; reserveCharacters?: number } = {},
): ChatRoleMessage[] {
  const available = items.flatMap((item) =>
    item.kind === "message" && item.status === "complete" && item.content.trim()
      ? [{ role: item.role, content: item.content }]
      : [],
  );

  const bounded: ChatRoleMessage[] = [];
  let characters = 0;
  const maxMessages = Math.max(
    0,
    MAX_HISTORY_MESSAGES - (limits.reserveMessages ?? 0),
  );
  const maxCharacters = Math.max(
    0,
    MAX_HISTORY_CHARACTERS - (limits.reserveCharacters ?? 0),
  );
  const recentMessages = maxMessages === 0 ? [] : available.slice(-maxMessages);
  for (const message of recentMessages.reverse()) {
    const content = message.content.slice(-MAX_MESSAGE_CHARACTERS);
    if (characters + content.length > maxCharacters) break;
    bounded.push({ role: message.role, content });
    characters += content.length;
  }
  return bounded.reverse();
}

function toolLabel(toolName: string) {
  const labels: Record<string, string> = {
    list_data_sources: "Consultando servidores",
    list_data_source_tables: "Listando tabelas disponíveis",
    get_data_source_table_schema: "Lendo colunas e contexto da tabela",
    analyze_date_coverage: "Analisando cobertura de datas",
    analyze_column_values: "Analisando valores dos dados",
    get_current_context: "Lendo contexto da tela",
    test_query: "Testando consulta",
    save_query: "Salvando consulta",
    propose_context_update: "Preparando proposta de contexto",
    create_or_update_dashboard: "Atualizando dashboard",
    [REFRESH_TOOL_NAME]: "Atualizando componentes do dashboard",
  };
  return labels[toolName] ?? `Executando ${toolName}`;
}

function formatElapsedTime(elapsedMs: number) {
  const seconds = Math.floor(elapsedMs / 1_000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function DashboardPreviewCard({
  item,
  busy,
  isLatestInteraction,
  onApply,
}: {
  item: DashboardPreviewItem;
  busy: boolean;
  isLatestInteraction: boolean;
  onApply: (acknowledgeTruncation: boolean) => void;
}) {
  const [acknowledgedLimit, setAcknowledgedLimit] = useState(false);
  const [expired, setExpired] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [testedQueries, setTestedQueries] =
    useState<Record<string, DashboardPreviewQuery>>();
  const [testedIssues, setTestedIssues] = useState<string[]>();
  const [testingPreview, setTestingPreview] = useState(false);
  const [previewTestError, setPreviewTestError] = useState<string>();
  const emptyPreviewFilters = useMemo<DashboardFilterValues>(() => ({}), []);
  const previewComponentIds = useMemo(
    () => new Set(item.previewComponentIds),
    [item.previewComponentIds],
  );
  const previewComponents = useMemo(
    () => item.definition.components.filter((component) => previewComponentIds.has(component.id)),
    [item.definition.components, previewComponentIds],
  );
  const previewQueryIds = useMemo(
    () => new Set(previewComponents.map((component) => component.queryUuid)),
    [previewComponents],
  );
  const previewArgumentNames = useMemo(
    () => new Set(
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
    () => item.definition.workspace.params.filter(
      (parameter) => parameter.required && previewArgumentNames.has(parameter.name),
    ),
    [item.definition.workspace.params, previewArgumentNames],
  );
  const initialPreviewTruncated = Object.values(item.queries).some(
    (query) => query.truncated,
  );

  useEffect(() => {
    setAcknowledgedLimit(false);
    setTestedQueries(undefined);
    setTestedIssues(undefined);
    setPreviewTestError(undefined);
    const remaining = new Date(item.expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      setExpired(true);
      return;
    }
    setExpired(false);
    const timer = window.setTimeout(() => setExpired(true), remaining);
    return () => window.clearTimeout(timer);
  }, [item.id, item.expiresAt]);

  useEffect(() => {
    setPreviewOpen(previewComponents.length > 0);
  }, [item.id, previewComponents]);

  useEffect(() => {
    if (!isLatestInteraction) setPreviewOpen(false);
  }, [isLatestInteraction]);

  useEffect(() => {
    if (item.saved) setPreviewOpen(false);
  }, [item.saved]);

  const componentTitles = previewComponents.map(
    (component) => component.title,
  );
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
    const contextValues = requiredArguments.reduce<Record<string, string | string[]>>(
      (result, parameter) => {
        const value = values[parameter.name];
        if (value === undefined) return result;
        if (Array.isArray(value)) {
          if (value.length > 0) result[parameter.name] = value;
          return result;
        }
        if (value.trim()) result[parameter.name] = value;
        return result;
      },
      {},
    );
    setTestingPreview(true);
    setPreviewTestError(undefined);
    setTestedIssues(undefined);
    try {
      const result = await api.previewAiDashboardProposal(
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
    () => Object.fromEntries(
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
    testedQueries && (
      Object.values(testedQueries).some((query) => query.error || query.previewPending) ||
      (testedIssues?.length ?? 0) > 0
    ),
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
  return (
    <>
      <section className="@container mx-3 flex min-w-0 flex-col gap-3 border border-primary/30 bg-primary/5 p-3 text-sm sm:mx-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              {item.mode === "create"
                ? "Prévia de novo dashboard"
                : "Proposta de alterações"}
            </p>
            <h3 className="mt-1 break-words text-base font-semibold">
              {item.document.name}
            </h3>
            {componentTitles.length > 0 && (
              <p className="mt-1 break-words text-xs font-medium">
                {componentTitles.join(" · ")}
              </p>
            )}
            {componentTitles.length === 0 && componentChangeSummary && (
              <p className="mt-1 break-words text-xs font-medium">
                {componentChangeSummary}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {componentTitles.length > 0
                ? `${componentTitles.length} componentes na prévia · ${queryCount} queries`
                : "Nenhuma prévia de dados necessária"}
              {failedPreviewCount > 0 &&
                ` · ${failedPreviewCount} falhas na prévia`}
              {pendingPreviewCount > 0 &&
                ` · ${pendingPreviewCount} aguardando filtros`}
            </p>
          </div>
          {isLatestInteraction && !item.saved && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setPreviewOpen(true)}
            >
              <Eye />
              Visualizar
            </Button>
          )}
        </div>

        {item.changeSummary.length > 0 && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {item.changeSummary.join(" ")}
          </p>
        )}
        {item.issues.length > 0 && (
          <p className="text-xs text-destructive">
            {item.issues.length} problema(s) na prévia. {isLatestInteraction
              ? "Abra Visualizar para revisar antes de ajustar."
              : "Peça uma nova proposta para revisar e ajustar."}
          </p>
        )}
        {testedIssues && testedIssues.length > 0 && (
          <p role="alert" className="text-xs text-destructive">
            Teste da prévia encontrou problemas; corrija a proposta antes de
            aplicar.
          </p>
        )}
        {pendingPreviewCount > 0 && !testedQueries && (
          <p className="text-xs text-muted-foreground">
            Preencha os filtros obrigatórios e teste os componentes antes de
            aplicar as alterações.
          </p>
        )}

        {truncated && (
          <Label className="flex min-w-0 items-start gap-2 border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
            <Checkbox
              className="shrink-0"
              checked={acknowledgedLimit}
              onCheckedChange={(checked) =>
                setAcknowledgedLimit(checked === true)
              }
            />
            <span className="min-w-0 break-words">
              A amostra está limitada. Revise os detalhes no modo de
              visualização antes de confirmar.
            </span>
          </Label>
        )}

        <footer className="flex min-w-0 flex-col gap-2 border-t border-primary/15 pt-3 @md:flex-row @md:items-center @md:justify-between">
          {item.saved ? (
            <span className="min-w-0 text-xs text-emerald-700 dark:text-emerald-400">
              Dashboard salvo.
            </span>
          ) : item.stale || expired ? (
            <span className="min-w-0 text-xs text-muted-foreground">
              Prévia expirada ou desatualizada. Gere uma nova proposta.
            </span>
          ) : (
            <span className="min-w-0 text-xs text-muted-foreground">
              Nenhuma alteração é aplicada antes de confirmar.
            </span>
          )}
          {!item.saved && isLatestInteraction && (
            <Button
              size="sm"
              className="w-full @md:w-auto @md:shrink-0"
              disabled={unavailable}
              onClick={() => onApply(acknowledgedLimit)}
            >
              {item.saving
                ? "Salvando…"
                : item.mode === "create"
                  ? "Criar dashboard"
                  : `Aplicar alterações em ${item.document.name}`}
            </Button>
          )}
        </footer>
      </section>

      <Dialog
        open={previewOpen && !item.saved && isLatestInteraction}
        onOpenChange={setPreviewOpen}
      >
        <DialogContent className="flex h-[86dvh] max-h-[90dvh] w-[calc(100%-1rem)] max-w-5xl flex-col overflow-hidden p-4 sm:w-[88vw] sm:max-w-5xl sm:p-6">
          <DialogHeader className="shrink-0 border-b pb-4 pr-8 text-left">
            <DialogTitle className="text-xl">
              Prévia visual dos componentes propostos
            </DialogTitle>
            <DialogDescription>
              Teste os filtros necessários e veja como os componentes serão
              exibidos no dashboard antes de aplicar as alterações.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto py-1 pr-1">
            {previewComponents.length > 0 ? (
              <section className="space-y-3 rounded border bg-muted/20 p-3">
                <div>
                  <h3 className="text-sm font-medium">Testar filtros</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Os valores são usados apenas para executar esta amostra; não
                    alteram nem salvam filtros no dashboard.
                  </p>
                </div>
                <DashboardFilters
                  parameters={requiredArguments}
                  lookupData={previewLookupData}
                  appliedFilters={emptyPreviewFilters}
                  onApply={runPreviewTest}
                  onValuesChange={onPreviewValuesChange}
                  heading="Filtros obrigatórios"
                  description="Os valores são usados apenas para executar esta amostra; não alteram nem salvam filtros no dashboard."
                  submitLabel={testingPreview ? "Testando…" : "Testar componentes"}
                  submitIcon={testingPreview ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                  submitDisabled={testingPreview || busy || expired || item.stale}
                  showWhenEmpty
                  emptyMessage="Não há filtros obrigatórios para os componentes adicionados."
                />
                {previewTestError && (
                  <p role="alert" className="text-xs text-destructive">
                    {previewTestError}
                  </p>
                )}
                {testedIssues && testedIssues.length > 0 && (
                  <p role="alert" className="text-xs text-destructive">
                    A proposta não pode ser aplicada: {testedIssues.join(" ")}
                  </p>
                )}
                {testedQueries && !interactiveTestFailed && (
                  <p className="text-xs text-emerald-700 dark:text-emerald-400">
                    Amostra carregada para os componentes propostos. Revise
                    os resultados abaixo antes de aplicar.
                  </p>
                )}
              </section>
            ) : (
              <p className="rounded border bg-muted/20 p-3 text-sm text-muted-foreground">
                Esta proposta não adiciona componentes novos. Consulte o resumo
                das alterações abaixo.
              </p>
            )}

            {previewComponents.length > 0 && testedQueries &&
              Object.values(testedQueries).some((query) => query.error) && (
                <div
                  role="alert"
                  className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                >
                  O teste encontrou erros. Revise os valores dos filtros e tente
                  novamente.
                </div>
              )}

            {item.issues.length > 0 && (
              <div
                role="alert"
                className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                <p className="font-medium">
                  A prévia encontrou problemas que precisam de ajuste
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {item.issues.map((issue, index) => (
                    <li key={`${index}-${issue}`}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}

            {previewComponents.length > 0 && truncated && (
              <div className="border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                <p className="font-medium">Amostra limitada</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                  {truncationDetails.map(({ label, queryId, query }, index) => (
                    <li key={`${label}-${queryId}-${index}`}>
                      {label} · query {queryId.slice(0, 8)}…:{" "}
                      {query.rows.length}/{query.rowLimit} linhas ·{" "}
                      {query.bytes}/{query.byteLimit} bytes (
                      {query.truncationReason}).
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {previewComponents.length > 0 && (
              <div
                role="note"
                aria-label="Legenda das alterações dos componentes"
                className="flex flex-wrap gap-x-4 gap-y-2 border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
              >
                <span className="flex items-center gap-2">
                  <span className="size-3 border border-emerald-600/50 bg-emerald-500/10" aria-hidden="true" />
                  Verde: novo componente
                </span>
                <span className="flex items-center gap-2">
                  <span className="size-3 border border-amber-600/50 bg-amber-500/10" aria-hidden="true" />
                  Amarelo: componente modificado
                </span>
                <span className="flex items-center gap-2">
                  <span className="size-3 border border-border bg-muted" aria-hidden="true" />
                  Neutro: sem alteração
                </span>
              </div>
            )}

            {previewComponents.length > 0 && (
              <DashboardProposalCanvas
                definition={item.definition}
                rowsByQuery={previewQueries}
                componentIds={item.previewComponentIds}
                componentChanges={item.componentChanges}
              />
            )}

            <section className="space-y-2 border-t pt-4 text-sm">
              <h3 className="font-medium">Resumo das alterações</h3>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {item.changeSummary.map((change, index) => (
                  <li key={`${index}-${change}`}>{change}</li>
                ))}
              </ul>
            </section>
          </div>

          {truncated && (
            <Label className="flex shrink-0 items-start gap-2 border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
              <Checkbox
                checked={acknowledgedLimit}
                onCheckedChange={(checked) =>
                  setAcknowledgedLimit(checked === true)
                }
              />
              <span>
                Entendo que os componentes foram avaliados com uma amostra
                limitada.
              </span>
            </Label>
          )}

          <DialogFooter className="shrink-0 border-t pt-3">
            {item.saved ? (
              <span className="mr-auto text-sm text-emerald-700 dark:text-emerald-400">
                Dashboard salvo.
              </span>
            ) : item.stale || expired ? (
              <span className="mr-auto text-sm text-muted-foreground">
                Prévia expirada ou desatualizada. Gere uma nova proposta.
              </span>
            ) : (
              <span className="mr-auto text-sm text-muted-foreground">
                A proposta só será aplicada após sua confirmação.
              </span>
            )}
            {!item.saved && isLatestInteraction && (
              <Button
                disabled={unavailable}
                onClick={() => onApply(acknowledgedLimit)}
              >
                {item.saving
                  ? "Salvando…"
                  : item.mode === "create"
                    ? "Criar dashboard"
                    : "Aplicar alterações"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChatItemView({
  item,
  busy,
  isLatestInteraction,
  onRetry,
  onReviewPreview,
  onApplyDashboard,
  onReviewContext,
  onSubmitQuestionnaire,
}: {
  item: ChatItem;
  busy: boolean;
  isLatestInteraction: boolean;
  onRetry: () => void;
  onReviewPreview: (item: QueryPreviewItem) => void;
  onApplyDashboard: (
    item: DashboardPreviewItem,
    acknowledgeTruncation: boolean,
  ) => void;
  onReviewContext: (proposal: AiContextProposal) => void;
  onSubmitQuestionnaire: (
    item: QuestionnaireChatItem,
    answers: QuestionnaireAnswers,
  ) => void;
}) {
  if (item.kind === "questionnaire") {
    return (
      <QuestionnaireCard
        item={item}
        busy={busy}
        isLatestInteraction={isLatestInteraction}
        onSubmit={onSubmitQuestionnaire}
      />
    );
  }

  if (item.kind === "tool") {
    const success = item.status === "success";
    const running = item.status === "running";
    return (
      <Marker role="status" className="px-4 py-1.5 text-xs">
        <MarkerIcon>
          {running ? (
            <LoaderCircle className="animate-spin" />
          ) : success ? (
            <Check />
          ) : (
            <Wrench />
          )}
        </MarkerIcon>
        <MarkerContent className={running ? "shimmer" : undefined}>
          {toolLabel(item.toolName)}
          {running ? "…" : success ? " · concluído" : " · falhou"}
        </MarkerContent>
      </Marker>
    );
  }

  if (item.kind === "query_preview") {
    const dashboardPurpose = item.purpose === "dashboard";
    return (
      <section className="mx-3 flex min-w-0 flex-col gap-3 border border-primary/30 bg-primary/5 p-3 text-sm sm:mx-4">
        <div className="min-w-0">
          <p className="font-medium">
            {dashboardPurpose ? "Query para dashboard" : "Consulta rápida"} ·{" "}
            {item.intent.mode === "update" ? "edição" : "nova query"}
          </p>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {item.dataSource.name} · {item.savedQueryName ?? item.intent.queryName}
          </p>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {item.rowCount}/{item.rowLimit} linhas · {item.bytes}/
            {item.byteLimit} bytes
            {item.truncated
              ? ` · amostra truncada (${item.truncationReason})`
              : ""}
          </p>
          {!item.savedQueryId && !item.stale && isLatestInteraction && (
            <p className="mt-2 text-xs text-muted-foreground">
              {dashboardPurpose
                ? "Esta query é uma etapa da proposta de dashboard. Ao salvá-la, o assistente continuará essa tarefa."
                : "Esta consulta é pontual. Salvá-la adiciona a query ao catálogo sem iniciar outra tarefa automaticamente."}
            </p>
          )}
        </div>
        {item.savedQueryId ? (
          <div className="min-w-0 border-t border-primary/15 pt-2 text-xs">
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              Query salva
            </span>
            <code className="mt-1 block break-all rounded bg-background/70 px-2 py-1 text-muted-foreground">
              {item.savedQueryId}
            </code>
          </div>
        ) : item.stale ? (
          <p className="border-t border-primary/15 pt-2 text-xs text-muted-foreground">
            {item.staleReason === "dynamic_period_mismatch"
              ? "Esta prévia usa período fixo e não pode ser aprovada para acompanhar os filtros do dashboard. Aguarde uma nova prévia."
              : "Prévia substituída · teste novamente"}
          </p>
        ) : isLatestInteraction ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-fit"
            disabled={busy}
            onClick={() => onReviewPreview(item)}
          >
            {dashboardPurpose
              ? "Revisar query para dashboard"
              : "Revisar e salvar query"}
          </Button>
        ) : (
          <p className="border-t border-primary/15 pt-2 text-xs text-muted-foreground">
            Esta prévia pertence a uma mensagem anterior. Peça novamente para
            criar ou continuar a query.
          </p>
        )}
      </section>
    );
  }

  if (item.kind === "dashboard_preview") {
    return (
      <DashboardPreviewCard
        item={item}
        busy={busy}
        isLatestInteraction={isLatestInteraction}
        onApply={(acknowledgeTruncation) =>
          onApplyDashboard(item, acknowledgeTruncation)
        }
      />
    );
  }

  if (item.kind === "proposal") {
    return (
      <div className="mx-4 border border-primary/30 bg-primary/5 p-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <Sparkles className="size-4 text-primary" />
          {item.title}
        </div>
        <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
          {item.summary}
        </p>
        <p className="mt-3 border-t border-primary/15 pt-2 text-xs text-muted-foreground">
          Proposta aguardando confirmação. Nenhuma alteração foi aplicada.
        </p>
      </div>
    );
  }

  if (item.kind === "context_proposal") {
    const target =
      item.proposal.targetType === "source"
        ? item.proposal.sourceName
        : `${item.proposal.sourceName} · ${item.proposal.schemaName}.${item.proposal.tableName}`;
    const pending =
      item.proposal.status === "pending" &&
      Date.parse(item.proposal.expiresAt) > Date.now();
    const statusLabel = pending
      ? "Aguardando confirmação"
      : item.proposal.status === "approved"
        ? "Contexto aprovado"
        : item.proposal.status === "dismissed"
          ? "Proposta descartada"
          : item.proposal.status === "expired"
            ? "Proposta expirada"
            : "Proposta desatualizada";
    return (
      <div className="mx-4 border border-primary/30 bg-primary/5 p-3 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium">
              <Sparkles className="size-4 shrink-0 text-primary" />
              Proposta de contexto
            </p>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              {target}
            </p>
          </div>
          {pending && (!item.ownerMessageId || isLatestInteraction) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onReviewContext(item.proposal)}
            >
              Revisar
            </Button>
          )}
        </div>
        <p className="mt-3 border-t border-primary/15 pt-2 text-xs text-muted-foreground">
          {statusLabel}. Nenhuma alteração foi aplicada até a aprovação
          explícita.
        </p>
      </div>
    );
  }

  if (item.kind === "error") {
    return (
      <div
        role="alert"
        className="mx-4 flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
      >
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p>{item.message}</p>
          {item.retryable && (
            <Button
              variant="outline"
              size="xs"
              className="mt-2 border-destructive/30 text-destructive hover:bg-destructive/10"
              onClick={onRetry}
              disabled={busy}
            >
              <RefreshCw /> Tentar novamente
            </Button>
          )}
        </div>
      </div>
    );
  }

  const isUser = item.role === "user";
  if (!item.content.trim() && item.status === "complete" && !isUser)
    return null;
  const content = item.content;
  return (
    <Message align={isUser ? "end" : "start"} className="px-4">
      <MessageContent className="max-w-full">
        <MessageHeader className={cn(isUser && "justify-end")}>
          {isUser ? "Você" : "Assistente"}
        </MessageHeader>
        {content && (
          <Bubble
            align={isUser ? "end" : "start"}
            variant={isUser ? "default" : "muted"}
            className={isUser ? undefined : "w-full max-w-full"}
          >
            <BubbleContent>
              {isUser ? (
                content
              ) : (
                <Suspense fallback={<span>{content}</span>}>
                  <ChatMarkdown content={content} />
                </Suspense>
              )}
            </BubbleContent>
          </Bubble>
        )}
        {item.status === "stopped" && (
          <span className="px-3 text-xs text-muted-foreground">
            Geração interrompida.
          </span>
        )}
        {!isUser && item.status === "complete" && (
          <MessageFooter className="gap-1 px-3">
            <Check className="size-3" /> Concluído
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}

function ChatWindow({
  items,
  busy,
  activityProgress,
  draft,
  pageLabel,
  onDraftChange,
  onSend,
  onRetry,
  onStop,
  onClear,
  onClose,
  onPreviewSaved,
  onApplyDashboard,
  onContextProposalResolved,
  onSubmitQuestionnaire,
}: {
  items: ChatItem[];
  busy: boolean;
  activityProgress?: string;
  draft: string;
  pageLabel: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onRetry: () => void;
  onStop: () => void;
  onClear: () => void;
  onClose: () => void;
  onPreviewSaved: (
    item: QueryPreviewItem,
    queryId: string,
    queryName: string,
  ) => void;
  onApplyDashboard: (
    item: DashboardPreviewItem,
    acknowledgeTruncation: boolean,
  ) => void;
  onContextProposalResolved: (
    proposalId: string,
    status: AiContextProposal["status"],
  ) => void;
  onSubmitQuestionnaire: (
    item: QuestionnaireChatItem,
    answers: QuestionnaireAnswers,
  ) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [reviewPreview, setReviewPreview] = useState<QueryPreviewItem>();
  const [reviewName, setReviewName] = useState("");
  const [savingPreview, setSavingPreview] = useState(false);
  const [stalePreview, setStalePreview] = useState(false);
  const [reloadedQuery, setReloadedQuery] = useState<{
    name: string;
    sqlText: string;
  }>();
  const [reviewContext, setReviewContext] = useState<AiContextProposal>();
  const [resolvingContext, setResolvingContext] = useState(false);
  const savePendingRef = useRef(false);
  const { hasPermission } = useAuth();
  const refreshCurrentView = useCurrentViewRefresh();
  const latestMessage = [...items]
    .reverse()
    .find((item): item is ChatMessage => item.kind === "message");
  const isLatestInteractionItem = (item: ChatItem) => {
    if (item.kind === "message") return item.id === latestMessage?.id;
    if (!isActionCardItem(item) || !item.ownerMessageId) return false;
    const owner = items.find(
      (candidate): candidate is ChatMessage =>
        candidate.kind === "message" && candidate.id === item.ownerMessageId,
    );
    return Boolean(
      owner &&
        owner.id === latestMessage?.id &&
        owner.actionCard?.id === item.id &&
        owner.actionCard?.kind === item.kind,
    );
  };

  useEffect(() => {
    setReviewName(reviewPreview?.intent.queryName ?? "");
    setStalePreview(false);
    setReloadedQuery(undefined);
  }, [reviewPreview?.id]);

  useEffect(() => {
    if (
      reviewPreview &&
      items.some(
        (item) =>
          item.kind === "query_preview" &&
          item.testRunId === reviewPreview.testRunId &&
          item.stale,
      )
    ) {
      setStalePreview(true);
    }
  }, [items, reviewPreview]);

  useEffect(() => {
    if (!reviewPreview) return;
    const owner = items.find(
      (item): item is ChatMessage =>
        item.kind === "message" &&
        item.id === reviewPreview.ownerMessageId,
    );
    if (
      !owner ||
      owner.id !== latestMessage?.id ||
      owner.actionCard?.id !== reviewPreview.id
    ) {
      setReviewPreview(undefined);
    }
  }, [items, latestMessage?.id, reviewPreview]);

  const canSavePreview = reviewPreview
    ? reviewPreview.intent.mode === "create"
      ? hasPermission("queries:create")
      : hasPermission("queries:update")
    : false;

  const savePreview = async () => {
    if (!reviewPreview || savePendingRef.current || stalePreview) return;
    if (!canSavePreview) {
      toast.error("Você não tem permissão para salvar esta ação.");
      return;
    }
    if (reviewName.trim().length < 2) {
      toast.error("Informe um nome com pelo menos 2 caracteres.");
      return;
    }
    savePendingRef.current = true;
    setSavingPreview(true);
    try {
      const body = {
        dataSourceId: reviewPreview.dataSource.id,
        name: reviewName.trim(),
        sqlText: reviewPreview.sqlText,
        parameters: reviewPreview.parameters,
        testRunId: reviewPreview.testRunId,
      };
      const saved =
        reviewPreview.intent.mode === "update"
          ? await api.updateQuery(reviewPreview.intent.queryId!, {
              ...body,
              expectedUpdatedAt: reviewPreview.intent.queryUpdatedAt!,
            })
          : await api.createQuery(body);
      onPreviewSaved(reviewPreview, saved.id, saved.name);
      window.dispatchEvent(new Event("queries:saved"));
      toast.success(
        reviewPreview.intent.mode === "update"
          ? "Edição da query aplicada."
          : "Nova query salva.",
      );
      setReviewPreview(undefined);
    } catch (reason) {
      setStalePreview(true);
      if (
        reason instanceof ApiError &&
        reason.status === 409 &&
        reviewPreview.intent.queryId
      ) {
        try {
          const latest = await api.savedQuery(reviewPreview.intent.queryId);
          setReloadedQuery({ name: latest.name, sqlText: latest.sqlText });
        } catch {
          setReloadedQuery(undefined);
        }
        toast.error(
          "A query mudou depois do teste. Recarreguei a versão atual; peça ao assistente para testar novamente.",
        );
      } else {
        toast.error(
          reason instanceof Error
            ? reason.message
            : "Não foi possível salvar a query. Gere uma nova prévia.",
        );
      }
    } finally {
      savePendingRef.current = false;
      setSavingPreview(false);
    }
  };

  const resolveContextProposal = async (action: "approve" | "dismiss") => {
    if (
      !reviewContext ||
      resolvingContext ||
      reviewContext.status !== "pending"
    )
      return;
    setResolvingContext(true);
    try {
      const result =
        action === "approve"
          ? await api.approveAiContextProposal(reviewContext.id)
          : await api.dismissAiContextProposal(reviewContext.id);
      onContextProposalResolved(result.id, result.status);
      setReviewContext(undefined);
      if (action === "approve") {
        refreshCurrentView();
        toast.success("Contexto aprovado e atualizado.");
      } else {
        toast.success("Proposta descartada sem alterar o contexto.");
      }
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        try {
          const latest = await api.aiContextProposal(reviewContext.id);
          onContextProposalResolved(latest.id, latest.status);
          setReviewContext(latest);
        } catch {
          // Keep the comparison available so the administrator can close it.
        }
      }
      toast.error(
        reason instanceof Error
          ? reason.message
          : "Não foi possível resolver a proposta.",
      );
    } finally {
      setResolvingContext(false);
    }
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
  }, [draft]);

  const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      if (!busy && draft.trim()) onSend();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3 h-14">
        <div className="flex size-8 shrink-0 items-center justify-center border bg-primary/10 text-primary">
          <Bot className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">Assistente de IA</h2>
          <p className="truncate text-xs text-muted-foreground">{pageLabel}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClear}
          disabled={items.length === 0 && !busy}
          aria-label="Limpar conversa"
          title="Limpar conversa"
        >
          <Trash2 />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Fechar chat"
          title="Fechar chat"
        >
          <X />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex size-12 items-center justify-center border bg-muted/40">
              <Sparkles className="size-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">Vamos montar seu dashboard?</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                Peça ajuda para explorar os dados, testar consultas ou planejar
                visualizações.
              </p>
            </div>
          </div>
        ) : (
          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <MessageScroller className="flex-1">
              <MessageScrollerViewport aria-label="Mensagens da conversa">
                <MessageScrollerContent aria-busy={busy} className="gap-5 py-4">
                  {items.map((item) => {
                    if (
                      item.kind === "message" &&
                      item.role === "assistant" &&
                      !item.content.trim() &&
                      item.status !== "stopped"
                    ) {
                      return null;
                    }

                    return (
                      <MessageScrollerItem
                        key={item.id}
                        messageId={item.id}
                        scrollAnchor={
                          item.kind === "message" && item.role === "user"
                        }
                      >
                        <ChatItemView
                          item={item}
                          busy={busy}
                          isLatestInteraction={isLatestInteractionItem(item)}
                          onRetry={onRetry}
                          onReviewPreview={setReviewPreview}
                          onApplyDashboard={onApplyDashboard}
                          onReviewContext={setReviewContext}
                          onSubmitQuestionnaire={onSubmitQuestionnaire}
                        />
                      </MessageScrollerItem>
                    );
                  })}
                  {busy && activityProgress && (
                      <MessageScrollerItem messageId="assistant-thinking">
                        <Marker role="status" className="px-4 text-xs">
                          <MarkerIcon>
                            <LoaderCircle className="animate-spin" />
                          </MarkerIcon>
                          <MarkerContent className="shimmer">
                            {activityProgress}
                          </MarkerContent>
                        </Marker>
                      </MessageScrollerItem>
                    )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
        )}
      </div>

      <div className="shrink-0 border-t p-3">
        <div className="flex items-end gap-2 border bg-background p-2 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/40">
          <Textarea
            ref={textareaRef}
            value={draft}
            rows={1}
            maxLength={MAX_MESSAGE_CHARACTERS}
            placeholder="Pergunte sobre seus dados…"
            className="max-h-36 min-h-9 resize-none border-0 bg-transparent px-1 py-2 shadow-none my-auto focus-visible:ring-0"
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={submitOnEnter}
            aria-label="Mensagem para a IA"
          />
          {busy ? (
            <Button
              variant="destructive"
              size="icon"
              onClick={onStop}
              aria-label="Parar geração"
              title="Parar geração"
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={onSend}
              disabled={!draft.trim()}
              aria-label="Enviar mensagem"
              title="Enviar mensagem"
            >
              <Send />
            </Button>
          )}
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Enter envia · Shift+Enter quebra linha
        </p>
      </div>
      <Dialog
        open={Boolean(reviewPreview)}
        onOpenChange={(open) => {
          if (!open && !savingPreview) setReviewPreview(undefined);
        }}
      >
        <DialogContent className="flex max-h-[90vh] w-[90vw] max-w-[90vw] flex-col overflow-hidden sm:max-w-[90vw]">
          <DialogHeader>
            <DialogTitle>
              {reviewPreview?.purpose === "dashboard"
                ? "Revisar query para dashboard"
                : "Revisar consulta rápida"}
            </DialogTitle>
            <DialogDescription>
              Confirme o servidor, a ação, os valores usados e a amostra.{" "}
              {reviewPreview?.purpose === "dashboard"
                ? "Ao salvar, o assistente continuará a proposta de dashboard solicitada."
                : "Ao salvar, esta query ficará disponível no catálogo; isso não inicia automaticamente uma proposta de dashboard."}{" "}
              A resposta em texto da IA não confirma nenhuma alteração.
            </DialogDescription>
          </DialogHeader>
          {reviewPreview && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-2 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <p>
                  <strong>Servidor:</strong> {reviewPreview.dataSource.name}
                </p>
                <p>
                  <strong>Ação:</strong>{" "}
                  {reviewPreview.intent.mode === "update"
                    ? `Editar ${reviewPreview.intent.queryId}`
                    : "Criar query"}
                </p>
              </div>
              <label className="flex flex-col gap-2 text-sm font-medium">
                Nome da query
                <Input
                  value={reviewName}
                  maxLength={160}
                  minLength={2}
                  onChange={(event) => setReviewName(event.target.value)}
                  disabled={savingPreview}
                />
              </label>
              <div className="rounded border bg-muted/40 p-3">
                <p className="font-medium">SQL testado</p>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">
                  {reviewPreview.sqlText}
                </pre>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded border p-3">
                  <p className="font-medium">Definições dos parâmetros</p>
                  <pre className="mt-2 max-h-36 overflow-auto text-xs">
                    {JSON.stringify(reviewPreview.parameters, null, 2)}
                  </pre>
                </div>
                <div className="rounded border p-3">
                  <p className="font-medium">Valores usados no teste</p>
                  <pre className="mt-2 max-h-36 overflow-auto text-xs">
                    {JSON.stringify(reviewPreview.testValues, null, 2)}
                  </pre>
                </div>
              </div>
              <div className="rounded border p-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="font-medium">
                    Amostra retornada · {reviewPreview.rowCount} linhas
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Limite {reviewPreview.rowLimit} linhas /{" "}
                    {reviewPreview.byteLimit} bytes · {reviewPreview.bytes}{" "}
                    bytes usados
                    {reviewPreview.truncated
                      ? ` · truncada (${reviewPreview.truncationReason})`
                      : ""}
                  </p>
                </div>
                <pre className="mt-2 max-h-56 overflow-auto text-xs">
                  {JSON.stringify(reviewPreview.rows, null, 2)}
                </pre>
              </div>
              {stalePreview && (
                <div
                  role="alert"
                  className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                >
                  Esta prévia não pode mais ser usada. Teste novamente antes de
                  salvar.
                  {reloadedQuery && (
                    <>
                      <p className="mt-2 font-medium">
                        Versão atual recarregada: {reloadedQuery.name}
                      </p>
                      <pre className="mt-1 max-h-24 overflow-auto text-xs">
                        {reloadedQuery.sqlText}
                      </pre>
                    </>
                  )}
                </div>
              )}
              {!canSavePreview && (
                <p className="text-xs text-muted-foreground">
                  Sua conta não tem a permissão necessária para salvar esta
                  query.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReviewPreview(undefined)}
              disabled={savingPreview}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => void savePreview()}
              disabled={
                !reviewPreview ||
                savingPreview ||
                busy ||
                stalePreview ||
                !canSavePreview ||
                reviewName.trim().length < 2
              }
            >
              {savingPreview
                ? "Salvando…"
                : reviewPreview?.purpose === "dashboard"
                  ? reviewPreview.intent.mode === "update"
                    ? "Aplicar e continuar"
                    : "Salvar e continuar"
                  : reviewPreview?.intent.mode === "update"
                    ? "Aplicar edição"
                    : "Salvar query"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(reviewContext)}
        onOpenChange={(open) => {
          if (!open && !resolvingContext) setReviewContext(undefined);
        }}
      >
        <DialogContent className="flex max-h-[90dvh] w-[calc(100%-1rem)] max-w-3xl flex-col overflow-hidden sm:w-[calc(100%-2rem)]">
          <DialogHeader>
            <DialogTitle>Revisar alteração de contexto</DialogTitle>
            <DialogDescription>
              Fechar ou cancelar esta janela não aprova nem descarta a proposta.
            </DialogDescription>
          </DialogHeader>
          {reviewContext && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 text-sm">
              <dl className="grid gap-2 rounded border bg-muted/30 p-3 sm:grid-cols-2">
                <div>
                  <dt className="font-medium">Servidor</dt>
                  <dd className="break-words text-muted-foreground">
                    {reviewContext.sourceName}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">Destino</dt>
                  <dd className="break-words text-muted-foreground">
                    {reviewContext.targetType === "source"
                      ? "Contexto geral do servidor"
                      : `${reviewContext.schemaName}.${reviewContext.tableName}`}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-medium">Motivo informado pela IA</dt>
                  <dd className="whitespace-pre-wrap break-words text-muted-foreground">
                    {reviewContext.reason}
                  </dd>
                </div>
              </dl>
              <div className="rounded border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
                Este contexto orienta as próximas consultas da IA para{" "}
                {reviewContext.targetType === "source"
                  ? "este servidor"
                  : "esta tabela"}
                . A aprovação altera somente o texto de contexto; não muda
                credenciais, conexão ou dados.
              </div>
              <div className="grid min-w-0 gap-3 md:grid-cols-2">
                <section
                  aria-labelledby="context-current-heading"
                  className="min-w-0 rounded border p-3"
                >
                  <h3 id="context-current-heading" className="font-medium">
                    Contexto atual
                  </h3>
                  <div className="mt-2 max-h-52 min-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-3 text-sm">
                    {reviewContext.currentContext || (
                      <span className="italic text-muted-foreground">
                        Nenhum contexto cadastrado.
                      </span>
                    )}
                  </div>
                </section>
                <section
                  aria-labelledby="context-proposed-heading"
                  className="min-w-0 rounded border border-primary/30 p-3"
                >
                  <h3 id="context-proposed-heading" className="font-medium">
                    Contexto proposto
                  </h3>
                  <div className="mt-2 max-h-52 min-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-primary/5 p-3 text-sm">
                    {reviewContext.proposedContext || (
                      <span className="italic text-muted-foreground">
                        O contexto será removido.
                      </span>
                    )}
                  </div>
                </section>
              </div>
              {reviewContext.status !== "pending" && (
                <p
                  role="status"
                  className="rounded border p-3 text-sm text-muted-foreground"
                >
                  Esta proposta já foi resolvida ({reviewContext.status}). Gere
                  outra proposta se ainda precisar alterar o contexto.
                </p>
              )}
            </div>
          )}
          <DialogFooter className="flex-col-reverse gap-2 border-t pt-3 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => setReviewContext(undefined)}
              disabled={resolvingContext}
            >
              Cancelar
            </Button>
            {reviewContext?.status === "pending" &&
              Date.parse(reviewContext.expiresAt) > Date.now() && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => void resolveContextProposal("dismiss")}
                    disabled={resolvingContext}
                  >
                    {resolvingContext ? "Salvando…" : "Descartar proposta"}
                  </Button>
                  <Button
                    onClick={() => void resolveContextProposal("approve")}
                    disabled={resolvingContext}
                  >
                    {resolvingContext ? "Aprovando…" : "Aprovar contexto"}
                  </Button>
                </>
              )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AiChatDock({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const refreshCurrentView = useCurrentViewRefresh();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [activityProgress, setActivityProgress] = useState<string>();
  const [panelWidth, setPanelWidth] = useState(DEFAULT_AI_CHAT_WIDTH);
  const abortRef = useRef<AbortController | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const resizeStartRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const generationRef = useRef(0);
  const activeAssistantIdRef = useRef<string | null>(null);
  const lastPromptRef = useRef("");
  const lastContinuationRef = useRef<AiContinuation | undefined>(undefined);
  const lastPageContextRef = useRef<AiPageContext | undefined>(undefined);
  const lastSilentUserRef = useRef(false);
  const pathRef = useRef(location.pathname);
  const refreshedToolCallsRef = useRef(new Set<string>());
  const dashboardSavePendingRef = useRef(new Set<string>());
  pathRef.current = location.pathname;

  const beginPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeStartRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: panelWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resizeStart = resizeStartRef.current;
    if (!resizeStart || resizeStart.pointerId !== event.pointerId) return;
    const nextWidth =
      resizeStart.startWidth + resizeStart.startX - event.clientX;
    setPanelWidth(
      Math.max(MIN_AI_CHAT_WIDTH, Math.min(MAX_AI_CHAT_WIDTH, nextWidth)),
    );
  };

  const endPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizeStartRef.current?.pointerId !== event.pointerId) return;
    resizeStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handlePanelResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 16;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setPanelWidth((width) => Math.min(MAX_AI_CHAT_WIDTH, width + step));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setPanelWidth((width) => Math.max(MIN_AI_CHAT_WIDTH, width - step));
    } else if (event.key === "Home") {
      event.preventDefault();
      setPanelWidth(MIN_AI_CHAT_WIDTH);
    } else if (event.key === "End") {
      event.preventDefault();
      setPanelWidth(MAX_AI_CHAT_WIDTH);
    }
  };

  useEffect(() => {
    if (!open || !user?.isAdmin) return;
    let active = true;
    api
      .pendingAiContextProposals()
      .then((proposals) => {
        if (!active) return;
        setItems((current) => {
          const pending = new Map(
            proposals.map((proposal) => [proposal.id, proposal]),
          );
          const existing = current.map((item) => {
            if (item.kind !== "context_proposal") return item;
            const latest = pending.get(item.id);
            if (!latest) return item;
            pending.delete(item.id);
            return { ...item, proposal: latest };
          });
          return [
            ...existing,
            ...[...pending.values()].map((proposal) => ({
              id: proposal.id,
              kind: "context_proposal" as const,
              proposal,
            })),
          ];
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [open, user?.id, user?.isAdmin]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  const updateAssistant = useCallback(
    (assistantId: string, update: (message: ChatMessage) => ChatMessage) => {
      setItems((current) =>
        current.map((item) =>
          item.kind === "message" && item.id === assistantId
            ? update(item)
            : item,
        ),
      );
    },
    [],
  );

  const insertBeforeAssistant = useCallback(
    (assistantId: string, item: ChatItem) => {
      setItems((current) => {
        const assistantIndex = current.findIndex(
          (candidate) =>
            candidate.kind === "message" && candidate.id === assistantId,
        );
        const index = assistantIndex < 0 ? current.length : assistantIndex;
        return [...current.slice(0, index), item, ...current.slice(index)];
      });
    },
    [],
  );

  const insertAfterAssistant = useCallback(
    (assistantId: string, item: ChatItem) => {
      setItems((current) => {
        const reference = getActionCardReference(item);
        const originalAssistant = current.find(
          (candidate) =>
            candidate.kind === "message" && candidate.id === assistantId,
        ) ?? [...current].reverse().find(
          (candidate): candidate is ChatMessage =>
            candidate.kind === "message" && candidate.role === "assistant",
        );
        if (!originalAssistant || originalAssistant.kind !== "message")
          return [...current, item];
        const ownerMessageId = originalAssistant.id;

        let next = current;
        let attachedItem = item;
        if (reference && isActionCardItem(item)) {
          const displacedCardIds = new Set([
            reference.id,
            originalAssistant.actionCard?.id,
          ]);
          next = current
            .filter(
              (candidate) =>
                !isActionCardItem(candidate) ||
                !displacedCardIds.has(candidate.id),
            )
            .map((candidate) => {
              if (candidate.kind !== "message") return candidate;
              if (candidate.id === ownerMessageId)
                return { ...candidate, actionCard: reference };
              if (
                candidate.actionCard &&
                displacedCardIds.has(candidate.actionCard.id)
              ) {
                const message = { ...candidate };
                delete message.actionCard;
                return message;
              }
              return candidate;
            });
          attachedItem = withActionCardOwner(item, ownerMessageId);
        }

        const assistantIndex = next.findIndex(
          (candidate) =>
            candidate.kind === "message" && candidate.id === ownerMessageId,
        );

        let index = assistantIndex + 1;
        while (index < next.length && next[index]?.kind !== "message") {
          index += 1;
        }
        return [
          ...next.slice(0, index),
          attachedItem,
          ...next.slice(index),
        ];
      });
    },
    [],
  );

  const handleEvent = useCallback(
    (
      event: ChatEvent,
      assistantId: string,
      requestPath: string,
      generation: number,
    ) => {
      if (generation !== generationRef.current) return;

      switch (event.type) {
        case "start":
          activeRequestIdRef.current = event.requestId;
          setActivityProgress(`Aguardando resposta da IA · ID ${event.requestId.slice(0, 8)}`);
          return;
        case "progress": {
          const label = event.phase === "running_tool"
            ? toolLabel(event.toolName ?? "")
            : event.phase === "preparing_response"
              ? "Preparando resposta"
              : "Aguardando resposta da IA";
          setActivityProgress(`${label} · ${formatElapsedTime(event.elapsedMs)} · ID ${event.requestId.slice(0, 8)}`);
          return;
        }
        case "token":
          setActivityProgress(undefined);
          updateAssistant(assistantId, (message) => ({
            ...message,
            content: message.content + event.delta,
            status: "streaming",
          }));
          return;
        case "tool_start":
          insertBeforeAssistant(assistantId, {
            id: event.toolCallId,
            kind: "tool",
            toolName: event.toolName,
            status: "running",
          });
          return;
        case "tool_result":
          setItems((current) => {
            const index = current.findIndex(
              (item) => item.kind === "tool" && item.id === event.toolCallId,
            );
            if (index < 0) {
              const tool: ToolMessage = {
                id: event.toolCallId,
                kind: "tool",
                toolName: event.toolName,
                status: event.ok ? "success" : "failed",
              };
              const assistantIndex = current.findIndex(
                (item) => item.kind === "message" && item.id === assistantId,
              );
              const insertionIndex =
                assistantIndex < 0 ? current.length : assistantIndex;
              return [
                ...current.slice(0, insertionIndex),
                tool,
                ...current.slice(insertionIndex),
              ];
            }
            return current.map((item) =>
              item.kind === "tool" && item.id === event.toolCallId
                ? { ...item, status: event.ok ? "success" : "failed" }
                : item,
            );
          });
          if (
            event.ok &&
            event.toolName === REFRESH_TOOL_NAME &&
            !refreshedToolCallsRef.current.has(event.toolCallId) &&
            pathRef.current === requestPath &&
            /^\/dashboards\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              pathRef.current,
            )
          ) {
            refreshedToolCallsRef.current.add(event.toolCallId);
            refreshCurrentView();
          }
          return;
        case "query_preview":
          setItems((current) =>
            current.map((item) => {
              if (item.kind !== "query_preview" || item.savedQueryId)
                return item;
              const sameTarget = item.intent.mode === event.intent.mode && (
                event.intent.mode === "update"
                  ? Boolean(event.intent.queryId) && item.intent.queryId === event.intent.queryId
                  : item.dataSource.id === event.dataSource.id &&
                    normalizeQueryPreviewName(item.intent.queryName) ===
                      normalizeQueryPreviewName(event.intent.queryName)
              );
              if (!sameTarget) return item;
              const draftChanged =
                item.dataSource.id !== event.dataSource.id ||
                item.sqlText !== event.sqlText ||
                JSON.stringify(item.parameters) !==
                  JSON.stringify(event.parameters) ||
                JSON.stringify(item.testValues) !==
                  JSON.stringify(event.testValues) ||
                item.intent.mode !== event.intent.mode ||
                item.intent.queryId !== event.intent.queryId;
              return draftChanged ? { ...item, stale: true } : item;
            }),
          );
          insertAfterAssistant(assistantId, {
            id: event.testRunId,
            kind: "query_preview",
            testRunId: event.testRunId,
            dataSource: event.dataSource,
            purpose: event.purpose,
            intent: event.intent,
            sqlText: event.sqlText,
            parameters: event.parameters,
            testValues: event.testValues,
            rows: event.rows,
            rowCount: event.rowCount,
            rowLimit: event.rowLimit,
            byteLimit: event.byteLimit,
            bytes: event.bytes,
            truncated: event.truncated,
            truncationReason: event.truncationReason,
          });
          return;
        case "proposal":
          insertAfterAssistant(assistantId, {
            id: event.proposalId,
            kind: "proposal",
            title: event.title,
            summary: event.summary,
          });
          return;
        case "context_proposal":
          insertAfterAssistant(assistantId, {
            id: event.proposal.id,
            kind: "context_proposal",
            proposal: event.proposal,
          });
          return;
        case "questionnaire":
          insertAfterAssistant(assistantId, {
            id: event.toolCallId,
            toolCallId: event.toolCallId,
            kind: "questionnaire",
            questionnaire: event.questionnaire,
          });
          return;
        case "dashboard_preview":
          setItems((current) =>
            current.map((item) =>
              item.kind === "dashboard_preview" &&
              !item.saved &&
              item.dashboardId === event.dashboardId
                ? { ...item, stale: true }
                : item,
            ),
          );
          insertAfterAssistant(assistantId, {
            ...event,
            id: event.proposalId,
            kind: "dashboard_preview",
          });
          return;
        case "dashboard_applied": {
          const currentDashboardId = /^\/dashboards\/([^/]+)$/.exec(pathRef.current)?.[1];
          if (
            event.mode === "create" ||
            currentDashboardId?.toLowerCase() !== event.dashboardId.toLowerCase()
          ) {
            navigate(`/dashboards/${event.dashboardId}`);
          } else {
            refreshCurrentView();
          }
          toast.success(`Patch aplicado ao dashboard “${event.dashboardName}”.`);
          return;
        }
        case "error":
          setActivityProgress(undefined);
          updateAssistant(assistantId, (message) => ({
            ...message,
            status: "error",
          }));
          insertBeforeAssistant(assistantId, {
            id: newId(),
            kind: "error",
            assistantId,
            retryable: event.retryable,
            message: event.message,
          });
          return;
        case "done":
          setActivityProgress(undefined);
          updateAssistant(assistantId, (message) => ({
            ...message,
            status: "complete",
          }));
      }
    },
    [
      insertAfterAssistant,
      insertBeforeAssistant,
      navigate,
      refreshCurrentView,
      updateAssistant,
    ],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    generationRef.current += 1;
    setBusy(false);
    setActivityProgress(undefined);
    activeRequestIdRef.current = null;
    const assistantId = activeAssistantIdRef.current;
    if (assistantId) {
      updateAssistant(assistantId, (message) => ({
        ...message,
        status: "stopped",
      }));
    }
    activeAssistantIdRef.current = null;
  }, [updateAssistant]);

  const send = useCallback(
    async (options?: SendOptions): Promise<boolean> => {
      const retrying = options?.retry === true;
      const content = (options?.content ?? draft).trim();
      if (!content || busy) return false;
      if (content.length > MAX_MESSAGE_CHARACTERS) {
        toast.error("A mensagem excede o limite de 8.000 caracteres.");
        return false;
      }

      const userMessage: ChatMessage = {
        id: newId(),
        kind: "message",
        role: "user",
        content,
        status: "complete",
      };
      const assistantMessage: ChatMessage = {
        id: newId(),
        kind: "message",
        role: "assistant",
        content: "",
        status: "streaming",
      };
      const conversation = completedConversation(
        items,
        retrying
          ? undefined
          : { reserveMessages: 1, reserveCharacters: content.length },
      );
      if (!retrying || options?.silentUser)
        conversation.push({ role: "user", content });
      const pageContext =
        options?.pageContext ?? pageContextForPath(location.pathname);
      const requestPath = pageContext.pathname;
      const savedQueryReferences = new Map<string, SavedQueryReference>();
      for (const item of items) {
        if (item.kind !== "query_preview" || !item.savedQueryId) continue;
        savedQueryReferences.set(item.savedQueryId, {
          id: item.savedQueryId,
          name: item.savedQueryName ?? item.intent.queryName,
        });
      }
      if (options?.savedQueryContext) {
        savedQueryReferences.set(
          options.savedQueryContext.id,
          options.savedQueryContext,
        );
      }
      const savedQueryContext = [...savedQueryReferences.values()].slice(-20);
      const latestQueryPreview = [...items]
        .reverse()
        .find(
          (item): item is QueryPreviewItem =>
            item.kind === "query_preview" && !item.stale && !item.savedQueryId,
        );
      const invalidatesPendingPreview = Boolean(
        latestQueryPreview &&
          shouldInvalidateForDynamicPeriod(content, latestQueryPreview),
      );
      const shouldIncludePendingQueryContext =
        shouldSendPendingPreviewContext(content) ||
        Boolean(
          latestQueryPreview &&
            shouldResurfaceQueryPreview(
              content,
              latestQueryPreview.savedQueryName ?? latestQueryPreview.intent.queryName,
            ),
        );
      let pendingQueryPreviews =
        !retrying &&
        !options?.silentUser &&
        shouldIncludePendingQueryContext
          ? items.flatMap((item) =>
              item.kind === "query_preview" &&
              !item.savedQueryId &&
              (!item.stale || item.testRunId === latestQueryPreview?.testRunId) &&
              item.sqlText.length <= 60_000
                ? [{
                    testRunId: item.testRunId,
                    queryName: item.intent.queryName,
                    purpose: item.purpose ?? "quick_query",
                    dataSource: {
                      id: item.dataSource.id,
                      name: item.dataSource.name,
                    },
                    sqlText: item.sqlText,
                    parameters: item.parameters,
                    testValues: item.testValues,
                  }]
                : [],
            ).slice(-3)
          : undefined;
      while (
        pendingQueryPreviews?.length &&
        new TextEncoder().encode(JSON.stringify(pendingQueryPreviews)).length > 60_000
      ) {
        pendingQueryPreviews = pendingQueryPreviews.slice(1);
      }
      const baseUrl = (
        import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000"
      ).replace(/\/$/, "");
      const controller = new AbortController();
      const generation = ++generationRef.current;

      abortRef.current?.abort();
      abortRef.current = controller;
      activeAssistantIdRef.current = assistantMessage.id;
      lastPromptRef.current = content;
      lastContinuationRef.current = options?.continuation;
      lastPageContextRef.current = pageContext;
      lastSilentUserRef.current = options?.silentUser === true;
      refreshedToolCallsRef.current.clear();
      setItems((current) => {
        const withInvalidatedPreview = invalidatesPendingPreview && latestQueryPreview
          ? current.map((item) =>
              item.kind === "query_preview" &&
              item.testRunId === latestQueryPreview.testRunId
                ? { ...item, stale: true, staleReason: "dynamic_period_mismatch" as const }
                : item,
            )
          : current;
        if (!retrying) {
          return options?.silentUser
            ? [...withInvalidatedPreview, assistantMessage]
            : [...withInvalidatedPreview, userMessage, assistantMessage];
        }
        const failedAssistantId = [...current]
          .reverse()
          .find(
            (item) =>
              item.kind === "message" &&
              item.role === "assistant" &&
              item.status === "error",
        )?.id;
        return [
          ...withInvalidatedPreview.filter(
            (item) =>
              item.id !== failedAssistantId &&
              !(
                item.kind === "error" && item.assistantId === failedAssistantId
              ),
          ),
          assistantMessage,
        ];
      });
      setDraft("");
      setBusy(true);
      setActivityProgress("Conectando à IA…");

      try {
        const response = await fetch(`${baseUrl}/api/admin/ai/chat`, {
          method: "POST",
          credentials: "include",
          headers: {
            Accept: "text/event-stream",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: conversation,
            pageContext,
            ...(savedQueryContext.length
              ? { savedQueries: savedQueryContext }
              : {}),
            ...(pendingQueryPreviews ? { pendingQueryPreviews } : {}),
            ...(options?.continuation
              ? { continuation: options.continuation }
              : {}),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const result = (await response.json().catch(() => ({}))) as {
            error?: unknown;
          };
          throw new Error(
            typeof result.error === "string"
              ? result.error
              : "Não foi possível iniciar a conversa com a IA.",
          );
        }
        if (!response.body)
          throw new Error("O servidor não iniciou o streaming da IA.");

        let receivedDone = false;
        let receivedError = false;
        await readChatStream(response.body, (event) => {
          if (event.type === "done") receivedDone = true;
          if (event.type === "error") receivedError = true;
          handleEvent(event, assistantMessage.id, requestPath, generation);
          if (
            event.type === "query_preview" &&
            choseDynamicPeriod(content) &&
            !previewUsesDateParameters(event)
          ) {
            setItems((current) => current.map((item) =>
              item.kind === "query_preview" && item.testRunId === event.testRunId
                ? { ...item, stale: true, staleReason: "dynamic_period_mismatch" as const }
                : item,
            ));
          }
        });
        if (!receivedDone && !receivedError) {
          throw new Error(
            "A conexão foi encerrada antes de a IA concluir a resposta.",
          );
        }
        if (generation === generationRef.current) {
          updateAssistant(assistantMessage.id, (message) =>
            message.status === "error" || message.status === "complete"
              ? message
              : { ...message, status: receivedDone ? "complete" : "error" },
          );
        }
        return (
          generation === generationRef.current && receivedDone && !receivedError
        );
      } catch (reason) {
        if (generation !== generationRef.current) return false;
        if (reason instanceof DOMException && reason.name === "AbortError") {
          updateAssistant(assistantMessage.id, (message) => ({
            ...message,
            status: "stopped",
          }));
        } else {
          updateAssistant(assistantMessage.id, (message) => ({
            ...message,
            status: "error",
          }));
          setItems((current) => [
            ...current,
            {
              id: newId(),
              kind: "error",
              assistantId: assistantMessage.id,
              retryable: true,
              message: reason instanceof TypeError && /fetch|network|load failed/i.test(reason.message)
                ? `A conexão com o servidor foi interrompida.${activeRequestIdRef.current ? ` ID ${activeRequestIdRef.current.slice(0, 8)}.` : ""} Tente novamente.`
                : `${reason instanceof Error ? reason.message : "A conexão com a IA falhou."}${activeRequestIdRef.current ? ` (ID ${activeRequestIdRef.current.slice(0, 8)})` : ""}`,
            },
          ]);
        }
        return false;
      } finally {
        if (generation === generationRef.current) {
          setBusy(false);
          setActivityProgress(undefined);
          abortRef.current = null;
          activeRequestIdRef.current = null;
          activeAssistantIdRef.current = null;
        }
      }
    },
    [busy, draft, handleEvent, items, location.pathname, updateAssistant],
  );

  const submitQuestionnaire = useCallback(
    (item: QuestionnaireChatItem, answers: QuestionnaireAnswers) => {
      if (busy || item.answersSent) return;
      const answerText = [
        `Respostas ao formulário "${item.questionnaire.title}":`,
        ...item.questionnaire.questions.map((question) => {
          const values = answers[question.name] ?? [];
          return `- ${question.prompt}: ${values.length ? values.join(", ") : "Sem resposta"}`;
        }),
      ].join("\n");
      if (answerText.length > MAX_MESSAGE_CHARACTERS) {
        toast.error(
          "As respostas ficaram muito longas. Reduza o texto ou selecione menos opções e tente novamente.",
        );
        return;
      }
      void send({ content: answerText }).then((sent) => {
        if (!sent) return;
        setItems((current) =>
          current.map((candidate) =>
            candidate.kind === "questionnaire" && candidate.id === item.id
              ? { ...candidate, answers, answersSent: true }
              : candidate,
          ),
        );
      });
    },
    [busy, send],
  );

  const clear = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setActivityProgress(undefined);
    activeRequestIdRef.current = null;
    setItems([]);
    setDraft("");
    activeAssistantIdRef.current = null;
    lastPromptRef.current = "";
    lastContinuationRef.current = undefined;
    lastPageContextRef.current = undefined;
    lastSilentUserRef.current = false;
    refreshedToolCallsRef.current.clear();
  }, []);

  const continueAfterQuerySaved = useCallback(
    (preview: QueryPreviewItem, queryId: string, queryName: string) => {
      const shouldContinue = preview.purpose === "dashboard"
        || hasPendingDashboardComponentRequest(items, location.pathname);
      const savedPreview = shouldContinue && preview.purpose !== "dashboard"
        ? { ...preview, purpose: "dashboard" as const }
        : preview;
      setItems((current) => markQueryPreviewSavedOnce(
        current,
        preview.testRunId,
        queryId,
        queryName,
        {
            ...savedPreview,
            id: newId(),
            savedQueryId: queryId,
            savedQueryName: queryName,
            stale: false,
        },
      ));
      if (!shouldContinue) return;
      void send({
        content: `A query “${queryName}” foi salva com o UUID ${queryId}. Continue a solicitação original que dependia dela; se não houver outra etapa pendente, confirme que ela foi salva.`,
        silentUser: true,
        continuation: { type: "query_saved", queryId, queryName },
        savedQueryContext: { id: queryId, name: queryName },
      }).then((continued) => {
        if (continued) return;
        setItems((current) => [
          ...current,
          {
            id: newId(),
            kind: "message",
            role: "assistant",
            content: `A query “${queryName}” foi salva com o UUID ${queryId}, mas a IA não concluiu a etapa seguinte. A query continua salva; você pode pedir para continuar usando-a no dashboard.`,
            status: "complete",
          },
        ]);
      });
    },
    [items, location.pathname, send],
  );

  const markContextProposalResolved = useCallback(
    (proposalId: string, status: AiContextProposal["status"]) => {
      setItems((current) =>
        current.map((item) =>
          item.kind === "context_proposal" && item.id === proposalId
            ? {
                ...item,
                proposal: {
                  ...item.proposal,
                  status,
                  resolvedAt: new Date().toISOString(),
                },
              }
            : item,
        ),
      );
    },
    [],
  );

  const handleDashboardSaved = useCallback(
    (dashboardId: string, mode: "create" | "update") => {
      const routeDashboardId = /^\/dashboards\/([^/]+)$/.exec(
        location.pathname,
      )?.[1];
      if (
        mode === "create" ||
        routeDashboardId?.toLowerCase() !== dashboardId.toLowerCase()
      ) {
        navigate(`/dashboards/${dashboardId}`);
        return;
      }
      refreshCurrentView();
    },
    [location.pathname, navigate, refreshCurrentView],
  );

  const applyDashboard = useCallback(
    async (item: DashboardPreviewItem, acknowledgeTruncation: boolean) => {
      if (
        item.saved ||
        item.stale ||
        dashboardSavePendingRef.current.has(item.proposalId)
      )
        return;
      if (new Date(item.expiresAt).getTime() <= Date.now()) {
        setItems((current) =>
          current.map((candidate) =>
            candidate.kind === "dashboard_preview" && candidate.id === item.id
              ? { ...candidate, stale: true }
              : candidate,
          ),
        );
        toast.error("A proposta expirou. Peça uma nova prévia ao assistente.");
        return;
      }
      dashboardSavePendingRef.current.add(item.proposalId);
      setItems((current) =>
        current.map((candidate) =>
          candidate.kind === "dashboard_preview" && candidate.id === item.id
            ? { ...candidate, saving: true }
            : candidate,
        ),
      );
      try {
        const result = await api.commitAiDashboardProposal(
          item.proposalId,
          acknowledgeTruncation,
        );
        setItems((current) =>
          current.map((candidate) =>
            candidate.kind === "dashboard_preview" && candidate.id === item.id
              ? { ...candidate, saved: true, saving: false }
              : candidate,
          ),
        );
        toast.success(
          result.alreadyApplied
            ? "A aplicação da proposta foi confirmada."
            : result.mode === "create"
              ? "Dashboard criado."
              : "Alterações aplicadas ao dashboard.",
        );
        handleDashboardSaved(result.id, result.mode);
        setItems((current) => [
          ...current,
          {
            id: newId(),
            kind: "message",
            role: "assistant",
            content: `Dashboard “${item.document.name}” salvo com o UUID ${result.id}.`,
            status: "complete",
          },
        ]);
      } catch (reason) {
        const conflict = reason instanceof ApiError && reason.status === 409;
        setItems((current) =>
          current.map((candidate) =>
            candidate.kind === "dashboard_preview" && candidate.id === item.id
              ? { ...candidate, stale: conflict, saving: false }
              : candidate,
          ),
        );
        toast.error(
          reason instanceof Error
            ? reason.message
            : "Não foi possível aplicar a proposta.",
        );
      } finally {
        dashboardSavePendingRef.current.delete(item.proposalId);
        setItems((current) =>
          current.map((candidate) =>
            candidate.kind === "dashboard_preview" && candidate.id === item.id
              ? { ...candidate, saving: false }
              : candidate,
          ),
        );
      }
    },
    [handleDashboardSaved],
  );

  const pageLabel = location.pathname.startsWith("/dashboards/")
    ? "Dashboard atual"
    : location.pathname.startsWith("/admin/sources")
      ? "Servidores e tabelas"
      : location.pathname.startsWith("/admin/queries")
        ? "Consultas"
        : "Plataforma de dashboards";

  const chatContent = (
    <ChatWindow
      items={items}
      busy={busy}
      activityProgress={activityProgress}
      draft={draft}
      pageLabel={pageLabel}
      onDraftChange={setDraft}
      onSend={() => void send()}
      onRetry={() =>
        void send({
          content: lastPromptRef.current,
          retry: true,
          silentUser: lastSilentUserRef.current,
          continuation: lastContinuationRef.current,
          pageContext: lastPageContextRef.current,
        })
      }
      onStop={stop}
      onClear={clear}
      onClose={() => onOpenChange(false)}
      onPreviewSaved={continueAfterQuerySaved}
      onContextProposalResolved={markContextProposalResolved}
      onApplyDashboard={applyDashboard}
      onSubmitQuestionnaire={submitQuestionnaire}
    />
  );

  return (
    <aside
      id="ai-chat-panel"
      aria-label="Chat com IA"
      aria-hidden={!open}
      className={cn(
        "relative flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-l bg-background",
        isMobile ? "w-full flex-1" : "max-w-[min(90vw,680px)]",
        !open && "hidden",
      )}
      style={{ width: isMobile ? "100%" : `${panelWidth}px` }}
    >
      {!isMobile && (
        <div
          role="separator"
          aria-label="Redimensionar painel do chat"
          aria-orientation="vertical"
          aria-valuemin={MIN_AI_CHAT_WIDTH}
          aria-valuemax={MAX_AI_CHAT_WIDTH}
          aria-valuenow={panelWidth}
          tabIndex={open ? 0 : -1}
          className="absolute inset-y-0 left-0 z-10 w-2 -translate-x-1/2 cursor-col-resize touch-none outline-none transition-colors hover:bg-primary/10 focus-visible:bg-primary/10"
          onPointerDown={beginPanelResize}
          onPointerMove={movePanelResize}
          onPointerUp={endPanelResize}
          onPointerCancel={endPanelResize}
          onKeyDown={handlePanelResizeKeyDown}
        />
      )}
      {chatContent}
    </aside>
  );
}

export function AiChatTrigger({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={open ? "secondary" : "outline"}
      size="sm"
      className="ml-auto shrink-0 gap-2"
      aria-expanded={open}
      aria-controls="ai-chat-panel"
      onClick={onClick}
    >
      {open ? <PanelRightClose /> : <Sparkles />}
      <span className="hidden sm:inline">
        {open ? "Fechar IA" : "Conversar com IA"}
      </span>
      <span className="sr-only sm:hidden">
        {open ? "Fechar chat" : "Abrir chat com IA"}
      </span>
    </Button>
  );
}
