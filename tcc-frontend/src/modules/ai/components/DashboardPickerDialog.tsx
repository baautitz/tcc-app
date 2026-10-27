import { useEffect, useState } from "react";
import { dashboardsApi } from "@/modules/dashboards/api/dashboards.api";
import type { DashboardSummary } from "@/modules/dashboards/model/types";
import { DashboardListPage } from "@/modules/dashboards/pages/DashboardListPage";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { toast } from "@/shared/ui/toast";

/** Seletor do Dashboard ativo: reaproveita a lista de dashboards, sem navegar. */
export function DashboardPickerDialog({
  open,
  busy,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (dashboard: { id: string; name: string }) => void;
}) {
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    let active = true;
    dashboardsApi
      .dashboards()
      .then((list) => {
        if (active) setDashboards(list);
      })
      .catch((reason: Error) => {
        if (active)
          toast.error(
            reason.message || "Não foi possível carregar os dashboards.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Selecionar dashboard</DialogTitle>
          <DialogDescription>
            Escolha o dashboard em que o componente será gerado, ou crie um
            novo.
          </DialogDescription>
        </DialogHeader>
        <DashboardListPage
          dashboards={dashboards}
          loading={loading}
          canCreate
          title="Dashboards"
          actionLabel="Selecionar dashboard"
          actionDisabled={busy}
          onOpen={(id, name) => onSelect({ id, name })}
        />
      </DialogContent>
    </Dialog>
  );
}
