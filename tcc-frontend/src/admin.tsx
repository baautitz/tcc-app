import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Database, FileCode2, KeyRound, Pencil, Plus, RefreshCw, Save, ShieldCheck, Trash2, Users } from "lucide-react";
import { api } from "@/api";
import type { DashboardDefinition, DashboardSummary, DataSource, DataSourceTable, Permission, QuerySummary, SavedQuery, User } from "@/types";
import { useImperativeUI } from "@/context/ImperativeUIContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { MobileCard } from "@/components/ui/mobile-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

type Section = "users" | "permissions" | "sources" | "dashboards" | "queries";
type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
interface JsonObject { [key: string]: JsonValue; }
const blankDefinition = JSON.stringify({ layout: { columns: 12, gap: 16 }, components: [] }, null, 2);
const sectionInfo: Record<Section, { title: string; description: string }> = { users: { title: "Usuários", description: "Identidades e permissões diretas de acesso." }, permissions: { title: "Permissões", description: "Catálogo de permissões disponíveis na plataforma." }, sources: { title: "Servidores PostgreSQL", description: "Fontes de dados externas com acesso somente leitura." }, dashboards: { title: "Dashboards", description: "Contratos JSON que definem os componentes visuais." }, queries: { title: "Queries", description: "Consultas SQL seguras executadas por UUID." } };

function message(reason: Error): string { return reason.message || "A operação falhou."; }
function parseJson(value: string, label: string): JsonObject | JsonObject[] { try { const parsed: unknown = JSON.parse(value); if (typeof parsed !== "object" || parsed === null) throw new Error(); return parsed as JsonObject | JsonObject[]; } catch { throw new Error(`${label} deve conter JSON válido.`); } }
function Actions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) { return <div className="flex justify-end gap-1"><Button variant="ghost" size="icon" onClick={onEdit}><Pencil /><span className="sr-only">Editar</span></Button><Button variant="ghost" size="icon" className="text-destructive" onClick={onDelete}><Trash2 /><span className="sr-only">Excluir</span></Button></div>; }
function LoadingRows({ columns }: { columns: number }) { return <>{Array.from({ length: 4 }, (_, index) => <TableRow key={index}>{Array.from({ length: columns }, (_, cell) => <TableCell key={cell}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>)}</>; }
function SectionHeading({ section, onCreate, onRefresh, onSync, loading }: { section: Section; onCreate: () => void; onRefresh: () => void; onSync?: () => void; loading: boolean }) { const info = sectionInfo[section]; return <div className="flex items-start justify-between gap-4"><div><h1 className="text-xl font-bold tracking-tight md:text-2xl">{info.title}</h1><p className="mt-1 text-sm text-muted-foreground">{info.description}</p></div><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" size="icon" onClick={onRefresh} disabled={loading}><RefreshCw className={loading ? "animate-spin" : undefined} /><span className="sr-only">Atualizar dados</span></Button>{(section === "permissions" || section === "dashboards") && onSync && <Button variant="outline" onClick={onSync} disabled={loading}><RefreshCw /> Sincronizar recipes</Button>}{section !== "permissions" && section !== "dashboards" && <Button onClick={onCreate}><Plus /> Novo</Button>}</div></div>; }

const userSchema = z.object({ name: z.string().trim().min(1, "Informe o nome."), email: z.string().trim().email("Informe um e-mail válido."), password: z.string(), active: z.boolean(), permissionKeys: z.array(z.string()) });
type UserForm = z.infer<typeof userSchema>;
function UserSheet({ user, permissions, open, onOpenChange, onSaved }: { user?: User; permissions: Permission[]; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => Promise<void> }) {
  const form = useForm<UserForm>({ resolver: zodResolver(userSchema), defaultValues: { name: user?.name ?? "", email: user?.email ?? "", password: "", active: user?.active ?? true, permissionKeys: user?.permissions ?? [] } });
  useEffect(() => form.reset({ name: user?.name ?? "", email: user?.email ?? "", password: "", active: user?.active ?? true, permissionKeys: user?.permissions ?? [] }), [user, form, open]);
  const submit = async (values: UserForm) => { try { const body = { name: values.name, email: values.email, active: values.active, permissionKeys: values.permissionKeys, ...(values.password ? { password: values.password } : {}) }; if (user) await api.updateUser(user.id, body); else { if (!values.password) { form.setError("password", { message: "A senha é obrigatória no cadastro." }); return; } await api.createUser(body); } toast.success(user ? "Usuário atualizado." : "Usuário cadastrado."); onOpenChange(false); await onSaved(); } catch (reason) { toast.error(message(reason as Error)); } };
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="right" className="flex flex-col p-0 sm:max-w-xl"><SheetHeader className="border-b p-6"><SheetTitle>{user ? "Editar usuário" : "Novo usuário"}</SheetTitle><SheetDescription>Defina identidade, status e permissões diretas.</SheetDescription></SheetHeader><ScrollArea className="min-h-0 flex-1"><Form {...form}><form id="user-form" onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-6 p-6"><FieldGroup><FormField control={form.control} name="name" render={({ field }) => <FormItem><FormLabel>Nome</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="email" render={({ field }) => <FormItem><FormLabel>E-mail</FormLabel><FormControl><Input {...field} type="email" /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="password" render={({ field }) => <FormItem><FormLabel>{user ? "Nova senha (opcional)" : "Senha inicial"}</FormLabel><FormControl><Input {...field} type="password" placeholder="Mínimo de 8 caracteres" /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="active" render={({ field }) => <FormItem><FormLabel>Usuário ativo</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>} /></FieldGroup><Card><CardHeader><CardTitle>Permissões diretas</CardTitle><CardDescription>Alterações se aplicam imediatamente à próxima requisição protegida.</CardDescription></CardHeader><CardContent className="flex flex-col gap-3">{permissions.map((permission) => <FormField key={permission.id} control={form.control} name="permissionKeys" render={({ field }) => { const checked = field.value.includes(permission.key); return <div className="flex items-center justify-between gap-4 border-b pb-3 last:border-0 last:pb-0"><div className="min-w-0"><p className="font-mono text-xs font-medium">{permission.key}</p><p className="mt-1 text-xs text-muted-foreground">{permission.description ?? permission.name}</p></div><Switch checked={checked} onCheckedChange={(value) => field.onChange(value ? [...field.value, permission.key] : field.value.filter((key) => key !== permission.key))} /></div>; }} />)}</CardContent></Card></form></Form></ScrollArea><SheetFooter className="flex-row justify-end gap-2 border-t bg-popover p-6"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button type="submit" form="user-form"><Save /> Salvar usuário</Button></SheetFooter></SheetContent></Sheet>;
}

const permissionSchema = z.object({ key: z.string().trim().min(1, "Informe a chave."), name: z.string().trim().min(1, "Informe o nome."), description: z.string() });
type PermissionForm = z.infer<typeof permissionSchema>;
function PermissionSheet({ permission, open, onOpenChange, onSaved }: { permission?: Permission; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => Promise<void> }) { const form = useForm<PermissionForm>({ resolver: zodResolver(permissionSchema), defaultValues: { key: permission?.key ?? "", name: permission?.name ?? "", description: permission?.description ?? "" } }); useEffect(() => form.reset({ key: permission?.key ?? "", name: permission?.name ?? "", description: permission?.description ?? "" }), [permission, form, open]); const submit = async (values: PermissionForm) => { try { if (permission) await api.updatePermission(permission.id, { ...values, description: values.description || null }); else await api.createPermission({ ...values, description: values.description || null }); toast.success(permission ? "Permissão atualizada." : "Permissão criada."); onOpenChange(false); await onSaved(); } catch (reason) { toast.error(message(reason as Error)); } }; return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="right" className="flex flex-col p-0 sm:max-w-xl"><SheetHeader className="border-b p-6"><SheetTitle>{permission ? "Editar permissão" : "Nova permissão"}</SheetTitle><SheetDescription>Cadastre uma chave de acesso para atribuição direta aos usuários.</SheetDescription></SheetHeader><ScrollArea className="min-h-0 flex-1"><Form {...form}><form id="permission-form" onSubmit={form.handleSubmit(submit)} className="p-6"><FieldGroup><FormField control={form.control} name="key" render={({ field }) => <FormItem><FormLabel>Chave</FormLabel><FormControl><Input {...field} disabled={permission?.system} placeholder="dashboards:financeiro:view" /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="name" render={({ field }) => <FormItem><FormLabel>Nome</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="description" render={({ field }) => <FormItem><FormLabel>Descrição</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>} /></FieldGroup></form></Form></ScrollArea><SheetFooter className="flex-row justify-end gap-2 border-t bg-popover p-6"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button form="permission-form" type="submit"><Save /> Salvar permissão</Button></SheetFooter></SheetContent></Sheet>; }

const sourceSchema = z.object({ name: z.string().trim().min(1), host: z.string().trim().min(1), port: z.coerce.number().int().min(1).max(65535), databaseName: z.string().trim().min(1), username: z.string().trim().min(1), password: z.string(), context: z.string() });
type SourceForm = z.infer<typeof sourceSchema>;
function SourceSheet({ source, open, onOpenChange, onSaved }: { source?: DataSource; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => Promise<void> }) { const form = useForm<SourceForm>({ resolver: zodResolver(sourceSchema), defaultValues: { name: source?.name ?? "", host: source?.host ?? "", port: source?.port ?? 5432, databaseName: source?.databaseName ?? "", username: source?.username ?? "", password: "", context: source?.context ?? "" } }); const [tables, setTables] = useState<DataSourceTable[]>([]); useEffect(() => { form.reset({ name: source?.name ?? "", host: source?.host ?? "", port: source?.port ?? 5432, databaseName: source?.databaseName ?? "", username: source?.username ?? "", password: "", context: source?.context ?? "" }); if (source && open) api.dataSource(source.id).then((detail) => setTables(detail.tables)).catch((reason: Error) => toast.error(reason.message)); else setTables([]); }, [source, form, open]); const submit = async (values: SourceForm) => { try { const body = { ...values, ...(values.password ? { password: values.password } : {}) }; if (source) await api.updateDataSource(source.id, body); else { if (!values.password) { form.setError("password", { message: "A senha é obrigatória no cadastro." }); return; } await api.createDataSource(body); } toast.success(source ? "Servidor atualizado e validado." : "Servidor validado e salvo."); onOpenChange(false); await onSaved(); } catch (reason) { toast.error(message(reason as Error)); } }; const saveContext = async (table: DataSourceTable, context: string) => { if (!source || context === table.context) return; try { const updated = await api.updateTableContext(source.id, table.id, context); setTables((items) => items.map((item) => item.id === updated.id ? updated : item)); toast.success("Contexto da tabela salvo."); } catch (reason) { toast.error(message(reason as Error)); } }; return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="right" className="flex flex-col p-0 sm:max-w-xl"><SheetHeader className="border-b p-6"><SheetTitle>{source ? "Editar servidor PostgreSQL" : "Novo servidor PostgreSQL"}</SheetTitle><SheetDescription>O servidor é testado e validado pelo backend com privilégios somente leitura.</SheetDescription></SheetHeader><ScrollArea className="min-h-0 flex-1"><Form {...form}><form id="source-form" onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-6 p-6"><FieldGroup className="grid grid-cols-1 md:grid-cols-2"><FormField control={form.control} name="name" render={({ field }) => <FormItem><FormLabel>Nome</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="host" render={({ field }) => <FormItem><FormLabel>Host</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="port" render={({ field }) => <FormItem><FormLabel>Porta</FormLabel><FormControl><Input {...field} type="number" onChange={(event) => field.onChange(event.target.valueAsNumber)} /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="databaseName" render={({ field }) => <FormItem><FormLabel>Banco</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="username" render={({ field }) => <FormItem><FormLabel>Usuário</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="password" render={({ field }) => <FormItem><FormLabel>{source ? "Senha (deixe vazia para manter)" : "Senha"}</FormLabel><FormControl><Input {...field} type="password" /></FormControl><FormMessage /></FormItem>} /></FieldGroup><FormField control={form.control} name="context" render={({ field }) => <FormItem><FormLabel>Contexto geral</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>} />{source && <Card><CardHeader><CardTitle>Contextos de tabelas</CardTitle><CardDescription>Descreva cada tabela catalogada para apoiar a criação de queries.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">{tables.length ? tables.map((table) => <TableContextEditor key={table.id} table={table} onSave={saveContext} />) : <p className="text-xs text-muted-foreground">Nenhuma tabela catalogada.</p>}</CardContent></Card>}</form></Form></ScrollArea><SheetFooter className="flex-row justify-end gap-2 border-t bg-popover p-6"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button form="source-form" type="submit"><Database /> Testar e salvar</Button></SheetFooter></SheetContent></Sheet>; }
function TableContextEditor({ table, onSave }: { table: DataSourceTable; onSave: (table: DataSourceTable, context: string) => Promise<void> }) { const [context, setContext] = useState(table.context); useEffect(() => setContext(table.context), [table.context]); return <div className="flex flex-col gap-2 border-b pb-4 last:border-0"><p className="font-mono text-xs font-medium">{table.schemaName}.{table.tableName}</p><Textarea value={context} onChange={(event) => setContext(event.target.value)} /><div><Button variant="outline" onClick={() => void onSave(table, context)}>Salvar contexto</Button></div></div>; }

const dashboardSchema = z.object({ name: z.string().trim().min(1), description: z.string(), definition: z.string().min(1) });
type DashboardForm = z.infer<typeof dashboardSchema>;
function DashboardSheet({ dashboard, open, onOpenChange, onSaved }: { dashboard?: DashboardSummary & { definition: DashboardDefinition }; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => Promise<void> }) { const form = useForm<DashboardForm>({ resolver: zodResolver(dashboardSchema), defaultValues: { name: dashboard?.name ?? "", description: dashboard?.description ?? "", definition: dashboard ? JSON.stringify(dashboard.definition, null, 2) : blankDefinition } }); useEffect(() => form.reset({ name: dashboard?.name ?? "", description: dashboard?.description ?? "", definition: dashboard ? JSON.stringify(dashboard.definition, null, 2) : blankDefinition }), [dashboard, form, open]); const submit = async (values: DashboardForm) => { try { const definition = parseJson(values.definition, "A definição do dashboard") as DashboardDefinition; const body = { name: values.name, description: values.description || null, definition }; if (dashboard) await api.updateDashboard(dashboard.id, body); else await api.createDashboard(body); toast.success(dashboard ? "Dashboard atualizado." : "Dashboard criado."); onOpenChange(false); await onSaved(); } catch (reason) { toast.error(message(reason as Error)); } }; return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="right" className="flex flex-col p-0 sm:max-w-xl"><SheetHeader className="border-b p-6"><SheetTitle>{dashboard ? "Editar dashboard" : "Novo dashboard"}</SheetTitle><SheetDescription>Defina o contrato JSON SDUI. Os componentes apontam apenas para UUIDs de queries.</SheetDescription></SheetHeader><ScrollArea className="min-h-0 flex-1"><Form {...form}><form id="dashboard-form" onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-6 p-6"><FieldGroup><FormField control={form.control} name="name" render={({ field }) => <FormItem><FormLabel>Nome</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="description" render={({ field }) => <FormItem><FormLabel>Descrição</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="definition" render={({ field }) => <FormItem><FormLabel>Contrato JSON</FormLabel><FormControl><Textarea {...field} className="min-h-96" spellCheck={false} /></FormControl><FormMessage /></FormItem>} /></FieldGroup></form></Form></ScrollArea><SheetFooter className="flex-row justify-end gap-2 border-t bg-popover p-6"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button form="dashboard-form" type="submit"><Save /> Salvar dashboard</Button></SheetFooter></SheetContent></Sheet>; }

const querySchema = z.object({ dashboardId: z.string().min(1, "Selecione o dashboard."), dataSourceId: z.string().min(1, "Selecione o servidor."), name: z.string().trim().min(1), sqlText: z.string().trim().min(1), parameters: z.string().min(1), requiredPermissionKeys: z.string().min(1) });
type QueryForm = z.infer<typeof querySchema>;
function QuerySheet({ query, dashboards, sources, open, onOpenChange, onSaved }: { query?: SavedQuery; dashboards: Array<DashboardSummary & { definition: DashboardDefinition }>; sources: DataSource[]; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => Promise<void> }) { const form = useForm<QueryForm>({ resolver: zodResolver(querySchema), defaultValues: { dashboardId: query?.dashboardId ?? "", dataSourceId: query?.dataSourceId ?? "", name: query?.name ?? "", sqlText: query?.sqlText ?? "SELECT 1 AS valor", parameters: JSON.stringify(query?.parameters ?? [], null, 2), requiredPermissionKeys: JSON.stringify(query?.requiredPermissionKeys ?? [], null, 2) } }); const [testValues, setTestValues] = useState("{}"); const [testResult, setTestResult] = useState(""); useEffect(() => { form.reset({ dashboardId: query?.dashboardId ?? "", dataSourceId: query?.dataSourceId ?? "", name: query?.name ?? "", sqlText: query?.sqlText ?? "SELECT 1 AS valor", parameters: JSON.stringify(query?.parameters ?? [], null, 2), requiredPermissionKeys: JSON.stringify(query?.requiredPermissionKeys ?? [], null, 2) }); setTestValues("{}"); setTestResult(""); }, [query, form, open]); const submit = async (values: QueryForm) => { try { const body = { ...values, parameters: parseJson(values.parameters, "Os parâmetros"), requiredPermissionKeys: parseJson(values.requiredPermissionKeys, "As permissões obrigatórias") }; if (query) await api.updateQuery(query.id, body); else await api.createQuery(body); toast.success(query ? "Query atualizada." : "Query criada."); onOpenChange(false); await onSaved(); } catch (reason) { toast.error(message(reason as Error)); } }; const test = async () => { if (!query) return; try { const raw = parseJson(testValues, "Os valores de teste"); if (Array.isArray(raw)) throw new Error("Os valores de teste devem ser um objeto JSON."); const parameters = Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string")); const result = await api.testQuery(query.id, parameters); setTestResult(JSON.stringify(result.rows, null, 2)); toast.success("Query executada com sucesso."); } catch (reason) { const text = message(reason as Error); setTestResult(text); toast.error(text); } }; return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="right" className="flex flex-col p-0 sm:max-w-xl"><SheetHeader className="border-b p-6"><SheetTitle>{query ? "Editar query" : "Nova query"}</SheetTitle><SheetDescription>O backend aceita somente uma consulta SELECT parametrizada e valida a permissão de execução.</SheetDescription></SheetHeader><ScrollArea className="min-h-0 flex-1"><Form {...form}><form id="query-form" onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-6 p-6"><FieldGroup><FormField control={form.control} name="dashboardId" render={({ field }) => <FormItem><FormLabel>Dashboard</FormLabel><FormControl><Select {...field}><option value="">Selecione</option>{dashboards.map((dashboard) => <option key={dashboard.id} value={dashboard.id}>{dashboard.name}</option>)}</Select></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="dataSourceId" render={({ field }) => <FormItem><FormLabel>Servidor</FormLabel><FormControl><Select {...field}><option value="">Selecione</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</Select></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="name" render={({ field }) => <FormItem><FormLabel>Nome</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="sqlText" render={({ field }) => <FormItem><FormLabel>SQL SELECT</FormLabel><FormControl><Textarea {...field} className="min-h-48" spellCheck={false} /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="parameters" render={({ field }) => <FormItem><FormLabel>Parâmetros JSON</FormLabel><FormControl><Textarea {...field} spellCheck={false} /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="requiredPermissionKeys" render={({ field }) => <FormItem><FormLabel>Permissões obrigatórias JSON</FormLabel><FormControl><Textarea {...field} spellCheck={false} /></FormControl><FormMessage /></FormItem>} /></FieldGroup>{query && <Card><CardHeader><CardTitle>Teste da query</CardTitle><CardDescription>Informe os parâmetros em JSON e execute com a validação do backend.</CardDescription></CardHeader><CardContent className="flex flex-col gap-3"><Textarea value={testValues} onChange={(event) => setTestValues(event.target.value)} spellCheck={false} /><div><Button variant="outline" onClick={() => void test()}><FileCode2 /> Testar query</Button></div>{testResult && <pre className="max-h-60 overflow-auto border bg-muted p-3 text-xs">{testResult}</pre>}</CardContent></Card>}</form></Form></ScrollArea><SheetFooter className="flex-row justify-end gap-2 border-t bg-popover p-6"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button form="query-form" type="submit"><Save /> Salvar query</Button></SheetFooter></SheetContent></Sheet>; }

function AdminPage() { const isMobile = useIsMobile(); const { confirm } = useImperativeUI(); const [section, setSection] = useState<Section>("users"); const [loading, setLoading] = useState(true); const [error, setError] = useState<string>(); const [users, setUsers] = useState<User[]>([]); const [permissions, setPermissions] = useState<Permission[]>([]); const [sources, setSources] = useState<DataSource[]>([]); const [dashboards, setDashboards] = useState<Array<DashboardSummary & { definition: DashboardDefinition }>>([]); const [queries, setQueries] = useState<QuerySummary[]>([]); const [userSheet, setUserSheet] = useState<{ open: boolean; value?: User }>({ open: false }); const [permissionSheet, setPermissionSheet] = useState<{ open: boolean; value?: Permission }>({ open: false }); const [sourceSheet, setSourceSheet] = useState<{ open: boolean; value?: DataSource }>({ open: false }); const [dashboardSheet, setDashboardSheet] = useState<{ open: boolean; value?: DashboardSummary & { definition: DashboardDefinition } }>({ open: false }); const [querySheet, setQuerySheet] = useState<{ open: boolean; value?: SavedQuery }>({ open: false });
  const load = async () => { try { setLoading(true); setError(undefined); const [nextUsers, nextPermissions, nextSources, nextDashboards, nextQueries] = await Promise.all([api.users(), api.permissions(), api.dataSources(), api.adminDashboards(), api.queries()]); setUsers(nextUsers); setPermissions(nextPermissions); setSources(nextSources); setDashboards(nextDashboards); setQueries(nextQueries); } catch (reason) { setError(message(reason as Error)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const remove = async (label: string, action: () => Promise<void>) => { if (!(await confirm({ title: `Excluir ${label}?`, description: "Esta operação não pode ser desfeita.", confirmLabel: "Excluir", destructive: true }))) return; try { await action(); toast.success("Registro excluído."); await load(); } catch (reason) { toast.error(message(reason as Error)); } };
  const editQuery = async (id: string) => { try { setQuerySheet({ open: true }); const result = await api.savedQuery(id); setQuerySheet({ open: true, value: result }); } catch (reason) { toast.error(message(reason as Error)); setQuerySheet({ open: false }); } };
  const create = () => { if (section === "users") setUserSheet({ open: true }); if (section === "permissions") setPermissionSheet({ open: true }); if (section === "sources") setSourceSheet({ open: true }); if (section === "dashboards") setDashboardSheet({ open: true }); if (section === "queries") setQuerySheet({ open: true }); };
  return <div className="flex flex-col gap-6"><SectionHeading section={section} onCreate={create} onRefresh={() => void load()} loading={loading} />{error && <Alert variant="destructive"><AlertTitle>Falha ao carregar administração</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}<Tabs value={section} onValueChange={(value) => setSection(value as Section)}><TabsList><TabsTrigger value="users">Usuários</TabsTrigger><TabsTrigger value="permissions">Permissões</TabsTrigger><TabsTrigger value="sources">Servidores</TabsTrigger><TabsTrigger value="dashboards">Dashboards</TabsTrigger><TabsTrigger value="queries">Queries</TabsTrigger></TabsList><TabsContent value="users"><UsersRecords users={users} loading={loading} isMobile={isMobile} onEdit={(value) => setUserSheet({ open: true, value })} onDelete={(value) => void remove(value.name, () => api.deleteUser(value.id))} /></TabsContent><TabsContent value="permissions"><PermissionsRecords permissions={permissions} loading={loading} isMobile={isMobile} onEdit={(value) => setPermissionSheet({ open: true, value })} onDelete={(value) => void remove(value.key, () => api.deletePermission(value.id))} /></TabsContent><TabsContent value="sources"><SourcesRecords sources={sources} loading={loading} isMobile={isMobile} onEdit={(value) => setSourceSheet({ open: true, value })} onDelete={(value) => void remove(value.name, () => api.deleteDataSource(value.id))} /></TabsContent><TabsContent value="dashboards"><DashboardsRecords dashboards={dashboards} loading={loading} isMobile={isMobile} onEdit={(value) => setDashboardSheet({ open: true, value })} onDelete={(value) => void remove(value.name, () => api.deleteDashboard(value.id))} /></TabsContent><TabsContent value="queries"><QueriesRecords queries={queries} loading={loading} isMobile={isMobile} onEdit={(id) => void editQuery(id)} onDelete={(value) => void remove(value.name, () => api.deleteQuery(value.id))} /></TabsContent></Tabs><UserSheet user={userSheet.value} permissions={permissions} open={userSheet.open} onOpenChange={(open) => setUserSheet((current) => ({ ...current, open }))} onSaved={load} /><PermissionSheet permission={permissionSheet.value} open={permissionSheet.open} onOpenChange={(open) => setPermissionSheet((current) => ({ ...current, open }))} onSaved={load} /><SourceSheet source={sourceSheet.value} open={sourceSheet.open} onOpenChange={(open) => setSourceSheet((current) => ({ ...current, open }))} onSaved={load} /><DashboardSheet dashboard={dashboardSheet.value} open={dashboardSheet.open} onOpenChange={(open) => setDashboardSheet((current) => ({ ...current, open }))} onSaved={load} /><QuerySheet query={querySheet.value} dashboards={dashboards} sources={sources} open={querySheet.open} onOpenChange={(open) => setQuerySheet((current) => ({ ...current, open }))} onSaved={load} /></div>; }
function UsersRecords({ users, loading, isMobile, onEdit, onDelete }: { users: User[]; loading: boolean; isMobile: boolean; onEdit: (user: User) => void; onDelete: (user: User) => void }) { return <Card><CardHeader><CardTitle className="flex items-center gap-2"><Users /> Usuários cadastrados</CardTitle></CardHeader><CardContent>{isMobile ? <div className="flex flex-col gap-3">{loading ? <Skeleton className="h-36" /> : users.map((user) => <MobileCard key={user.id} primary={user.name} secondary={user.email} fields={[{ label: "Status", value: user.active ? "Ativo" : "Inativo" }, { label: "Permissões", value: String(user.permissions.length) }]} actions={<Actions onEdit={() => onEdit(user)} onDelete={() => onDelete(user)} />} />)}</div> : <Table><TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>E-mail</TableHead><TableHead>Status</TableHead><TableHead>Permissões</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader><TableBody>{loading ? <LoadingRows columns={5} /> : users.map((user) => <TableRow key={user.id}><TableCell className="font-medium">{user.name}</TableCell><TableCell>{user.email}</TableCell><TableCell><Badge variant={user.active ? "secondary" : "outline"}>{user.active ? "Ativo" : "Inativo"}</Badge></TableCell><TableCell>{user.permissions.length}</TableCell><TableCell><Actions onEdit={() => onEdit(user)} onDelete={() => onDelete(user)} /></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>; }
function PermissionsRecords({ permissions, loading, isMobile, onEdit: _onEdit, onDelete: _onDelete }: { permissions: Permission[]; loading: boolean; isMobile: boolean; onEdit?: (permission: Permission) => void; onDelete?: (permission: Permission) => void }) { return <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck /> Permissões do sistema</CardTitle><CardDescription>Catálogo sincronizado pelas recipes. Não há edição manual nesta tela.</CardDescription></CardHeader><CardContent>{isMobile ? <div className="flex flex-col gap-3">{loading ? <Skeleton className="h-36" /> : permissions.map((permission) => <MobileCard key={permission.id} primary={permission.name} secondary={permission.key} fields={[{ label: "Tipo", value: "Sistema" }]} />)}</div> : <Table><TableHeader><TableRow><TableHead>Chave</TableHead><TableHead>Nome</TableHead><TableHead>Descrição</TableHead><TableHead>Tipo</TableHead></TableRow></TableHeader><TableBody>{loading ? <LoadingRows columns={4} /> : permissions.map((permission) => <TableRow key={permission.id}><TableCell className="font-mono">{permission.key}</TableCell><TableCell className="font-medium">{permission.name}</TableCell><TableCell className="max-w-80 truncate">{permission.description ?? "—"}</TableCell><TableCell><Badge variant="secondary">Sistema</Badge></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>; }
function SourcesRecords({ sources, loading, isMobile, onEdit, onDelete }: { sources: DataSource[]; loading: boolean; isMobile: boolean; onEdit: (source: DataSource) => void; onDelete: (source: DataSource) => void }) { return <Card><CardHeader><CardTitle className="flex items-center gap-2"><Database /> Servidores cadastrados</CardTitle></CardHeader><CardContent>{isMobile ? <div className="flex flex-col gap-3">{loading ? <Skeleton className="h-36" /> : sources.map((source) => <MobileCard key={source.id} primary={source.name} secondary={`${source.username}@${source.host}`} fields={[{ label: "Banco", value: source.databaseName }, { label: "Porta", value: String(source.port) }]} actions={<Actions onEdit={() => onEdit(source)} onDelete={() => onDelete(source)} />} />)}</div> : <Table><TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Conexão</TableHead><TableHead>Banco</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader><TableBody>{loading ? <LoadingRows columns={4} /> : sources.map((source) => <TableRow key={source.id}><TableCell className="font-medium">{source.name}</TableCell><TableCell className="font-mono">{source.username}@{source.host}:{source.port}</TableCell><TableCell>{source.databaseName}</TableCell><TableCell><Actions onEdit={() => onEdit(source)} onDelete={() => onDelete(source)} /></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>; }
function DashboardsRecords({ dashboards, loading, isMobile, onEdit, onDelete }: { dashboards: Array<DashboardSummary & { definition: DashboardDefinition }>; loading: boolean; isMobile: boolean; onEdit: (dashboard: DashboardSummary & { definition: DashboardDefinition }) => void; onDelete: (dashboard: DashboardSummary & { definition: DashboardDefinition }) => void }) { return <Card><CardHeader><CardTitle>Dashboards sincronizados</CardTitle><CardDescription>Dashboards gerados pelas recipes. O contrato SDUI é mantido pela sincronização.</CardDescription></CardHeader><CardContent>{isMobile ? <div className="flex flex-col gap-3">{loading ? <Skeleton className="h-36" /> : dashboards.map((dashboard) => <MobileCard key={dashboard.id} primary={dashboard.name} secondary={dashboard.id} fields={[{ label: "Componentes", value: String(dashboard.definition.components.length) }]} actions={dashboard.recipeId ? undefined : <Actions onEdit={() => onEdit(dashboard)} onDelete={() => onDelete(dashboard)} />} />)}</div> : <Table><TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Descrição</TableHead><TableHead>Componentes</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader><TableBody>{loading ? <LoadingRows columns={4} /> : dashboards.map((dashboard) => <TableRow key={dashboard.id}><TableCell className="font-medium">{dashboard.name}</TableCell><TableCell>{dashboard.description ?? "—"}</TableCell><TableCell>{dashboard.definition.components.length}</TableCell><TableCell>{dashboard.recipeId ? null : <Actions onEdit={() => onEdit(dashboard)} onDelete={() => onDelete(dashboard)} />}</TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>; }
function QueriesRecords({ queries, loading, isMobile, onEdit, onDelete }: { queries: QuerySummary[]; loading: boolean; isMobile: boolean; onEdit: (id: string) => void; onDelete: (query: QuerySummary) => void }) { return <Card><CardHeader><CardTitle>Queries salvas</CardTitle></CardHeader><CardContent>{isMobile ? <div className="flex flex-col gap-3">{loading ? <Skeleton className="h-36" /> : queries.map((query) => <MobileCard key={query.id} primary={query.name} secondary={query.id} fields={[{ label: "Parâmetros", value: String(query.parameters.length) }, { label: "Permissões", value: String(query.requiredPermissionKeys.length) }]} actions={<Actions onEdit={() => onEdit(query.id)} onDelete={() => onDelete(query)} />} />)}</div> : <Table><TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>UUID</TableHead><TableHead>Parâmetros</TableHead><TableHead>Permissões</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader><TableBody>{loading ? <LoadingRows columns={5} /> : queries.map((query) => <TableRow key={query.id}><TableCell className="font-medium">{query.name}</TableCell><TableCell className="font-mono">{query.id}</TableCell><TableCell>{query.parameters.length}</TableCell><TableCell>{query.requiredPermissionKeys.length}</TableCell><TableCell><Actions onEdit={() => onEdit(query.id)} onDelete={() => onDelete(query)} /></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>; }

function AdminSectionPage({ section }: { section: Section }) {
  const isMobile = useIsMobile();
  const { confirm } = useImperativeUI();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [users, setUsers] = useState<User[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [sources, setSources] = useState<DataSource[]>([]);
  const [dashboards, setDashboards] = useState<Array<DashboardSummary & { definition: DashboardDefinition }>>([]);
  const [queries, setQueries] = useState<QuerySummary[]>([]);
  const [userSheet, setUserSheet] = useState<{ open: boolean; value?: User }>({ open: false });
  const [permissionSheet, setPermissionSheet] = useState<{ open: boolean; value?: Permission }>({ open: false });
  const [sourceSheet, setSourceSheet] = useState<{ open: boolean; value?: DataSource }>({ open: false });
  const [dashboardSheet, setDashboardSheet] = useState<{ open: boolean; value?: DashboardSummary & { definition: DashboardDefinition } }>({ open: false });
  const [querySheet, setQuerySheet] = useState<{ open: boolean; value?: SavedQuery }>({ open: false });

  const load = async () => {
    try {
      setLoading(true);
      setError(undefined);
      const [nextUsers, nextPermissions, nextSources, nextDashboards, nextQueries] = await Promise.all([
        api.users(),
        api.permissions(),
        api.dataSources(),
        api.adminDashboards(),
        api.queries(),
      ]);
      setUsers(nextUsers);
      setPermissions(nextPermissions);
      setSources(nextSources);
      setDashboards(nextDashboards);
      setQueries(nextQueries);
    } catch (reason) {
      setError(message(reason as Error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const remove = async (label: string, action: () => Promise<void>) => {
    if (!(await confirm({
      title: `Excluir ${label}?`,
      description: "Esta operação não pode ser desfeita.",
      confirmLabel: "Excluir",
      destructive: true,
    }))) {
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
    if (section === "dashboards") setDashboardSheet({ open: true });
    if (section === "queries") setQuerySheet({ open: true });
  };

  const syncRecipes = async () => {
    try {
      const result = await api.syncRecipes();
      toast.success(`${result.dashboards.dashboards} dashboard(s) e ${result.dashboards.queries} query(s) sincronizado(s).`);
      await load();
    } catch (reason) {
      toast.error(message(reason as Error));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading section={section} onCreate={create} onRefresh={() => void load()} onSync={() => void syncRecipes()} loading={loading} />

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Falha ao carregar administração</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {section === "users" && (
        <UsersRecords users={users} loading={loading} isMobile={isMobile}
          onEdit={(value) => setUserSheet({ open: true, value })}
          onDelete={(value) => void remove(value.name, () => api.deleteUser(value.id))}
        />
      )}
      {section === "permissions" && (
        <PermissionsRecords permissions={permissions} loading={loading} isMobile={isMobile}
          onEdit={(value) => setPermissionSheet({ open: true, value })}
          onDelete={(value) => void remove(value.key, () => api.deletePermission(value.id))}
        />
      )}
      {section === "sources" && (
        <SourcesRecords sources={sources} loading={loading} isMobile={isMobile}
          onEdit={(value) => setSourceSheet({ open: true, value })}
          onDelete={(value) => void remove(value.name, () => api.deleteDataSource(value.id))}
        />
      )}
      {section === "dashboards" && (
        <DashboardsRecords dashboards={dashboards} loading={loading} isMobile={isMobile}
          onEdit={(value) => setDashboardSheet({ open: true, value })}
          onDelete={(value) => void remove(value.name, () => api.deleteDashboard(value.id))}
        />
      )}
      {section === "queries" && (
        <QueriesRecords queries={queries} loading={loading} isMobile={isMobile}
          onEdit={(id) => void editQuery(id)}
          onDelete={(value) => void remove(value.name, () => api.deleteQuery(value.id))}
        />
      )}

      <UserSheet user={userSheet.value} permissions={permissions} open={userSheet.open}
        onOpenChange={(open) => setUserSheet((current) => ({ ...current, open }))} onSaved={load}
      />
      <PermissionSheet permission={permissionSheet.value} open={permissionSheet.open}
        onOpenChange={(open) => setPermissionSheet((current) => ({ ...current, open }))} onSaved={load}
      />
      <SourceSheet source={sourceSheet.value} open={sourceSheet.open}
        onOpenChange={(open) => setSourceSheet((current) => ({ ...current, open }))} onSaved={load}
      />
      <DashboardSheet dashboard={dashboardSheet.value} open={dashboardSheet.open}
        onOpenChange={(open) => setDashboardSheet((current) => ({ ...current, open }))} onSaved={load}
      />
      <QuerySheet query={querySheet.value} dashboards={dashboards} sources={sources} open={querySheet.open}
        onOpenChange={(open) => setQuerySheet((current) => ({ ...current, open }))} onSaved={load}
      />
    </div>
  );
}

export { AdminPage, AdminSectionPage };
