import { useEffect, useState } from "react";
import { dashboardsApi } from "@/modules/dashboards/api/dashboards.api";
import type { DashboardUser } from "@/modules/dashboards/model/types";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Label } from "@/shared/ui/label";
import { Skeleton } from "@/shared/ui/skeleton";
import { toast } from "@/shared/ui/toast";

export function DashboardUsersDialog({
  dashboardId,
  open,
  onOpenChange,
  onSaved,
}: {
  dashboardId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [users, setUsers] = useState<DashboardUser[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    // reseta/sincroniza estado local ao mudar a chave do efeito (refatorar mudaria timing)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(undefined);
    dashboardsApi
      .dashboardUsers(dashboardId)
      .then((result) => {
        setUsers(result.users);
        setSelectedIds(result.userIds);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [dashboardId, open]);

  const save = async () => {
    setSaving(true);
    try {
      await dashboardsApi.updateDashboardUsers(dashboardId, selectedIds);
      toast.success("Acesso ao dashboard atualizado.");
      onOpenChange(false);
      onSaved();
    } catch (reason) {
      toast.error(
        reason instanceof Error
          ? reason.message
          : "Não foi possível atualizar os usuários.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Usuários com acesso</DialogTitle>
          <DialogDescription>
            Dashboards sem usuários associados ficam disponíveis somente para
            administradores.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Não foi possível carregar os usuários</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="max-h-[55vh] overflow-y-auto rounded-md border p-3">
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : users.length ? (
            <div className="flex flex-col gap-3">
              {users.map((user) => (
                <Label
                  key={user.id}
                  htmlFor={`dashboard-user-${user.id}`}
                  className="flex cursor-pointer items-center gap-3 text-sm"
                >
                  <Checkbox
                    id={`dashboard-user-${user.id}`}
                    checked={selectedIds.includes(user.id)}
                    onCheckedChange={(checked) =>
                      setSelectedIds((current) =>
                        checked
                          ? [...current, user.id]
                          : current.filter((id) => id !== user.id),
                      )
                    }
                  />
                  <span>
                    {user.name} · {user.email}
                    {user.active ? "" : " (inativo)"}
                  </span>
                </Label>
              ))}
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum usuário cadastrado.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            type="button"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading || Boolean(error)}
          >
            {saving ? "Salvando…" : "Salvar usuários"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
