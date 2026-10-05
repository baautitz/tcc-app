import { BarChartRenderer } from "./BarChartRenderer";
import { DataTableRenderer } from "./DataTableRenderer";
import { PieChartRenderer } from "./PieChartRenderer";
import { StatCardRenderer } from "./StatCardRenderer";
import type { Renderer } from "./renderers";

const registry: Record<string, Renderer> = {
  stat_card: StatCardRenderer,
  bar_chart: BarChartRenderer,
  pie_chart: PieChartRenderer,
  data_table: DataTableRenderer,
};

// unknown types fall back to the table, as before
export const rendererFor = (type: string): Renderer =>
  registry[type] ?? DataTableRenderer;
