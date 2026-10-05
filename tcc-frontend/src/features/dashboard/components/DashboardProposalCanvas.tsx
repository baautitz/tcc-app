import type { DashboardDefinition } from "@/types";
import { gapClass } from "../lib";
import type { DashboardComponentChange } from "../types";
import { DashboardComponentView } from "./DashboardComponentView";

export function DashboardProposalCanvas({
  definition,
  rowsByQuery,
  componentIds,
  componentChanges,
}: {
  definition: DashboardDefinition;
  rowsByQuery: Record<string, { rows: Record<string, unknown>[]; error?: string; previewPending?: string }>;
  componentIds?: string[];
  componentChanges?: Record<string, DashboardComponentChange>;
}) {
  const gridGap = gapClass[definition.layout.gap] ?? "gap-4";
  const visibleComponentIds = componentIds ? new Set(componentIds) : undefined;
  const components = definition.components.filter((component) =>
    !visibleComponentIds || visibleComponentIds.has(component.id),
  );
  return (
    <div className={`@container grid grid-cols-12 ${gridGap}`}>
      {components.length > 0 ? components.map((component) => {
        const preview = rowsByQuery[component.queryUuid];
        return (
          <DashboardComponentView
            key={component.id}
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
      }) : (
        <p className="col-span-12 text-sm text-muted-foreground">
          Esta proposta não contém componentes para visualizar.
        </p>
      )}
    </div>
  );
}
