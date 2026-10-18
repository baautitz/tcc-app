import type { ReactNode } from "react";
import type { DashboardComponent } from "@/modules/dashboards/model/types";
import type { DashboardComponentChange } from "@/modules/dashboards/model/types";

export type RendererProps = {
  component: DashboardComponent;
  rows: Record<string, unknown>[];
  cardClassName: string;
  changeStatus?: DashboardComponentChange;
};
export type Renderer = (props: RendererProps) => ReactNode;
