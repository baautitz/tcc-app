/**
 * Mede L_dashboard (carga de um dashboard salvo) e R_payload (Lazy Hydration) pela API.
 *
 * Uso: npx tsx avaliacao/medir-dashboard.ts [--quentes 10]
 *
 * Para cada caso gold cria uma query com o SQL gold e um dashboard salvo com um componente do tipo
 * esperado (mais 4 dashboards compostos, um por cenário, e 2 tabelas volumosas). Depois reproduz o
 * que o navegador faz ao abrir o dashboard: GET /api/dashboards/:id (layout com query_uuid) e, em
 * paralelo, GET /query/:uuid para cada query distinta. Tudo é apagado ao final.
 *
 *  - L_dashboard = tempo até o último byte de layout + todas as queries (cliente HTTP, sem
 *    renderização do navegador). Medida "fria" (1ª carga após criar) e "quente" (N cargas seguintes).
 *  - Payload_Lazy = bytes do layout (GET /api/dashboards/:id), que só traz query_uuid.
 *  - Payload_Tradicional = layout + bytes das respostas das queries, como se as matrizes
 *    estivessem embutidas no layout. R_payload = (1 - Lazy / Tradicional) * 100.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const API = process.env.AVAL_API_URL ?? "http://localhost:3000";
const OLIST_SOURCE = "00000000-0000-4000-8000-000000000010";
const AQUI = path.dirname(new URL(import.meta.url).pathname);
const QUENTES = Number(
  process.argv.includes("--quentes")
    ? process.argv[process.argv.indexOf("--quentes") + 1]
    : "10",
);
let cookie = "";

async function api(metodo: string, rota: string, corpo?: unknown) {
  return fetch(`${API}${rota}`, {
    method: metodo,
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:5173",
      ...(cookie ? { cookie } : {}),
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
}

interface Caso {
  id: string;
  cenario: string;
  sql_gold: string;
  tipo_esperado: string;
}
interface Item {
  rotulo: string;
  cenario: string;
  consultas: Array<{ id: string; sql: string; tipo: string }>;
}

async function criarQuery(nome: string, sql: string) {
  const teste = await api("POST", "/api/queries/test", {
    dataSourceId: OLIST_SOURCE,
    sqlText: sql,
    parameters: [],
  });
  if (!teste.ok) throw new Error(`teste ${nome}: ${teste.status} ${(await teste.text()).slice(0, 300)}`);
  const { testRunId } = (await teste.json()) as { testRunId: string };
  const r = await api("POST", "/api/queries", {
    dataSourceId: OLIST_SOURCE,
    sqlText: sql,
    parameters: [],
    name: nome,
    testRunId,
  });
  if (!r.ok) throw new Error(`query ${nome}: ${r.status} ${await r.text()}`);
  return ((await r.json()) as { id: string }).id;
}

function componente(
  idQuery: string,
  tipo: string,
  colunas: string[],
  amostra: Record<string, unknown>,
  indice: number,
) {
  const numerica = colunas.filter((c) => typeof amostra[c] === "number");
  const nameKey = colunas[0];
  const valueKey = numerica.find((c) => c !== nameKey) ?? colunas.at(-1)!;
  const props: Record<string, unknown> = { title: `Medição ${indice}`, queryUuid: idQuery };
  if (tipo === "stat_card") Object.assign(props, { field: colunas[0], format: "number" });
  else if (tipo === "data_table")
    props.columns = colunas.slice(0, 12).map((key) => ({ key }));
  else Object.assign(props, { nameKey, valueKey });
  return {
    id: `c${indice}`,
    component: tipo,
    layoutProps: { colSpan: tipo === "stat_card" ? 4 : 12, rowSpan: tipo === "stat_card" ? 1 : 3 },
    props,
  };
}

async function montarDashboard(item: Item, banco: pg.Pool) {
  const criado = await api("POST", "/api/admin/dashboards", {
    name: `Medição ${item.rotulo}`,
    description: "",
  });
  const { id } = (await criado.json()) as { id: string };
  const componentes = [];
  for (const [i, c] of item.consultas.entries()) {
    const amostra = (await banco.query(`SELECT * FROM (${c.sql.replace(/;\s*$/, "")}) t LIMIT 1`)).rows[0] ?? {};
    componentes.push(componente(c.id, c.tipo, Object.keys(amostra), amostra, i));
  }
  const atual = (await (await api("GET", `/api/admin/dashboards/${id}`)).json()) as {
    document: Record<string, unknown>;
    revision: string;
  };
  const guardar = await api("PUT", `/api/admin/dashboards/${id}`, {
    document: {
      ...atual.document,
      queryBindings: item.consultas.map((c) => ({ queryUuid: c.id, parameters: {} })),
      ui: { components: componentes },
    },
    expectedRevision: atual.revision,
  });
  if (!guardar.ok)
    throw new Error(`PUT ${item.rotulo}: ${guardar.status} ${(await guardar.text()).slice(0, 400)}`);
  return id;
}

async function carregar(dashboardId: string, queries: string[]) {
  const t0 = performance.now();
  const layout = await api("GET", `/api/dashboards/${dashboardId}`);
  const bytesLayout = (await layout.arrayBuffer()).byteLength;
  const t1 = performance.now();
  const respostas = await Promise.all(
    queries.map(async (q) => {
      const r = await api("GET", `/query/${q}`);
      const buf = await r.arrayBuffer();
      if (!r.ok) throw new Error(`query ${q}: ${r.status}`);
      return buf.byteLength;
    }),
  );
  const t2 = performance.now();
  return {
    layout_ms: t1 - t0,
    queries_ms: t2 - t1,
    L_dashboard_ms: t2 - t0,
    bytes_layout: bytesLayout,
    bytes_dados: respostas.reduce((a, b) => a + b, 0),
  };
}

const media = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

async function main() {
  const casos = JSON.parse(await readFile(path.join(AQUI, "gold/casos.json"), "utf8")) as Caso[];
  const login = await api("POST", "/api/auth/login", {
    email: process.env.AVAL_EMAIL ?? "admin@tcc.local",
    password: process.env.AVAL_PASSWORD ?? "Admin@123",
  });
  cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const banco = new pg.Pool({
    connectionString:
      process.env.AVAL_OLIST_URL ??
      "postgres://olist_reader:olist_readonly_password@127.0.0.1:5433/olist",
    max: 2,
  });

  const itens: Item[] = [];
  for (const c of casos)
    itens.push({
      rotulo: c.id,
      cenario: c.cenario,
      consultas: [{ id: "", sql: c.sql_gold, tipo: c.tipo_esperado }],
    });
  for (const cen of ["kpi", "temporal", "juncoes", "lista"])
    itens.push({
      rotulo: `composto-${cen}`,
      cenario: `composto-${cen}`,
      consultas: casos
        .filter((c) => c.cenario === cen)
        .map((c) => ({ id: "", sql: c.sql_gold, tipo: c.tipo_esperado })),
    });
  for (const [nome, sql] of [
    ["volumosa-order_items", "SELECT * FROM olist.order_items"],
    ["volumosa-orders", "SELECT * FROM olist.orders"],
  ])
    itens.push({
      rotulo: nome,
      cenario: "volumosa",
      consultas: [{ id: "", sql, tipo: "data_table" }],
    });

  const criadosDash: string[] = [];
  const criadosQuery: string[] = [];
  const linhas: Array<Record<string, unknown>> = [];
  try {
    for (const item of itens) {
      for (const [i, c] of item.consultas.entries()) {
        c.id = await criarQuery(`Medição ${item.rotulo} ${i}`, c.sql);
        criadosQuery.push(c.id);
      }
      const id = await montarDashboard(item, banco);
      criadosDash.push(id);
      const queries = [...new Set(item.consultas.map((c) => c.id))];
      const fria = await carregar(id, queries);
      const quentes = [];
      for (let i = 0; i < QUENTES; i++) quentes.push(await carregar(id, queries));
      const lazy = fria.bytes_layout;
      const trad = fria.bytes_layout + fria.bytes_dados;
      linhas.push({
        item: item.rotulo,
        cenario: item.cenario,
        queries: queries.length,
        L_dashboard_frio_ms: Math.round(fria.L_dashboard_ms),
        L_dashboard_quente_media_ms: Math.round(media(quentes.map((q) => q.L_dashboard_ms))),
        L_dashboard_quente_max_ms: Math.round(Math.max(...quentes.map((q) => q.L_dashboard_ms))),
        bytes_layout: lazy,
        bytes_dados: fria.bytes_dados,
        R_payload_pct: Number(((1 - lazy / trad) * 100).toFixed(3)),
      });
      console.log(JSON.stringify(linhas.at(-1)));
    }
  } finally {
    for (const id of criadosDash)
      await api("DELETE", `/api/admin/dashboards/${id}`).catch(() => undefined);
    for (const id of criadosQuery)
      await api("DELETE", `/api/queries/${id}`).catch(() => undefined);
    await banco.end();
  }
  const pasta = path.join(AQUI, "resultados-oficiais");
  await mkdir(pasta, { recursive: true });
  const colunas = Object.keys(linhas[0] ?? {});
  await writeFile(
    path.join(pasta, "l_dashboard_r_payload.csv"),
    [colunas.join(","), ...linhas.map((l) => colunas.map((c) => l[c]).join(","))].join("\n") + "\n",
  );
  await writeFile(
    path.join(pasta, "l_dashboard_r_payload.json"),
    JSON.stringify(linhas, null, 1) + "\n",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
