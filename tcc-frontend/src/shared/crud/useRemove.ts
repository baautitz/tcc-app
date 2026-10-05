import { toast } from "@/shared/ui/toast";
import { useImperativeUI } from "@/context/ImperativeUIContext";
import { errorMessage } from "@/lib/errors";

/** Confirmação + exclusão + toast + recarga da lista. */
export function useRemove(reload: () => Promise<void>) {
  const { confirm } = useImperativeUI();
  return async (
    label: string,
    action: () => Promise<void>,
    description = "Esta operação não pode ser desfeita.",
  ) => {
    if (
      !(await confirm({
        title: `Excluir ${label}?`,
        description,
        confirmLabel: "Excluir",
        destructive: true,
      }))
    ) {
      return;
    }
    try {
      await action();
      toast.success("Registro excluído.");
      await reload();
    } catch (reason) {
      toast.error(errorMessage(reason));
    }
  };
}
