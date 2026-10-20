import { useEffect, useState, type FormEvent } from "react";
import { BarChart3, Plus } from "lucide-react";
import { dashboardsApi } from "@/modules/dashboards/api/dashboards.api";
import type { DashboardSummary } from "@/modules/dashboards/model/types";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Skeleton } from "@/shared/ui/skeleton";
import { Textarea } from "@/shared/ui/textarea";
import { toast } from "@/shared/ui/toast";

export function DashboardListPage({
  dashboards,
  loading,
  canCreate,
  onOpen,
}: {
  dashboards: DashboardSummary[];
  loading: boolean;
  canCreate: boolean;
  onOpen: (id: string) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (createOpen) {
      // reseta/sincroniza estado local ao mudar a chave do efeito (refatorar mudaria timing)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName("");
      setDescription("");
    }
  }, [createOpen]);

  const createDashboard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const created = await dashboardsApi.createDashboard({
        name: name.trim(),
        description: description.trim(),
      });
      setCreateOpen(false);
      toast.success("Dashboard criado.");
      onOpen(created.id);
    } catch (reason) {
      toast.error(
        reason instanceof Error
          ? reason.message
          : "Não foi possível criar o dashboard.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboards</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dashboards associados ao seu usuário.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus /> Novo dashboard
          </Button>
        )}
      </div>
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-36" />
          ))}
        </div>
      ) : dashboards.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {dashboards.map((dashboard) => (
            <Card key={dashboard.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 />
                  {dashboard.name}
                </CardTitle>
                <CardDescription>
                  {dashboard.description ?? "Sem descrição."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" onClick={() => onOpen(dashboard.id)}>
                  Abrir dashboard
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum dashboard está associado a este usuário.
          </CardContent>
        </Card>
      )}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo dashboard</DialogTitle>
            <DialogDescription>
              Informe o nome e a descrição. O UUID será gerado automaticamente.
            </DialogDescription>
          </DialogHeader>
          <form
            id="create-dashboard-form"
            onSubmit={(event) => void createDashboard(event)}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="create-dashboard-name">Nome</Label>
              <Input
                id="create-dashboard-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={200}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="create-dashboard-description">Descrição</Label>
              <Textarea
                id="create-dashboard-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={2000}
              />
            </div>
          </form>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => setCreateOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              form="create-dashboard-form"
              disabled={saving || !name.trim()}
            >
              <Plus /> {saving ? "Criando…" : "Criar dashboard"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
