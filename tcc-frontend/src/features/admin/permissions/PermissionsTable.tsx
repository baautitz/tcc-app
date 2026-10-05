import { ShieldCheck } from "lucide-react";
import type { Permission } from "@/types";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { MobileCard } from "@/shared/ui/mobile-card";
import { Skeleton } from "@/shared/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";
import { LoadingRows } from "@/shared/crud/CrudTable";

export function PermissionsTable({
  permissions,
  loading,
  isMobile,
  onEdit: _onEdit,
  onDelete: _onDelete,
}: {
  permissions: Permission[];
  loading: boolean;
  isMobile: boolean;
  onEdit?: (permission: Permission) => void;
  onDelete?: (permission: Permission) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck /> Permissões do sistema
        </CardTitle>
        <CardDescription>
          Permissões básicas disponibilizadas pela plataforma.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isMobile ? (
          <div className="flex flex-col gap-3">
            {loading ? (
              <Skeleton className="h-36" />
            ) : (
              permissions.map((permission) => (
                <MobileCard
                  key={permission.id}
                  primary={permission.name}
                  secondary={permission.key}
                  fields={[{ label: "Tipo", value: "Sistema" }]}
                />
              ))
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Chave</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Tipo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <LoadingRows columns={4} />
              ) : (
                permissions.map((permission) => (
                  <TableRow key={permission.id}>
                    <TableCell className="font-mono">
                      {permission.key}
                    </TableCell>
                    <TableCell className="font-medium">
                      {permission.name}
                    </TableCell>
                    <TableCell className="max-w-80 truncate">
                      {permission.description ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">Sistema</Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
