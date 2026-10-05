import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Save } from "lucide-react";
import { api } from "@/api";
import type { Permission } from "@/types";
import { useEntityForm } from "@/shared/crud/useEntityForm";
import { Button } from "@/shared/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/shared/ui/form";
import { Input } from "@/shared/ui/input";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/shared/ui/sheet";
import { FieldGroup } from "@/shared/ui/field";
import { Textarea } from "@/shared/ui/textarea";

const permissionSchema = z.object({
  key: z.string().trim().min(1, "Informe a chave."),
  name: z.string().trim().min(1, "Informe o nome."),
  description: z.string(),
});
type PermissionForm = z.infer<typeof permissionSchema>;
const toDefaults = (permission?: Permission): PermissionForm => ({
  key: permission?.key ?? "",
  name: permission?.name ?? "",
  description: permission?.description ?? "",
});
export function PermissionSheet({
  permission,
  open,
  onOpenChange,
  onSaved,
}: {
  permission?: Permission;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const { form, submit } = useEntityForm<PermissionForm, Permission>({
    resolver: zodResolver(permissionSchema),
    entity: permission,
    open,
    toDefaults,
    onOpenChange,
    onSaved,
    save: async (values) => {
      const body = { ...values, description: values.description || null };
      if (permission) await api.updatePermission(permission.id, body);
      else await api.createPermission(body);
      return permission ? "Permissão atualizada." : "Permissão criada.";
    },
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col p-0 sm:max-w-xl">
        <SheetHeader className="border-b p-6">
          <SheetTitle>
            {permission ? "Editar permissão" : "Nova permissão"}
          </SheetTitle>
          <SheetDescription>
            Cadastre uma chave de acesso para atribuição direta aos usuários.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <Form {...form}>
            <form
              id="permission-form"
              onSubmit={submit}
              className="p-6"
            >
              <FieldGroup>
                <FormField
                  control={form.control}
                  name="key"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Chave</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          disabled={permission?.system}
                          placeholder="queries:financeiro:view"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Descrição</FormLabel>
                      <FormControl>
                        <Textarea {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FieldGroup>
            </form>
          </Form>
        </ScrollArea>
        <SheetFooter className="flex-row justify-end gap-2 border-t bg-popover p-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button form="permission-form" type="submit">
            <Save /> Salvar permissão
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
