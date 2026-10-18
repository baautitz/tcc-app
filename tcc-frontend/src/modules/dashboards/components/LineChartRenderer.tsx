import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent } from "@/shared/ui/card";
import { chartEmptyMessage, chartRowsFor } from "./ChartRows";
import { ComponentError, ComponentPreviewHeader } from "./ComponentFrame";
import type { Renderer } from "./renderers";

export const LineChartRenderer: Renderer = ({ component, rows, cardClassName, changeStatus }) => {
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
      <ComponentPreviewHeader component={component} changeStatus={changeStatus} />
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartRows}>
            <XAxis
              dataKey={nameKey}
              tickLine={false}
              axisLine={false}
              fontSize={11}
            />
            <YAxis tickLine={false} axisLine={false} fontSize={11} />
            <Tooltip />
            <Line type="monotone" dataKey={valueKey} stroke="var(--chart-1)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};
