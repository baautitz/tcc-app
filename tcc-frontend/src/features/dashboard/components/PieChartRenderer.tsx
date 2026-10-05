import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent } from "@/shared/ui/card";
import { formatValue } from "@/lib/utils";
import { colors } from "../lib";
import { chartEmptyMessage, chartRowsFor } from "./ChartRows";
import { ComponentError, ComponentPreviewHeader } from "./ComponentFrame";
import type { Renderer } from "./renderers";

export const PieChartRenderer: Renderer = ({ component, rows, cardClassName, changeStatus }) => {
  const { nameKey, valueKey, chartRows } = chartRowsFor(component, rows);
  if (chartRows.length === 0)
    return (
      <ComponentError
        component={component}
        message={chartEmptyMessage(rows, nameKey, valueKey)}
        changeStatus={changeStatus}
      />
    );
  const rankedRows = chartRows
    .map((row, index) => ({ row, rank: Number(row.ranking ?? index + 1) }))
    .filter(
      (item) =>
        Number.isInteger(item.rank) && item.rank > 0 && item.rank <= 5,
    )
    .sort((left, right) => left.rank - right.rank);
  return (
    <Card className={cardClassName}>
      <ComponentPreviewHeader component={component} changeStatus={changeStatus} />
      <CardContent>
        <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,0.8fr)]">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={chartRows}
                dataKey={valueKey}
                nameKey={nameKey}
                outerRadius={96}
              >
                {chartRows.map((row, index) => (
                  <Cell
                    key={`${String(row[nameKey])}-${index}`}
                    fill={colors[index % colors.length]}
                  />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium">Ranking por vendas</p>
            {rankedRows.map(({ row, rank }) => (
              <div
                key={String(row[nameKey])}
                title={String(row[nameKey])}
                className="grid grid-cols-[1rem_1.5rem_minmax(0,1fr)_auto] items-center gap-2 text-xs"
              >
                <span
                  className="size-2.5"
                  style={{
                    backgroundColor: colors[(rank - 1) % colors.length],
                  }}
                  aria-hidden="true"
                />
                <span className="text-muted-foreground">{rank}.</span>
                <span className="truncate">{String(row[nameKey])}</span>
                <span className="font-medium tabular-nums">
                  {formatValue(
                    typeof row[valueKey] === "string"
                      ? Number(row[valueKey])
                      : row[valueKey],
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
