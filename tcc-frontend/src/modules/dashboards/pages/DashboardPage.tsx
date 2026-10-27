import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  LayoutGrid,
  RefreshCw,
  Settings,
  Table2,
  Trash2,
  Users,
} from "lucide-react";
import { dashboardsApi } from "@/modules/dashboards/api/dashboards.api";
import { queriesApi } from "@/modules/queries/api/queries.api";
import {
  applyLayoutToDocument,
  organizeLayout,
} from "@/modules/dashboards/model/grid-edit";
import type {
  Dashboard,
  DashboardComponent,
  DashboardDocument,
} from "@/modules/dashboards/model/types";
import { useAuth } from "@/modules/identity/hooks/AuthContext";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { toast } from "@/shared/ui/toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { useRegisterCurrentViewRefresh } from "@/shared/context/CurrentViewRefreshContext";
import {
  collectArguments,
  queryArguments,
} from "@/modules/dashboards/model/lib";
import {
  loadDashboardFilters,
  saveDashboardFilters,
} from "@/modules/dashboards/model/filter-storage";
import type {
  FilterValues,
  QueryState,
} from "@/modules/dashboards/model/types";
import { DashboardComponentView } from "../components/DashboardComponentView";
import { DashboardFilters } from "../components/DashboardFilters";
import { DashboardGrid } from "../components/DashboardGrid";
import { useElementWidth } from "../components/useElementWidth";
import { gridMetrics, gridWidth } from "@/modules/dashboards/model/grid";
import { DashboardUsersDialog } from "../components/DashboardUsersDialog";

export function DashboardPage({
  dashboardId,
  onEditContext,
  onDeleted,
}: {
  dashboardId: string;
  onEditContext: () => void;
  /** Chamado depois de o administrador apagar o dashboard. */
  onDeleted?: () => void;
}) {
  const { user } = useAuth();
  const [frameRef, frameWidth] = useElementWidth<HTMLDivElement>();
  const [dashboard, setDashboard] = useState<Dashboard>();
  const [data, setData] = useState<Record<string, QueryState>>({});
  const [filters, setFilters] = useState<FilterValues>(() =>
    loadDashboardFilters(dashboardId),
  );
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<{
    draft: DashboardComponent[];
    document: DashboardDocument;
    revision: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string>();
  const [usersDialogOpen, setUsersDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteDashboard = async () => {
    setDeleting(true);
    try {
      await dashboardsApi.deleteDashboard(dashboardId);
      toast.success("Dashboard apagado.");
      setDeleteOpen(false);
      onDeleted?.();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível apagar o dashboard.",
      );
    } finally {
      setDeleting(false);
    }
  };
  const [dataRefreshVersion, setDataRefreshVersion] = useState(0);
  const querySequenceRef = useRef(0);
  const refreshData = useCallback(() => {
    setDataRefreshVersion((version) => version + 1);
    dashboardsApi
      .dashboard(dashboardId)
      .then(setDashboard)
      .catch((reason: Error) => setError(reason.message));
  }, [dashboardId]);
  useRegisterCurrentViewRefresh(refreshData);

  // reseta o estado local durante o render quando o dashboardId muda
  const [syncedDashboardId, setSyncedDashboardId] = useState(dashboardId);
  if (syncedDashboardId !== dashboardId) {
    setSyncedDashboardId(dashboardId);
    setDashboard(undefined);
    setData({});
    setFilters(loadDashboardFilters(dashboardId));
    setError(undefined);
    setEditing(null);
    setEditError(undefined);
  }

  useEffect(() => {
    let active = true;
    dashboardsApi
      .dashboard(dashboardId)
      .then((result) => {
        if (active) setDashboard(result);
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
    };
  }, [dashboardId]);

  const queryIds = useMemo(() => {
    if (!dashboard) return [];
    const lookupIds = dashboard.definition.workspace.params.flatMap(
      (parameter) => (parameter.lookup ? [parameter.lookup.queryUuid] : []),
    );
    return [
      ...new Set([
        ...dashboard.definition.components.map(
          (component) => component.queryUuid,
        ),
        ...lookupIds,
      ]),
    ];
  }, [dashboard]);

  // marca as queries como carregando durante o render quando a execucao muda
  const [syncedRun, setSyncedRun] = useState<unknown[]>([]);
  if (
    dashboard &&
    (syncedRun[0] !== dashboard ||
      syncedRun[1] !== filters ||
      syncedRun[2] !== dataRefreshVersion)
  ) {
    setSyncedRun([dashboard, filters, dataRefreshVersion]);
    setData((current) => ({
      ...current,
      ...Object.fromEntries(
        queryIds.map((id) => {
          const previousRows = current[id]?.rows;
          return [
            id,
            {
              loading: true,
              ...(previousRows ? { rows: previousRows } : {}),
            },
          ] as const;
        }),
      ),
    }));
  }

  useEffect(() => {
    if (!dashboard) return;
    const requestSequence = ++querySequenceRef.current;
    queryIds.forEach((queryId) => {
      queriesApi
        .query(queryId, queryArguments(dashboard, queryId, filters))
        .then((result) => {
          if (querySequenceRef.current !== requestSequence) return;
          setData((current) => ({
            ...current,
            [queryId]: { loading: false, rows: result.rows },
          }));
        })
        .catch((reason: Error) => {
          if (querySequenceRef.current !== requestSequence) return;
          setData((current) => ({
            ...current,
            [queryId]: {
              loading: false,
              error: reason.message,
              ...(current[queryId]?.rows !== undefined
                ? { rows: current[queryId].rows }
                : {}),
            },
          }));
        });
    });
    return () => {
      if (querySequenceRef.current === requestSequence) {
        querySequenceRef.current += 1;
      }
    };
  }, [dashboard, filters, dataRefreshVersion, queryIds]);

  if (error)
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>Não foi possível carregar o dashboard</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  if (!dashboard)
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-12 gap-4">
          <Skeleton className="col-span-12 h-32 md:col-span-6" />
          <Skeleton className="col-span-12 h-32 md:col-span-6" />
          <Skeleton className="col-span-12 h-96" />
        </div>
      </div>
    );
  const parameters = collectArguments(dashboard);
  const startEditing = () => {
    setEditError(undefined);
    dashboardsApi
      .dashboardContext(dashboardId)
      .then(({ document, revision }) =>
        setEditing({
          draft: dashboard.definition.components,
          document,
          revision,
        }),
      )
      .catch((reason: Error) => setEditError(reason.message));
  };
  const saveLayout = () => {
    if (!editing) return;
    setSaving(true);
    setEditError(undefined);
    dashboardsApi
      .updateDashboardContext(
        dashboardId,
        applyLayoutToDocument(editing.document, editing.draft),
        editing.revision,
      )
      .then(() => {
        setEditing(null);
        refreshData();
      })
      .catch((reason: Error) => setEditError(reason.message))
      .finally(() => setSaving(false));
  };
  const hasStaleDataErrors = Object.values(data).some(
    (state) => state.error && state.rows !== undefined,
  );
  return (
    <div ref={frameRef} className="w-full">
      <div
        className="mx-auto flex flex-col gap-6"
        style={{ width: gridWidth(gridMetrics(frameWidth)) }}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight md:text-2xl">
                {dashboard.name}
              </h1>
              <Badge variant="secondary">Dashboard</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {dashboard.description || "Sem descrição."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {user?.isAdmin && editing && (
              <>
                <Button
                  variant="outline"
                  disabled={saving}
                  title="Ordena por Gestalt: indicadores, gráficos e tabela, com fileiras fechadas"
                  onClick={() =>
                    setEditing({
                      ...editing,
                      draft: organizeLayout(editing.draft),
                    })
                  }
                >
                  Organizar
                </Button>
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={() => {
                    setEditing(null);
                    setEditError(undefined);
                  }}
                >
                  Cancelar
                </Button>
                <Button disabled={saving} onClick={saveLayout}>
                  Salvar layout
                </Button>
              </>
            )}
            {user?.isAdmin && !editing && (
              <>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={startEditing}
                  aria-label="Editar layout do dashboard"
                  title="Editar o layout (arrastar e redimensionar)"
                >
                  <LayoutGrid />
                  <span className="sr-only">Editar layout</span>
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={onEditContext}
                  aria-label="Abrir contexto do dashboard"
                >
                  <Settings />
                  <span className="sr-only">Contexto do dashboard</span>
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setUsersDialogOpen(true)}
                  aria-label="Gerenciar usuários do dashboard"
                >
                  <Users />
                  <span className="sr-only">Gerenciar usuários</span>
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setDeleteOpen(true)}
                  aria-label="Apagar dashboard"
                  title="Apagar o dashboard"
                >
                  <Trash2 />
                  <span className="sr-only">Apagar dashboard</span>
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="icon"
              onClick={refreshData}
              aria-label="Atualizar dashboard"
              title="Atualizar dados dos componentes"
            >
              <RefreshCw
                className={
                  Object.values(data).some((state) => state.loading)
                    ? "animate-spin"
                    : undefined
                }
              />
            </Button>
          </div>
        </div>
        <DashboardFilters
          parameters={parameters}
          lookupData={data}
          appliedFilters={filters}
          onApply={(values) => {
            saveDashboardFilters(dashboardId, values);
            setFilters(values);
          }}
        />
        {hasStaleDataErrors && (
          <Alert>
            <AlertCircle />
            <AlertTitle>Alguns dados não foram atualizados</AlertTitle>
            <AlertDescription>
              Os últimos resultados continuam visíveis. Revise as consultas com
              erro ou tente atualizar novamente.
            </AlertDescription>
          </Alert>
        )}
        {editError && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Não foi possível editar o layout</AlertTitle>
            <AlertDescription>{editError}</AlertDescription>
          </Alert>
        )}
        <DashboardGrid
          components={editing ? editing.draft : dashboard.definition.components}
          onEdit={
            editing ? (draft) => setEditing({ ...editing, draft }) : undefined
          }
          renderComponent={(component) => (
            <DashboardComponentView
              component={component}
              state={data[component.queryUuid]}
            />
          )}
          empty={
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                <Table2 />
                Este dashboard ainda não possui componentes.
              </CardContent>
            </Card>
          }
        />
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Apagar este dashboard?</AlertDialogTitle>
              <AlertDialogDescription>
                O dashboard “{dashboard.name}” e o acesso dos usuários a ele
                serão removidos. As queries e as fontes de dados não são
                afetadas. Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={deleting}
                onClick={(event) => {
                  event.preventDefault();
                  void deleteDashboard();
                }}
              >
                {deleting ? "Apagando…" : "Apagar dashboard"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <DashboardUsersDialog
          dashboardId={dashboardId}
          open={usersDialogOpen}
          onOpenChange={setUsersDialogOpen}
          onSaved={refreshData}
        />
      </div>
    </div>
  );
}
