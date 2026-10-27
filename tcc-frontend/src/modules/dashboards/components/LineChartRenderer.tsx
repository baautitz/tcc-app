import {
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { pivotSeries, propertyString } from "@/modules/dashboards/model/lib";
import { Card, CardContent } from "@/shared/ui/card";
import { chartEmptyMessage, chartRowsFor } from "./ChartRows";
import { ComponentError, ComponentPreviewHeader } from "./ComponentFrame";
import type { Renderer } from "./renderers";

export const LineChartRenderer: Renderer = ({
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
  const seriesKey = propertyString(component, "seriesKey");
  const { data, series } = seriesKey
    ? pivotSeries(chartRows, nameKey, valueKey, seriesKey)
    : {
        data: chartRows,
        series: [{ key: valueKey, label: valueKey }],
      };
  return (
    <Card className={cardClassName}>
      <ComponentPreviewHeader
        component={component}
        changeStatus={changeStatus}
      />
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data}>
            <XAxis
              dataKey={nameKey}
              tickLine={false}
              axisLine={false}
              fontSize={11}
            />
            <YAxis tickLine={false} axisLine={false} fontSize={11} />
            <Tooltip />
            {seriesKey && <Legend />}
            {series.map((serie, index) => (
              <Line
                key={serie.key}
                type="monotone"
                dataKey={serie.key}
                name={serie.label}
                stroke={`var(--chart-${(index % 10) + 1})`}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};
