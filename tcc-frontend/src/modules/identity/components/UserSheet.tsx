import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Save } from "lucide-react";
import { identityApi } from "@/modules/identity/api/identity.api";
import type { Permission, User } from "@/modules/identity/model/types";
import { useEntityForm } from "@/shared/crud/useEntityForm";
import { Button } from "@/shared/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/ui/form";
import { Input } from "@/shared/ui/input";
import { ScrollArea } from "@/shared/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { FieldGroup } from "@/shared/ui/field";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Switch } from "@/shared/ui/switch";

const userSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome."),
  email: z.string().trim().email("Informe um e-mail válido."),
  password: z.string(),
  active: z.boolean(),
  permissionKeys: z.array(z.string()),
});
type UserForm = z.infer<typeof userSchema>;
const toDefaults = (user?: User): UserForm => ({
  name: user?.name ?? "",
  email: user?.email ?? "",
  password: "",
  active: user?.active ?? true,
  permissionKeys: user?.permissions ?? [],
});
export function UserSheet({
  user,
  permissions,
  open,
  onOpenChange,
  onSaved,
}: {
  user?: User;
  permissions: Permission[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const { form, submit } = useEntityForm<UserForm, User>({
    resolver: zodResolver(userSchema),
    entity: user,
    open,
    toDefaults,
    onOpenChange,
    onSaved,
    save: async (values, form) => {
      if (user)
        await identityApi.updateUser(user.id, {
          name: values.name,
          email: values.email,
          active: values.active,
          permissionKeys: values.permissionKeys,
        });
      else {
        if (!values.password) {
          form.setError("password", {
            message: "A senha é obrigatória no cadastro.",
          });
          return;
        }
        await identityApi.createUser(values);
      }
      return user ? "Usuário atualizado." : "Usuário cadastrado.";
    },
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col p-0 sm:max-w-xl">
        <SheetHeader className="border-b p-6">
          <SheetTitle>{user ? "Editar usuário" : "Novo usuário"}</SheetTitle>
          <SheetDescription>
            Defina identidade, status e permissões diretas.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <Form {...form}>
            <form
              id="user-form"
              onSubmit={submit}
              className="flex flex-col gap-6 p-6"
            >
              <FieldGroup>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>E-mail</FormLabel>
                      <FormControl>
                        <Input {...field} type="email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {!user && (
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Senha inicial</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="password"
                            autoComplete="new-password"
                            placeholder="Mínimo de 8 caracteres"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <FormField
                  control={form.control}
                  name="active"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Usuário ativo</FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </FieldGroup>
              <Card>
                <CardHeader>
                  <CardTitle>Permissões diretas</CardTitle>
                  <CardDescription>
                    Alterações se aplicam imediatamente à próxima requisição
                    protegida.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {permissions.map((permission) => (
                    <FormField
                      key={permission.id}
                      control={form.control}
                      name="permissionKeys"
                      render={({ field }) => {
                        const checked = field.value.includes(permission.key);
                        return (
                          <div className="flex items-center justify-between gap-4 border-b pb-3 last:border-0 last:pb-0">
                            <div className="min-w-0">
                              <p className="font-mono text-xs font-medium">
                                {permission.key}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {permission.description ?? permission.name}
                              </p>
                            </div>
                            <Switch
                              checked={checked}
                              onCheckedChange={(value) =>
                                field.onChange(
                                  value
                                    ? [...field.value, permission.key]
                                    : field.value.filter(
                                        (key) => key !== permission.key,
                                      ),
                                )
                              }
                            />
                          </div>
                        );
                      }}
                    />
                  ))}
                </CardContent>
              </Card>
            </form>
          </Form>
        </ScrollArea>
        <SheetFooter className="flex-row justify-end gap-2 border-t bg-popover p-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="user-form">
            <Save /> Salvar usuário
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
