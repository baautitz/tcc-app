import { KeyRound, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import { TableCell, TableRow } from "@/shared/ui/table";

export function Actions({
  onEdit,
  onChangePassword,
  onDelete,
}: {
  onEdit: () => void;
  onChangePassword?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="icon" onClick={onEdit}>
        <Pencil />
        <span className="sr-only">Editar</span>
      </Button>
      {onChangePassword && (
        <Button variant="ghost" size="icon" onClick={onChangePassword}>
          <KeyRound />
          <span className="sr-only">Alterar senha</span>
        </Button>
      )}
      {onDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive"
          onClick={onDelete}
        >
          <Trash2 />
          <span className="sr-only">Excluir</span>
        </Button>
      )}
    </div>
  );
}

export function LoadingRows({ columns }: { columns: number }) {
  return (
    <>
      {Array.from({ length: 4 }, (_, index) => (
        <TableRow key={index}>
          {Array.from({ length: columns }, (_, cell) => (
            <TableCell key={cell}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
