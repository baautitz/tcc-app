import { Users } from "lucide-react";
import type { User } from "@/modules/identity/model/types";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { MobileCard } from "@/shared/ui/mobile-card";
import { Skeleton } from "@/shared/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { Actions, LoadingRows } from "@/shared/crud/CrudTable";

export function UsersTable({
  users,
  loading,
  isMobile,
  onEdit,
  onChangePassword,
  onDelete,
}: {
  users: User[];
  loading: boolean;
  isMobile: boolean;
  onEdit: (user: User) => void;
  onChangePassword?: (user: User) => void;
  onDelete: (user: User) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users /> Usuários cadastrados
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isMobile ? (
          <div className="flex flex-col gap-3">
            {loading ? (
              <Skeleton className="h-36" />
            ) : (
              users.map((user) => (
                <MobileCard
                  key={user.id}
                  primary={user.name}
                  secondary={user.email}
                  fields={[
                    {
                      label: "Status",
                      value: user.active ? "Ativo" : "Inativo",
                    },
                    {
                      label: "Permissões",
                      value: String(user.permissions.length),
                    },
                  ]}
                  actions={
                    <Actions
                      onEdit={() => onEdit(user)}
                      onChangePassword={
                        onChangePassword
                          ? () => onChangePassword(user)
                          : undefined
                      }
                      onDelete={() => onDelete(user)}
                    />
                  }
                />
              ))
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Permissões</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <LoadingRows columns={5} />
              ) : (
                users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={user.active ? "secondary" : "outline"}>
                        {user.active ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell>{user.permissions.length}</TableCell>
                    <TableCell>
                      <Actions
                        onEdit={() => onEdit(user)}
                        onChangePassword={
                          onChangePassword
                            ? () => onChangePassword(user)
                            : undefined
                        }
                        onDelete={() => onDelete(user)}
                      />
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
