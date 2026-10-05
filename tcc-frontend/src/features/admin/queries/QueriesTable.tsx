import type { QuerySummary } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { MobileCard } from "@/shared/ui/mobile-card";
import { Skeleton } from "@/shared/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";
import { Actions, LoadingRows } from "@/shared/crud/CrudTable";

export function QueriesTable({
  queries,
  loading,
  isMobile,
  onEdit,
  onDelete,
}: {
  queries: QuerySummary[];
  loading: boolean;
  isMobile: boolean;
  onEdit: (id: string) => void;
  onDelete: (query: QuerySummary) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Queries salvas</CardTitle>
        <CardDescription>
          Consultas SQL reutilizáveis por dashboard e UUID.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isMobile ? (
          <div className="flex flex-col gap-3">
            {loading ? (
              <Skeleton className="h-36" />
            ) : (
              queries.map((query) => (
                <MobileCard
                  key={query.id}
                  primary={query.name}
                  secondary={query.id}
                  fields={[
                    {
                      label: "Parâmetros",
                      value: String(query.parameters.length),
                    },
                  ]}
                  actions={
                    <Actions
                      onEdit={() => onEdit(query.id)}
                      onDelete={() => onDelete(query)}
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
                <TableHead>UUID</TableHead>
                <TableHead>Parâmetros</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <LoadingRows columns={4} />
              ) : (
                queries.map((query) => (
                  <TableRow key={query.id}>
                    <TableCell className="font-medium">{query.name}</TableCell>
                    <TableCell className="font-mono">{query.id}</TableCell>
                    <TableCell>{query.parameters.length}</TableCell>
                    <TableCell>
                      <Actions
                        onEdit={() => onEdit(query.id)}
                        onDelete={() => onDelete(query)}
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
