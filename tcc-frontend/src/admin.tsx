import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Database,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { api, ApiError } from "@/api";
import type {
  DataSource,
  DataSourceTable,
  Permission,
  QuerySummary,
  SavedQuery,
  User,
} from "@/types";
import { useImperativeUI } from "@/context/ImperativeUIContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { MobileCard } from "@/components/ui/mobile-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { QueryEditor } from "@/query-editor";
import { useRegisterCurrentViewRefresh } from "@/context/CurrentViewRefreshContext";

type Section = "users" | "permissions" | "sources" | "queries";
const sectionInfo: Record<Section, { title: string; description: string }> = {
  users: {
    title: "Usuários",
    description: "Identidades e permissões diretas de acesso.",
  },
  permissions: {
    title: "Permissões",
    description: "Catálogo de permissões disponíveis na plataforma.",
  },
  sources: {
    title: "Servidores PostgreSQL",
    description: "Fontes de dados externas com acesso somente leitura.",
  },
  queries: {
    title: "Queries",
    description: "Consultas SQL seguras executadas por UUID.",
  },
};

function message(reason: Error): string {
  return reason.message || "A operação falhou.";
}
function Actions({
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
function LoadingRows({ columns }: { columns: number }) {
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
function SectionHeading({
  section,
  onCreate,
  onRefresh,
  loading,
}: {
  section: Section;
  onCreate: () => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  const info = sectionInfo[section];
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">
          {info.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{info.description}</p>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw className={loading ? "animate-spin" : undefined} />
          <span className="sr-only">Atualizar dados</span>
        </Button>
        {section !== "permissions" && (
          <Button onClick={onCreate}>
            <Plus /> Novo
          </Button>
        )}
      </div>
    </div>
  );
}

const userSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome."),
  email: z.string().trim().email("Informe um e-mail válido."),
  password: z.string(),
  active: z.boolean(),
  permissionKeys: z.array(z.string()),
});
type UserForm = z.infer<typeof userSchema>;
function UserSheet({
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
  const form = useForm<UserForm>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      name: user?.name ?? "",
      email: user?.email ?? "",
      password: "",
      active: user?.active ?? true,
      permissionKeys: user?.permissions ?? [],
    },
  });
  useEffect(
    () =>
      form.reset({
        name: user?.name ?? "",
        email: user?.email ?? "",
        password: "",
        active: user?.active ?? true,
        permissionKeys: user?.permissions ?? [],
      }),
    [user, form, open],
  );
  const submit = async (values: UserForm) => {
    try {
      if (user)
        await api.updateUser(user.id, {
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
        await api.createUser(values);
      }
      toast.success(user ? "Usuário atualizado." : "Usuário cadastrado.");
      onOpenChange(false);
      await onSaved();
    } catch (reason) {
      toast.error(message(reason as Error));
    }
  };
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
              onSubmit={form.handleSubmit(submit)}
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
function ChangePasswordDialog({
  user,
  open,
  onOpenChange,
}: {
  user?: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const form = useForm<ChangePasswordForm>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { password: "", confirmation: "" },
  });
  useEffect(
    () => form.reset({ password: "", confirmation: "" }),
    [form, open, user],
  );
  const submit = async (values: ChangePasswordForm) => {
    if (!user) return;
    try {
      await api.updateUser(user.id, { password: values.password });
      toast.success("Senha alterada com sucesso.");
      onOpenChange(false);
    } catch (reason) {
      toast.error(message(reason as Error));
    }
  };
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
            onSubmit={form.handleSubmit(submit)}
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

const permissionSchema = z.object({
  key: z.string().trim().min(1, "Informe a chave."),
  name: z.string().trim().min(1, "Informe o nome."),
  description: z.string(),
});
type PermissionForm = z.infer<typeof permissionSchema>;
function PermissionSheet({
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
  const form = useForm<PermissionForm>({
    resolver: zodResolver(permissionSchema),
    defaultValues: {
      key: permission?.key ?? "",
      name: permission?.name ?? "",
      description: permission?.description ?? "",
    },
  });
  useEffect(
    () =>
      form.reset({
        key: permission?.key ?? "",
        name: permission?.name ?? "",
        description: permission?.description ?? "",
      }),
    [permission, form, open],
  );
  const submit = async (values: PermissionForm) => {
    try {
      if (permission)
        await api.updatePermission(permission.id, {
          ...values,
          description: values.description || null,
        });
      else
        await api.createPermission({
          ...values,
          description: values.description || null,
        });
      toast.success(permission ? "Permissão atualizada." : "Permissão criada.");
      onOpenChange(false);
      await onSaved();
    } catch (reason) {
      toast.error(message(reason as Error));
    }
  };
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
              onSubmit={form.handleSubmit(submit)}
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

const sourceSchema = z.object({
  name: z.string().trim().min(1),
  host: z.string().trim().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  databaseName: z.string().trim().min(1),
  username: z.string().trim().min(1),
  password: z.string(),
  context: z.string(),
});
type SourceForm = z.infer<typeof sourceSchema>;
function SourceSheet({
  source,
  open,
  onOpenChange,
  onSaved,
}: {
  source?: DataSource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const form = useForm<SourceForm>({
    resolver: zodResolver(sourceSchema),
    defaultValues: {
      name: source?.name ?? "",
      host: source?.host ?? "",
      port: source?.port ?? 5432,
      databaseName: source?.databaseName ?? "",
      username: source?.username ?? "",
      password: "",
      context: source?.context ?? "",
    },
  });
  const [tables, setTables] = useState<DataSourceTable[]>([]);
  const [sourceUpdatedAt, setSourceUpdatedAt] = useState(source?.updatedAt ?? "");
  useEffect(() => {
    setSourceUpdatedAt(source?.updatedAt ?? "");
    form.reset({
      name: source?.name ?? "",
      host: source?.host ?? "",
      port: source?.port ?? 5432,
      databaseName: source?.databaseName ?? "",
      username: source?.username ?? "",
      password: "",
      context: source?.context ?? "",
    });
    if (source && open)
      api
        .dataSource(source.id)
        .then((detail) => {
          setTables(detail.tables);
          setSourceUpdatedAt(detail.updatedAt);
        })
        .catch((reason: Error) => toast.error(reason.message));
    else setTables([]);
  }, [source, form, open]);
  const submit = async (values: SourceForm) => {
    try {
      const { password, ...fields } = values;
      const body = { ...fields, ...(password ? { password } : {}) };
      if (source) await api.updateDataSource(source.id, body);
      else {
        if (!values.password) {
          form.setError("password", {
            message: "A senha é obrigatória no cadastro.",
          });
          return;
        }
        await api.createDataSource(body);
      }
      toast.success(
        source
          ? "Servidor atualizado e validado."
          : "Servidor validado e salvo.",
      );
      onOpenChange(false);
      await onSaved();
    } catch (reason) {
      toast.error(message(reason as Error));
    }
  };
  const saveContext = async (table: DataSourceTable, context: string) => {
    if (!source || context === table.context) return;
    try {
      const updated = await api.updateTableContext(
        source.id,
        table.id,
        context,
        sourceUpdatedAt,
        table.contextVersion,
      );
      setTables((items) =>
        items.map((item) => (item.id === updated.id ? updated : item)),
      );
      toast.success("Contexto da tabela salvo.");
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        try {
          const fresh = await api.dataSource(source.id);
          setSourceUpdatedAt(fresh.updatedAt);
          setTables(fresh.tables);
          toast.error(reason.message.includes("contexto da tabela")
            ? "O contexto desta tabela mudou em outra edição. Os dados foram recarregados; revise antes de salvar novamente."
            : "O servidor mudou enquanto você editava. Os dados foram recarregados; revise o contexto antes de salvar novamente.");
          return;
        } catch (reloadReason) {
          toast.error(
            `${message(reason)} Não foi possível recarregar o servidor: ${message(reloadReason as Error)}`,
          );
          return;
        }
      }
      toast.error(message(reason as Error));
    }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col p-0 sm:max-w-xl">
        <SheetHeader className="border-b p-6">
          <SheetTitle>
            {source ? "Editar servidor PostgreSQL" : "Novo servidor PostgreSQL"}
          </SheetTitle>
          <SheetDescription>
            O servidor é testado e validado pelo backend com privilégios somente
            leitura.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <Form {...form}>
            <form
              id="source-form"
              onSubmit={form.handleSubmit(submit)}
              className="flex flex-col gap-6 p-6"
            >
              <FieldGroup className="grid grid-cols-1 md:grid-cols-2">
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
                  name="host"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Host</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="port"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Porta</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          onChange={(event) =>
                            field.onChange(event.target.valueAsNumber)
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="databaseName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Banco</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Usuário</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {source ? "Senha (deixe vazia para manter)" : "Senha"}
                      </FormLabel>
                      <FormControl>
                        <Input {...field} type="password" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FieldGroup>
              <FormField
                control={form.control}
                name="context"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contexto geral</FormLabel>
                    <FormControl>
                      <Textarea {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {source && (
                <Card>
                  <CardHeader>
                    <CardTitle>Contextos de tabelas</CardTitle>
                    <CardDescription>
                      Descreva cada tabela catalogada para apoiar a criação de
                      queries.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    {tables.length ? (
                      tables.map((table) => (
                        <TableContextEditor
                          key={table.id}
                          table={table}
                          onSave={saveContext}
                        />
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Nenhuma tabela catalogada.
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}
            </form>
          </Form>
        </ScrollArea>
        <SheetFooter className="flex-row justify-end gap-2 border-t bg-popover p-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button form="source-form" type="submit">
            <Database /> Testar e salvar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
function TableContextEditor({
  table,
  onSave,
}: {
  table: DataSourceTable;
  onSave: (table: DataSourceTable, context: string) => Promise<void>;
}) {
  const [context, setContext] = useState(table.context);
  useEffect(() => setContext(table.context), [table.context]);
  return (
    <div className="flex flex-col gap-2 border-b pb-4 last:border-0">
      <p className="font-mono text-xs font-medium">
        {table.schemaName}.{table.tableName}
      </p>
      <Textarea
        value={context}
        onChange={(event) => setContext(event.target.value)}
      />
      <div>
        <Button variant="outline" onClick={() => void onSave(table, context)}>
          Salvar contexto
        </Button>
      </div>
    </div>
  );
}

function UsersRecords({
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
function PermissionsRecords({
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
function SourcesRecords({
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

function QueriesRecords({
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

function AdminSectionPage({ section }: { section: Section }) {
  const isMobile = useIsMobile();
  const { confirm } = useImperativeUI();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [users, setUsers] = useState<User[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [sources, setSources] = useState<DataSource[]>([]);
  const [queries, setQueries] = useState<QuerySummary[]>([]);
  const [userSheet, setUserSheet] = useState<{ open: boolean; value?: User }>({
    open: false,
  });
  const [passwordDialog, setPasswordDialog] = useState<{
    open: boolean;
    value?: User;
  }>({ open: false });
  const [permissionSheet, setPermissionSheet] = useState<{
    open: boolean;
    value?: Permission;
  }>({ open: false });
  const [sourceSheet, setSourceSheet] = useState<{
    open: boolean;
    value?: DataSource;
  }>({ open: false });
  const [querySheet, setQuerySheet] = useState<{
    open: boolean;
    value?: SavedQuery;
  }>({ open: false });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(undefined);
      const [nextUsers, nextPermissions, nextSources, nextQueries] =
        await Promise.all([
          api.users(),
          api.permissions(),
          api.dataSources(),
          api.queries(),
        ]);
      setUsers(nextUsers);
      setPermissions(nextPermissions);
      setSources(nextSources);
      setSourceSheet((current) => current.value
        ? { ...current, value: nextSources.find((source) => source.id === current.value?.id) ?? current.value }
        : current);
      setQueries(nextQueries);
    } catch (reason) {
      setError(message(reason as Error));
    } finally {
      setLoading(false);
    }
  }, []);
  useRegisterCurrentViewRefresh(load);

  useEffect(() => {
    void load();
    const reloadQueries = () => void load();
    window.addEventListener("queries:saved", reloadQueries);
    return () => window.removeEventListener("queries:saved", reloadQueries);
  }, []);

  const remove = async (
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
      await load();
    } catch (reason) {
      toast.error(message(reason as Error));
    }
  };

  const editQuery = async (id: string) => {
    try {
      setQuerySheet({ open: true });
      const result = await api.savedQuery(id);
      setQuerySheet({ open: true, value: result });
    } catch (reason) {
      toast.error(message(reason as Error));
      setQuerySheet({ open: false });
    }
  };

  const create = () => {
    if (section === "users") setUserSheet({ open: true });
    if (section === "permissions") setPermissionSheet({ open: true });
    if (section === "sources") setSourceSheet({ open: true });
    if (section === "queries") setQuerySheet({ open: true });
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        section={section}
        onCreate={create}
        onRefresh={() => void load()}
        loading={loading}
      />

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Falha ao carregar administração</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {section === "users" && (
        <UsersRecords
          users={users}
          loading={loading}
          isMobile={isMobile}
          onEdit={(value) => setUserSheet({ open: true, value })}
          onChangePassword={(value) => setPasswordDialog({ open: true, value })}
          onDelete={(value) =>
            void remove(value.name, () => api.deleteUser(value.id))
          }
        />
      )}
      {section === "permissions" && (
        <PermissionsRecords
          permissions={permissions}
          loading={loading}
          isMobile={isMobile}
          onEdit={(value) => setPermissionSheet({ open: true, value })}
          onDelete={(value) =>
            void remove(value.key, () => api.deletePermission(value.id))
          }
        />
      )}
      {section === "sources" && (
        <SourcesRecords
          sources={sources}
          loading={loading}
          isMobile={isMobile}
          onEdit={(value) => setSourceSheet({ open: true, value })}
          onDelete={(value) =>
            void remove(value.name, () => api.deleteDataSource(value.id))
          }
        />
      )}
      {section === "queries" && (
        <QueriesRecords
          queries={queries}
          loading={loading}
          isMobile={isMobile}
          onEdit={(id) => void editQuery(id)}
          onDelete={(value) =>
            void remove(
              value.name,
              () => api.deleteQuery(value.id),
              "Se a query estiver vinculada a dashboards, os componentes e mapeamentos que dependem dela também serão removidos. Os dashboards serão mantidos.",
            )
          }
        />
      )}

      <UserSheet
        user={userSheet.value}
        permissions={permissions}
        open={userSheet.open}
        onOpenChange={(open) =>
          setUserSheet((current) => ({ ...current, open }))
        }
        onSaved={load}
      />
      <ChangePasswordDialog
        user={passwordDialog.value}
        open={passwordDialog.open}
        onOpenChange={(open) =>
          setPasswordDialog((current) => ({ ...current, open }))
        }
      />
      <PermissionSheet
        permission={permissionSheet.value}
        open={permissionSheet.open}
        onOpenChange={(open) =>
          setPermissionSheet((current) => ({ ...current, open }))
        }
        onSaved={load}
      />
      <SourceSheet
        source={sourceSheet.value}
        open={sourceSheet.open}
        onOpenChange={(open) =>
          setSourceSheet((current) => ({ ...current, open }))
        }
        onSaved={load}
      />
      <QueryEditor
        query={querySheet.value}
        sources={sources}
        open={querySheet.open}
        onOpenChange={(open) =>
          setQuerySheet((current) => ({ ...current, open }))
        }
        onSaved={load}
      />
    </div>
  );
}

export { AdminSectionPage };
