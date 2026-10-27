import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent } from "@/shared/ui/card";
import { chartTooltipProps } from "./chartTooltip";
import { chartEmptyMessage, chartRowsFor } from "./ChartRows";
import {
  ChartArea,
  ComponentError,
  ComponentPreviewHeader,
} from "./ComponentFrame";
import type { Renderer } from "./renderers";

export const BarChartRenderer: Renderer = ({
  component,
  rows,
  cardClassName,
  changeStatus,
}) => {
  const { nameKey, valueKey, chartRows } = chartRowsFor(component, rows);
  if (chartRows.length === 0)
    return (
      <ComponentError
        component={component}
        message={chartEmptyMessage(rows, nameKey, valueKey)}
        changeStatus={changeStatus}
      />
    );
  return (
    <Card className={cardClassName}>
      <ComponentPreviewHeader
        component={component}
        changeStatus={changeStatus}
      />
      <CardContent className="flex min-h-0 flex-1">
        <ChartArea>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartRows}>
              <XAxis
                dataKey={nameKey}
                tickLine={false}
                axisLine={false}
                fontSize={11}
              />
              <YAxis tickLine={false} axisLine={false} fontSize={11} />
              <Tooltip {...chartTooltipProps} />
              <Bar dataKey={valueKey} fill="var(--chart-1)" radius={0} />
            </BarChart>
          </ResponsiveContainer>
        </ChartArea>
      </CardContent>
    </Card>
  );
};
