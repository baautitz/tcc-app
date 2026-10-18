import { useEffect } from "react";
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type Resolver,
  type UseFormReturn,
} from "react-hook-form";
import { toast } from "@/shared/ui/toast";
import { errorMessage } from "@/shared/lib/errors";

/**
 * Estado de formulário de entidade: cria o form, reseta ao trocar entidade/abrir
 * e executa o submit com tratamento de erro. `save` retorna a mensagem de sucesso;
 * retornar undefined aborta (ex.: erro de validação definido manualmente).
 */
export function useEntityForm<T extends FieldValues, E>({
  resolver,
  entity,
  open,
  toDefaults,
  save,
  onOpenChange,
  onSaved,
}: {
  resolver: Resolver<T>;
  entity: E | undefined;
  open: boolean;
  toDefaults: (entity: E | undefined) => DefaultValues<T>;
  save: (values: T, form: UseFormReturn<T>) => Promise<string | undefined | void>;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => Promise<void>;
}) {
  const form = useForm<T>({ resolver, defaultValues: toDefaults(entity) });
  useEffect(() => {
    form.reset(toDefaults(entity));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, form, open]);
  const submit = async (values: T) => {
    try {
      const success = await save(values, form);
      if (!success) return;
      toast.success(success);
      onOpenChange(false);
      await onSaved?.();
    } catch (reason) {
      toast.error(errorMessage(reason));
    }
  };
  return { form, submit: form.handleSubmit(submit) };
}
