import { Database } from "lucide-react";
import type { DataSource } from "@/modules/data-sources/model/types";
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

export function SourcesTable({
  sources,
  loading,
  isMobile,
  onEdit,
  onDelete,
}: {
  sources: DataSource[];
  loading: boolean;
  isMobile: boolean;
  onEdit: (source: DataSource) => void;
  onDelete: (source: DataSource) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database /> Servidores cadastrados
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isMobile ? (
          <div className="flex flex-col gap-3">
            {loading ? (
              <Skeleton className="h-36" />
            ) : (
              sources.map((source) => (
                <MobileCard
                  key={source.id}
                  primary={source.name}
                  secondary={`${source.username}@${source.host}`}
                  fields={[
                    { label: "Banco", value: source.databaseName },
                    { label: "Porta", value: String(source.port) },
                  ]}
                  actions={
                    <Actions
                      onEdit={() => onEdit(source)}
                      onDelete={() => onDelete(source)}
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
                <TableHead>Conexão</TableHead>
                <TableHead>Banco</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <LoadingRows columns={4} />
              ) : (
                sources.map((source) => (
                  <TableRow key={source.id}>
                    <TableCell className="font-medium">{source.name}</TableCell>
                    <TableCell className="font-mono">
                      {source.username}@{source.host}:{source.port}
                    </TableCell>
                    <TableCell>{source.databaseName}</TableCell>
                    <TableCell>
                      <Actions
                        onEdit={() => onEdit(source)}
                        onDelete={() => onDelete(source)}
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
