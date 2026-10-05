import type { ReactNode } from "react";
import type { DashboardComponent } from "@/types";
import type { DashboardComponentChange } from "../types";

export type RendererProps = {
  component: DashboardComponent;
  rows: Record<string, unknown>[];
  cardClassName: string;
  changeStatus?: DashboardComponentChange;
};
export type Renderer = (props: RendererProps) => ReactNode;
