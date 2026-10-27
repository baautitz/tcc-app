import { AlertCircle } from "lucide-react";
import type { DashboardComponent } from "@/modules/dashboards/model/types";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { componentChangeClasses } from "@/modules/dashboards/model/lib";
import type { DashboardComponentChange } from "@/modules/dashboards/model/types";

export function ComponentPreviewHeader({
  component,
  changeStatus,
  stat = false,
}: {
  component: DashboardComponent;
  changeStatus?: DashboardComponentChange;
  stat?: boolean;
}) {
  const change = componentChangeClasses(changeStatus);
  return (
    <CardHeader>
      <div className="flex min-w-0 items-start justify-between gap-3">
        {stat ? (
          <CardDescription>{component.title}</CardDescription>
        ) : (
          <CardTitle>{component.title}</CardTitle>
        )}
        {change && (
          <Badge variant="outline" className={`shrink-0 ${change.badge}`}>
            {change.label}
          </Badge>
        )}
      </div>
    </CardHeader>
  );
}

export function ComponentLoading() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-full min-h-12 w-full" />
      </CardContent>
    </Card>
  );
}
export function ComponentError({
  component,
  message,
  changeStatus,
}: {
  component: DashboardComponent;
  message: string;
  changeStatus?: DashboardComponentChange;
}) {
  const change = componentChangeClasses(changeStatus);
  return (
    <Card className={change?.card}>
      <ComponentPreviewHeader
        component={component}
        changeStatus={changeStatus}
      />
      <CardContent className="min-h-0 flex-1 overflow-auto">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Dados indisponíveis</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

/** Área de gráfico que preenche a altura que o Componente ocupa na Grade. */
export function ChartArea({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-0 flex-1">
      <div className="absolute inset-0">{children}</div>
    </div>
  );
}
