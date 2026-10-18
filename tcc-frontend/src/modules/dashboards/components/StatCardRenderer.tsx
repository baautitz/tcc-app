import { Card, CardContent } from "@/shared/ui/card";
import { formatCurrencyValue, formatValue } from "@/shared/lib/utils";
import { propertyString } from "@/modules/dashboards/model/lib";
import { ComponentPreviewHeader } from "./ComponentFrame";
import type { Renderer } from "./renderers";

export const StatCardRenderer: Renderer = ({ component, rows, cardClassName, changeStatus }) => {
  const field =
    propertyString(component, "field") ?? Object.keys(rows[0] ?? {})[0];
  const value = field ? rows[0]?.[field] : undefined;
  const format = propertyString(component, "format");
  return (
    <Card className={cardClassName}>
      <ComponentPreviewHeader component={component} changeStatus={changeStatus} stat />
      <CardContent>
        <p className="text-3xl font-semibold tracking-tight">
          {format === "currency"
            ? formatCurrencyValue(value)
            : formatValue(value)}
        </p>
      </CardContent>
    </Card>
  );
};
