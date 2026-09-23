import { useEffect, useState } from "react";
import { api } from "./api";
import { AdminPage } from "./admin";
import { DashboardPage } from "./dashboard";
import type { CurrentUser, DashboardSummary } from "./types";

type View = { page: "dashboards" } | { page: "dashboard"; id: string } | { page: "admin" };

export default function App() {
  const [user, setUser] = useState<CurrentUser>();
  const [view, setView] = useState<View>({ page: "dashboards" });
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]);
  const [email, setEmail] = useState("admin@tcc.local");
  const [password, setPassword] = useState("Admin@123");
  const [error, setError] = useState<string>();

  async function refreshDashboards(): Promise<void> {
    try { setDashboards(await api.dashboards()); } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível carregar os dashboards."); }
  }

  useEffect(() => { void api.me().then((result) => { setUser(result.user); return refreshDashboards(); }).catch(() => undefined); }, []);

  if (!user) return <main className="login-page"><form className="login-card" onSubmit={(event) => { event.preventDefault(); setError(undefined); void api.login(email, password).then(async (result) => { setUser(result.user); await refreshDashboards(); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Não foi possível entrar.")); }}><p className="eyebrow">TCC · DASHBOARDS</p><h1>Entrar na plataforma</h1><p>Use o administrador de desenvolvimento no primeiro acesso.</p><label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <p className="error-text">{error}</p>}<button type="submit">Entrar</button></form></main>;

  const canAdmin = user.permissions.some((permission) => permission.endsWith(":read") || permission.endsWith(":create"));
  return <div className="application"><header className="topbar"><button className="brand" onClick={() => setView({ page: "dashboards" })}>TCC Dashboards</button><nav><button onClick={() => setView({ page: "dashboards" })}>Dashboards</button>{canAdmin && <button onClick={() => setView({ page: "admin" })}>Administração</button>}<span>{user.name}</span><button onClick={() => { void api.logout().finally(() => { setUser(undefined); setView({ page: "dashboards" }); }); }}>Sair</button></nav></header>{view.page === "dashboards" && <main className="page"><header className="page-heading"><div><h1>Dashboards disponíveis</h1><p>Componentes hidratados de forma assíncrona por UUID.</p></div></header><div className="dashboard-list">{dashboards.map((dashboard) => <button className="dashboard-link" key={dashboard.id} onClick={() => setView({ page: "dashboard", id: dashboard.id })}><strong>{dashboard.name}</strong><span>{dashboard.description ?? "Sem descrição"}</span></button>)}{dashboards.length === 0 && <p className="empty">Nenhum dashboard foi liberado para este usuário.</p>}</div></main>}{view.page === "dashboard" && <DashboardPage dashboardId={view.id} onBack={() => setView({ page: "dashboards" })} />}{view.page === "admin" && <AdminPage />}</div>;
}
