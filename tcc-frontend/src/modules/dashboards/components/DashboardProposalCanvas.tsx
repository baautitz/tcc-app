import type { DashboardDefinition } from "@/modules/dashboards/model/types";
import type { DashboardComponentChange } from "@/modules/dashboards/model/types";
import { DashboardComponentView } from "./DashboardComponentView";
import { DashboardGrid } from "./DashboardGrid";

export function DashboardProposalCanvas({
  definition,
  rowsByQuery,
  componentIds,
  componentChanges,
}: {
  definition: DashboardDefinition;
  rowsByQuery: Record<
    string,
    { rows: Record<string, unknown>[]; error?: string; previewPending?: string }
  >;
  componentIds?: string[];
  componentChanges?: Record<string, DashboardComponentChange>;
}) {
  const visibleComponentIds = componentIds ? new Set(componentIds) : undefined;
  const components = definition.components.filter(
    (component) =>
      !visibleComponentIds || visibleComponentIds.has(component.id),
  );
  return (
    <DashboardGrid
      components={components}
      renderComponent={(component) => {
        const preview = rowsByQuery[component.queryUuid];
        return (
          <DashboardComponentView
            component={component}
            changeStatus={componentChanges?.[component.id]}
            state={{
              loading: false,
              ...(preview?.previewPending
                ? { previewPending: preview.previewPending }
                : preview?.error
                  ? { error: preview.error }
                  : { rows: preview?.rows ?? [] }),
            }}
          />
        );
      }}
      empty={
        <p className="text-sm text-muted-foreground">
          Esta proposta não contém componentes para visualizar.
        </p>
      }
    />
  );
}
