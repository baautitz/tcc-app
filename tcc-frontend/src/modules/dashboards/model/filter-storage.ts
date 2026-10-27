import { z } from "zod";
import type { FilterValues } from "./types";

const filtersSchema = z.record(z.union([z.string(), z.array(z.string())]));
const storageKey = (dashboardId: string) => `dashboard-filters:${dashboardId}`;

/** Filtros aplicados da última visita ao dashboard; vazio se não houver ou estiverem inválidos. */
export function loadDashboardFilters(dashboardId: string): FilterValues {
  try {
    const raw = localStorage.getItem(storageKey(dashboardId));
    if (!raw) return {};
    const parsed = filtersSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function saveDashboardFilters(
  dashboardId: string,
  filters: FilterValues,
): void {
  try {
    localStorage.setItem(storageKey(dashboardId), JSON.stringify(filters));
  } catch {
    // Armazenamento indisponível (modo privado, cota): os filtros só não persistem.
  }
}
