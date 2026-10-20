import { AlertCircle } from "lucide-react";
import type { DashboardComponent } from "@/modules/dashboards/model/types";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Card, CardContent } from "@/shared/ui/card";
import {
  colClass,
  componentChangeClasses,
} from "@/modules/dashboards/model/lib";
import type {
  DashboardComponentChange,
  QueryState,
} from "@/modules/dashboards/model/types";
import {
  ComponentError,
  ComponentLoading,
  ComponentPreviewHeader,
} from "./ComponentFrame";
import { rendererFor } from "./registry";

export function DashboardComponentView({
  component,
  state,
  changeStatus,
}: {
  component: DashboardComponent;
  state?: QueryState;
  changeStatus?: DashboardComponentChange;
}) {
  const change = componentChangeClasses(changeStatus);
  const cardClassName = [colClass(component), change?.card]
    .filter(Boolean)
    .join(" ");
  if (!state || (state.loading && state.rows === undefined))
    return <ComponentLoading component={component} />;
  if (state.previewPending && state.rows === undefined) {
    return (
      <Card className={cardClassName}>
        <ComponentPreviewHeader
          component={component}
          changeStatus={changeStatus}
        />
        <CardContent>
          <Alert>
            <AlertCircle />
            <AlertTitle>Prévia aguardando filtros</AlertTitle>
            <AlertDescription>{state.previewPending}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }
  if (state.error && state.rows === undefined)
    return (
      <ComponentError
        component={component}
        message={state.error}
        changeStatus={changeStatus}
      />
    );
  const rows = state.rows ?? [];
  if (rows.length === 0) {
    return (
      <Card className={cardClassName}>
        <ComponentPreviewHeader
          component={component}
          changeStatus={changeStatus}
        />
        <CardContent>
          <p className="py-6 text-center text-xs text-muted-foreground">
            Nenhum dado retornado.
          </p>
        </CardContent>
      </Card>
    );
  }
  return rendererFor(component.type)({
    component,
    rows,
    cardClassName,
    changeStatus,
  });
}
