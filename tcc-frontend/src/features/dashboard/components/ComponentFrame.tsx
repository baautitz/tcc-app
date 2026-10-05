import { AlertCircle } from "lucide-react";
import type { DashboardComponent } from "@/types";
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
import { colClass, componentChangeClasses } from "../lib";
import type { DashboardComponentChange } from "../types";

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

export function ComponentLoading({ component }: { component: DashboardComponent }) {
  return (
    <Card className={colClass(component)}>
      <CardHeader>
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-36 w-full" />
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
    <Card className={[colClass(component), change?.card].filter(Boolean).join(" ")}>
      <ComponentPreviewHeader component={component} changeStatus={changeStatus} />
      <CardContent>
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Dados indisponíveis</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
