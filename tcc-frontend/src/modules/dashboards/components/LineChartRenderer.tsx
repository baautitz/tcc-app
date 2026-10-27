import {
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  colors,
  pivotSeries,
  propertyString,
} from "@/modules/dashboards/model/lib";
import { Card, CardContent } from "@/shared/ui/card";
import { chartTooltipProps } from "./chartTooltip";
import { chartEmptyMessage, chartRowsFor } from "./ChartRows";
import {
  ChartArea,
  ComponentError,
  ComponentPreviewHeader,
} from "./ComponentFrame";
import type { Renderer } from "./renderers";

// Uma série com menos de 2 valores não forma linha; sem ponto ela some.
function isolatedPoints(data: Record<string, unknown>[], key: string) {
  const filled = data.filter(
    (row) => row[key] !== null && row[key] !== undefined,
  );
  return filled.length < 2 ? { r: 3 } : false;
}

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
      <CardContent className="flex min-h-0 flex-1">
        <ChartArea>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <XAxis
                dataKey={nameKey}
                tickLine={false}
                axisLine={false}
                fontSize={11}
              />
              <YAxis tickLine={false} axisLine={false} fontSize={11} />
              <Tooltip {...chartTooltipProps} />
              {seriesKey && <Legend />}
              {series.map((serie, index) => (
                <Line
                  key={serie.key}
                  type="monotone"
                  dataKey={serie.key}
                  name={serie.label}
                  stroke={colors[index % colors.length]}
                  strokeWidth={2}
                  dot={isolatedPoints(data, serie.key)}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartArea>
      </CardContent>
    </Card>
  );
};
