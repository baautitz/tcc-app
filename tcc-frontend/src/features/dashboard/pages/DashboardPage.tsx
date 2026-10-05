import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AlertCircle, RefreshCw, Settings, Table2, Users } from "lucide-react";
import { api } from "@/api";
import type { Dashboard } from "@/types";
import { useAuth } from "@/context/AuthContext";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { useRegisterCurrentViewRefresh } from "@/context/CurrentViewRefreshContext";
import { collectArguments, gapClass, queryArguments } from "../lib";
import type { FilterValues, QueryState } from "../types";
import { DashboardComponentView } from "../components/DashboardComponentView";
import { DashboardFilters } from "../components/DashboardFilters";
import { DashboardUsersDialog } from "../components/DashboardUsersDialog";

export function DashboardPage({
  dashboardId,
  onEditContext,
}: {
  dashboardId: string;
  onEditContext: () => void;
}) {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<Dashboard>();
  const [data, setData] = useState<Record<string, QueryState>>({});
  const [filters, setFilters] = useState<FilterValues>({});
  const [error, setError] = useState<string>();
  const [usersDialogOpen, setUsersDialogOpen] = useState(false);
  const [dataRefreshVersion, setDataRefreshVersion] = useState(0);
  const querySequenceRef = useRef(0);
  const refreshData = useCallback(() => {
    setDataRefreshVersion((version) => version + 1);
    api.dashboard(dashboardId)
      .then(setDashboard)
      .catch((reason: Error) => setError(reason.message));
  }, [dashboardId]);
  useRegisterCurrentViewRefresh(refreshData);

  useEffect(() => {
    let active = true;
    setDashboard(undefined);
    setData({});
    setFilters({});
    setError(undefined);
    api
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

  useEffect(() => {
    if (!dashboard) return;
    const requestSequence = ++querySequenceRef.current;
    const lookupIds = dashboard.definition.workspace.params.flatMap(
      (parameter) => (parameter.lookup ? [parameter.lookup.queryUuid] : []),
    );
    const queryIds = [
      ...new Set([
        ...dashboard.definition.components.map(
          (component) => component.queryUuid,
        ),
        ...lookupIds,
      ]),
    ];
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
    queryIds.forEach((queryId) => {
      api
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
  }, [dashboard, filters, dataRefreshVersion]);

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
  const gridGap = gapClass[dashboard.definition.layout.gap] ?? "gap-4";
  const hasStaleDataErrors = Object.values(data).some(
    (state) => state.error && state.rows !== undefined,
  );
  return (
    <div className="flex flex-col gap-6">
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
          {user?.isAdmin && (
            <>
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
        onApply={setFilters}
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
      <div className={`@container grid grid-cols-12 ${gridGap}`}>
        {dashboard.definition.components.map((component) => (
          <DashboardComponentView
            key={component.id}
            component={component}
            state={data[component.queryUuid]}
          />
        ))}
        {dashboard.definition.components.length === 0 && (
          <Card className="col-span-12">
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
              <Table2 />
              Este dashboard ainda não possui componentes.
            </CardContent>
          </Card>
        )}
      </div>
      <DashboardUsersDialog
        dashboardId={dashboardId}
        open={usersDialogOpen}
        onOpenChange={setUsersDialogOpen}
        onSaved={refreshData}
      />
    </div>
  );
}
