import { useEffect, useState } from "react";
import { api } from "./api";
import type { DataSource, DataSourceTable, DashboardDefinition, DashboardSummary, Permission, QuerySummary, SavedQuery, User } from "./types";

type Section = "users" | "permissions" | "sources" | "dashboards" | "queries";

type UserForm = { id?: string; name: string; email: string; password: string; active: boolean; permissionKeys: string[] };
type SourceForm = { id?: string; name: string; host: string; port: number; databaseName: string; username: string; password: string; context: string };
type DashboardForm = { id?: string; name: string; description: string; definition: string };
type QueryForm = { id?: string; dashboardId: string; dataSourceId: string; name: string; sqlText: string; parameters: string; requiredPermissionKeys: string };

const blankUser = (): UserForm => ({ name: "", email: "", password: "", active: true, permissionKeys: [] });
const blankSource = (): SourceForm => ({ name: "", host: "", port: 5432, databaseName: "", username: "", password: "", context: "" });
const blankDashboardDefinition = { layout: { columns: 12, gap: 16 }, components: [] };
const blankDashboard = (): DashboardForm => ({ name: "", description: "", definition: JSON.stringify(blankDashboardDefinition, null, 2) });
const blankQuery = (): QueryForm => ({ dashboardId: "", dataSourceId: "", name: "", sqlText: "SELECT 1 AS valor", parameters: "[]", requiredPermissionKeys: "[]" });

function messageFrom(reason: unknown): string {
  return reason instanceof Error ? reason.message : "A operação falhou.";
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} deve conter JSON válido.`);
  }
}

function FormMessage({ message }: { message?: string }) {
  return message ? <p className="form-message">{message}</p> : null;
}

export function AdminPage() {
  const [section, setSection] = useState<Section>("users");
  const [message, setMessage] = useState<string>();
  const [users, setUsers] = useState<User[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [sources, setSources] = useState<DataSource[]>([]);
  const [dashboards, setDashboards] = useState<Array<DashboardSummary & { definition: DashboardDefinition }>>([]);
  const [queries, setQueries] = useState<QuerySummary[]>([]);
  const [userForm, setUserForm] = useState<UserForm>(blankUser);
  const [sourceForm, setSourceForm] = useState<SourceForm>(blankSource);
  const [dashboardForm, setDashboardForm] = useState<DashboardForm>(blankDashboard);
  const [queryForm, setQueryForm] = useState<QueryForm>(blankQuery);
  const [queryTestParameters, setQueryTestParameters] = useState("{}");
  const [queryTestResult, setQueryTestResult] = useState<string>();
  const [sourceTables, setSourceTables] = useState<DataSourceTable[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>();

  async function loadAll(): Promise<void> {
    try {
      const [loadedUsers, loadedPermissions, loadedSources, loadedDashboards, loadedQueries] = await Promise.all([api.users(), api.permissions(), api.dataSources(), api.adminDashboards(), api.queries()]);
      setUsers(loadedUsers);
      setPermissions(loadedPermissions);
      setSources(loadedSources);
      setDashboards(loadedDashboards);
      setQueries(loadedQueries);
    } catch (reason) {
      setMessage(messageFrom(reason));
    }
  }

  useEffect(() => { void loadAll(); }, []);

  async function saveUser(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      const body = { name: userForm.name, email: userForm.email, active: userForm.active, permissionKeys: userForm.permissionKeys, ...(userForm.password ? { password: userForm.password } : {}) };
      if (userForm.id) await api.updateUser(userForm.id, body);
      else {
        if (!userForm.password) throw new Error("A senha é obrigatória ao criar um usuário.");
        await api.createUser(body);
      }
      setUserForm(blankUser()); setMessage("Usuário salvo."); await loadAll();
    } catch (reason) { setMessage(messageFrom(reason)); }
  }

  async function saveSource(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      const body = { ...sourceForm, ...(sourceForm.password ? { password: sourceForm.password } : {}) };
      if (sourceForm.id) await api.updateDataSource(sourceForm.id, body);
      else {
        if (!sourceForm.password) throw new Error("A senha é obrigatória para testar e cadastrar o servidor.");
        await api.createDataSource(body);
      }
      setSourceForm(blankSource()); setMessage("Servidor validado e salvo."); await loadAll();
    } catch (reason) { setMessage(messageFrom(reason)); }
  }

  async function selectSource(source: DataSource): Promise<void> {
    try {
      const detail = await api.dataSource(source.id);
      setSelectedSource(source.id); setSourceTables(detail.tables);
      setSourceForm({ ...source, password: "" });
    } catch (reason) { setMessage(messageFrom(reason)); }
  }

  async function saveDashboard(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      const body = { name: dashboardForm.name, description: dashboardForm.description || null, definition: parseJson(dashboardForm.definition, "A definição do dashboard") };
      if (dashboardForm.id) await api.updateDashboard(dashboardForm.id, body);
      else await api.createDashboard(body);
      setDashboardForm(blankDashboard()); setMessage("Dashboard salvo. Cadastre as queries e então vincule seus UUIDs no JSON."); await loadAll();
    } catch (reason) { setMessage(messageFrom(reason)); }
  }

  async function saveQuery(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      const body = {
        dashboardId: queryForm.dashboardId,
        dataSourceId: queryForm.dataSourceId,
        name: queryForm.name,
        sqlText: queryForm.sqlText,
        parameters: parseJson(queryForm.parameters, "Os parâmetros"),
        requiredPermissionKeys: parseJson(queryForm.requiredPermissionKeys, "As permissões obrigatórias"),
      };
      if (queryForm.id) await api.updateQuery(queryForm.id, body);
      else await api.createQuery(body);
      setQueryForm(blankQuery()); setMessage("Query salva."); await loadAll();
    } catch (reason) { setMessage(messageFrom(reason)); }
  }

  async function editQuery(id: string): Promise<void> {
    try {
      const query = await api.savedQuery(id);
      setQueryForm({ ...query, parameters: JSON.stringify(query.parameters, null, 2), requiredPermissionKeys: JSON.stringify(query.requiredPermissionKeys, null, 2) });
      setQueryTestParameters("{}");
      setQueryTestResult(undefined);
    } catch (reason) { setMessage(messageFrom(reason)); }
  }

  return <main className="page admin-page"><header className="page-heading"><div><h1>Administração</h1><p>Usuários, permissões, servidores PostgreSQL, dashboards e queries.</p></div></header><nav className="tabs">{(["users", "permissions", "sources", "dashboards", "queries"] as Section[]).map((item) => <button className={section === item ? "active" : ""} onClick={() => setSection(item)} key={item}>{({ users: "Usuários", permissions: "Permissões", sources: "Servidores", dashboards: "Dashboards", queries: "Queries" })[item]}</button>)}</nav><FormMessage message={message} />
    {section === "users" && <section className="admin-grid"><form className="admin-form" onSubmit={saveUser}><h2>{userForm.id ? "Editar usuário" : "Novo usuário"}</h2><label>Nome<input value={userForm.name} required onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} /></label><label>E-mail<input type="email" value={userForm.email} required onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} /></label><label>Senha {userForm.id && "(deixe vazia para manter)"}<input type="password" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} /></label><label className="check"><input type="checkbox" checked={userForm.active} onChange={(event) => setUserForm({ ...userForm, active: event.target.checked })} /> Ativo</label><fieldset><legend>Permissões diretas</legend>{permissions.map((permission) => <label className="check" key={permission.id}><input type="checkbox" checked={userForm.permissionKeys.includes(permission.key)} onChange={(event) => setUserForm({ ...userForm, permissionKeys: event.target.checked ? [...userForm.permissionKeys, permission.key] : userForm.permissionKeys.filter((key) => key !== permission.key) })} /> {permission.key}</label>)}</fieldset><div className="form-actions"><button type="submit">Salvar usuário</button>{userForm.id && <button type="button" className="secondary" onClick={() => setUserForm(blankUser())}>Cancelar</button>}</div></form><section className="records"><h2>Usuários cadastrados</h2>{users.map((user) => <article key={user.id}><strong>{user.name}</strong><span>{user.email} · {user.active ? "ativo" : "inativo"}</span><small>{user.permissions.join(", ") || "Sem permissões"}</small><div><button onClick={() => setUserForm({ ...user, password: "", permissionKeys: user.permissions })}>Editar</button><button className="danger" onClick={() => { if (window.confirm(`Excluir ${user.name}?`)) void api.deleteUser(user.id).then(loadAll).catch((reason: unknown) => setMessage(messageFrom(reason))); }}>Excluir</button></div></article>)}</section></section>}
    {section === "permissions" && <section className="admin-grid"><PermissionForm onSaved={async () => { setMessage("Permissão criada."); await loadAll(); }} /><section className="records"><h2>Catálogo</h2>{permissions.map((permission) => <article key={permission.id}><strong>{permission.key}</strong><span>{permission.name}</span><small>{permission.description}</small>{!permission.system && <button className="danger" onClick={() => { if (window.confirm(`Excluir ${permission.key}?`)) void api.deletePermission(permission.id).then(loadAll).catch((reason: unknown) => setMessage(messageFrom(reason))); }}>Excluir</button>}</article>)}</section></section>}
    {section === "sources" && <section className="admin-grid"><form className="admin-form" onSubmit={saveSource}><h2>{sourceForm.id ? "Editar servidor" : "Novo servidor PostgreSQL"}</h2><label>Nome<input value={sourceForm.name} required onChange={(event) => setSourceForm({ ...sourceForm, name: event.target.value })} /></label><label>Host<input value={sourceForm.host} required onChange={(event) => setSourceForm({ ...sourceForm, host: event.target.value })} /></label><label>Porta<input type="number" value={sourceForm.port} required onChange={(event) => setSourceForm({ ...sourceForm, port: Number(event.target.value) })} /></label><label>Banco<input value={sourceForm.databaseName} required onChange={(event) => setSourceForm({ ...sourceForm, databaseName: event.target.value })} /></label><label>Usuário<input value={sourceForm.username} required onChange={(event) => setSourceForm({ ...sourceForm, username: event.target.value })} /></label><label>Senha {sourceForm.id && "(deixe vazia para manter)"}<input type="password" value={sourceForm.password} onChange={(event) => setSourceForm({ ...sourceForm, password: event.target.value })} /></label><label>Contexto geral<textarea value={sourceForm.context} onChange={(event) => setSourceForm({ ...sourceForm, context: event.target.value })} /></label><div className="form-actions"><button type="submit">Testar e salvar</button>{sourceForm.id && <button type="button" className="secondary" onClick={() => { setSourceForm(blankSource()); setSourceTables([]); }}>Cancelar</button>}</div></form><section className="records"><h2>Servidores e tabelas</h2>{sources.map((source) => <article key={source.id}><strong>{source.name}</strong><span>{source.username}@{source.host}:{source.port}/{source.databaseName}</span><div><button onClick={() => void selectSource(source)}>Editar e ver tabelas</button><button className="danger" onClick={() => { if (window.confirm(`Excluir ${source.name}?`)) void api.deleteDataSource(source.id).then(loadAll).catch((reason: unknown) => setMessage(messageFrom(reason))); }}>Excluir</button></div></article>)}{selectedSource && <TableContexts sourceId={selectedSource} tables={sourceTables} onUpdated={setSourceTables} onError={setMessage} />}</section></section>}
    {section === "dashboards" && <section className="admin-grid"><form className="admin-form" onSubmit={saveDashboard}><h2>{dashboardForm.id ? "Editar dashboard" : "Novo dashboard"}</h2><label>Nome<input value={dashboardForm.name} required onChange={(event) => setDashboardForm({ ...dashboardForm, name: event.target.value })} /></label><label>Descrição<textarea value={dashboardForm.description} onChange={(event) => setDashboardForm({ ...dashboardForm, description: event.target.value })} /></label><label>Contrato JSON<textarea className="code-input" value={dashboardForm.definition} onChange={(event) => setDashboardForm({ ...dashboardForm, definition: event.target.value })} /></label><div className="form-actions"><button type="submit">Salvar dashboard</button><button type="button" className="secondary" onClick={() => setDashboardForm(blankDashboard())}>Novo</button></div></form><section className="records"><h2>Dashboards</h2>{dashboards.map((dashboard) => <article key={dashboard.id}><strong>{dashboard.name}</strong><span>{dashboard.id}</span><small>{dashboard.description}</small><div><button onClick={() => setDashboardForm({ id: dashboard.id, name: dashboard.name, description: dashboard.description ?? "", definition: JSON.stringify(dashboard.definition, null, 2) })}>Editar</button><button className="danger" onClick={() => { if (window.confirm(`Excluir ${dashboard.name}?`)) void api.deleteDashboard(dashboard.id).then(loadAll).catch((reason: unknown) => setMessage(messageFrom(reason))); }}>Excluir</button></div></article>)}</section></section>}
    {section === "queries" && <section className="admin-grid"><form className="admin-form" onSubmit={saveQuery}><h2>{queryForm.id ? "Editar query" : "Nova query"}</h2><label>Dashboard<select value={queryForm.dashboardId} required onChange={(event) => setQueryForm({ ...queryForm, dashboardId: event.target.value })}><option value="">Selecione</option>{dashboards.map((dashboard) => <option value={dashboard.id} key={dashboard.id}>{dashboard.name}</option>)}</select></label><label>Servidor<select value={queryForm.dataSourceId} required onChange={(event) => setQueryForm({ ...queryForm, dataSourceId: event.target.value })}><option value="">Selecione</option>{sources.map((source) => <option value={source.id} key={source.id}>{source.name}</option>)}</select></label><label>Nome<input value={queryForm.name} required onChange={(event) => setQueryForm({ ...queryForm, name: event.target.value })} /></label><label>SQL SELECT<textarea className="code-input" value={queryForm.sqlText} onChange={(event) => setQueryForm({ ...queryForm, sqlText: event.target.value })} /></label><label>Parâmetros JSON<textarea className="code-input" value={queryForm.parameters} onChange={(event) => setQueryForm({ ...queryForm, parameters: event.target.value })} /></label><label>Permissões obrigatórias JSON<textarea className="code-input" value={queryForm.requiredPermissionKeys} onChange={(event) => setQueryForm({ ...queryForm, requiredPermissionKeys: event.target.value })} /></label>{queryForm.id && <><label>Valores de teste JSON<textarea className="code-input" value={queryTestParameters} onChange={(event) => setQueryTestParameters(event.target.value)} /></label><button type="button" className="secondary" onClick={() => { try { const raw = parseJson(queryTestParameters, "Os valores de teste"); if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("Os valores de teste devem ser um objeto JSON."); const values = Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string")); void api.testQuery(queryForm.id!, values).then((result) => setQueryTestResult(JSON.stringify(result.rows, null, 2))).catch((reason: unknown) => setQueryTestResult(messageFrom(reason))); } catch (reason) { setQueryTestResult(messageFrom(reason)); } }}>Testar query</button>{queryTestResult && <pre className="query-result">{queryTestResult}</pre>}</>}<div className="form-actions"><button type="submit">Salvar query</button><button type="button" className="secondary" onClick={() => { setQueryForm(blankQuery()); setQueryTestResult(undefined); }}>Nova</button></div></form><section className="records"><h2>Queries salvas</h2>{queries.map((query) => <article key={query.id}><strong>{query.name}</strong><span>{query.id}</span><small>Dashboard: {query.dashboardId}</small><div><button onClick={() => void editQuery(query.id)}>Editar</button><button className="danger" onClick={() => { if (window.confirm(`Excluir ${query.name}?`)) void api.deleteQuery(query.id).then(loadAll).catch((reason: unknown) => setMessage(messageFrom(reason))); }}>Excluir</button></div></article>)}</section></section>}
  </main>;
}

function PermissionForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const [key, setKey] = useState(""); const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [message, setMessage] = useState<string>();
  return <form className="admin-form" onSubmit={(event) => { event.preventDefault(); void api.createPermission({ key, name, description: description || null }).then(async () => { setKey(""); setName(""); setDescription(""); setMessage("Permissão criada."); await onSaved(); }).catch((reason: unknown) => setMessage(messageFrom(reason))); }}><h2>Nova permissão</h2><label>Chave<input value={key} required placeholder="read:sales:revenue" onChange={(event) => setKey(event.target.value)} /></label><label>Nome<input value={name} required onChange={(event) => setName(event.target.value)} /></label><label>Descrição<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label><button type="submit">Criar permissão</button><FormMessage message={message} /></form>;
}

function TableContexts({ sourceId, tables, onUpdated, onError }: { sourceId: string; tables: DataSourceTable[]; onUpdated: (tables: DataSourceTable[]) => void; onError: (message: string) => void }) {
  const [editing, setEditing] = useState<Record<string, string>>({});
  return <div className="table-contexts"><h3>Contexto das tabelas</h3>{tables.map((table) => <label key={table.id}><strong>{table.schemaName}.{table.tableName}</strong><textarea value={editing[table.id] ?? table.context} onChange={(event) => setEditing({ ...editing, [table.id]: event.target.value })} onBlur={() => { const value = editing[table.id]; if (value === undefined || value === table.context) return; void api.updateTableContext(sourceId, table.id, value).then((updated) => { onUpdated(tables.map((item) => item.id === updated.id ? updated : item)); setEditing((current) => { const { [table.id]: _current, ...remaining } = current; return remaining; }); }).catch((reason: unknown) => onError(messageFrom(reason))); }} /></label>)}</div>;
}
