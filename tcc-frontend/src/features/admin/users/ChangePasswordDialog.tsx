import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound } from "lucide-react";
import { api } from "@/api";
import type { User } from "@/types";
import { useEntityForm } from "@/shared/crud/useEntityForm";
import { Button } from "@/shared/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/shared/ui/form";
import { Input } from "@/shared/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";

const changePasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "A senha deve ter no mínimo 8 caracteres.")
      .regex(/[A-Z]/, "A senha deve conter uma letra maiúscula.")
      .regex(/[a-z]/, "A senha deve conter uma letra minúscula.")
      .regex(/[0-9]/, "A senha deve conter um número.")
      .regex(/[^A-Za-z0-9]/, "A senha deve conter um caractere especial."),
    confirmation: z.string(),
  })
  .refine((values) => values.password === values.confirmation, {
    path: ["confirmation"],
    message: "As senhas não coincidem.",
  });
type ChangePasswordForm = z.infer<typeof changePasswordSchema>;
export function ChangePasswordDialog({
  user,
  open,
  onOpenChange,
}: {
  user?: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { form, submit } = useEntityForm<ChangePasswordForm, User>({
    resolver: zodResolver(changePasswordSchema),
    entity: user,
    open,
    toDefaults: () => ({ password: "", confirmation: "" }),
    onOpenChange,
    save: async (values) => {
      if (!user) return;
      await api.updateUser(user.id, { password: values.password });
      return "Senha alterada com sucesso.";
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Alterar senha</DialogTitle>
          <DialogDescription>
            Defina uma nova senha para {user?.name ?? "este usuário"}.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="change-password-form"
            onSubmit={submit}
            className="flex flex-col gap-4"
          >
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nova senha</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      autoComplete="new-password"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirmar nova senha</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      autoComplete="new-password"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
        <DialogFooter>
          <Button
            variant="outline"
            type="button"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button type="submit" form="change-password-form">
            <KeyRound /> Alterar senha
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
