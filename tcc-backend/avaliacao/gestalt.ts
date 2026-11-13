/**
 * Inspeção programática dos seis princípios da Gestalt (Knaflic, 2015, p. 74-80) nos dashboards
 * renderizados pelo cliente. Uso: npx tsx avaliacao/gestalt.ts
 *
 * Monta 5 dashboards (um por cenário do conjunto gold e um misto com um componente de cada tipo),
 * abre cada um no Chrome (Playwright) em duas larguras e mede a geometria e os estilos calculados
 * dos cartões. Cada princípio vira uma regra verificável (sim/não por dashboard e largura).
 * Os limiares são decisões do autor (ver Seção 3.4.5 do TCC). Tudo é apagado ao final.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { chromium } from "playwright-core";

const API = process.env.AVAL_API_URL ?? "http://localhost:3000";
const WEB = process.env.AVAL_WEB_URL ?? "http://localhost:5173";
const OLIST_SOURCE = "00000000-0000-4000-8000-000000000010";
const AQUI = path.dirname(new URL(import.meta.url).pathname);
const LARGURAS = [1440, 1024];
const TOL = 1; // px
let cookie = "";

async function api(metodo: string, rota: string, corpo?: unknown) {
  return fetch(`${API}${rota}`, {
    method: metodo,
    headers: { "content-type": "application/json", origin: WEB, ...(cookie ? { cookie } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
}

interface Caso { id: string; cenario: string; sql_gold: string; tipo_esperado: string }

async function criarQuery(nome: string, sql: string) {
  const t = await api("POST", "/api/queries/test", { dataSourceId: OLIST_SOURCE, sqlText: sql, parameters: [] });
  const { testRunId } = (await t.json()) as { testRunId: string };
  const r = await api("POST", "/api/queries", { dataSourceId: OLIST_SOURCE, sqlText: sql, parameters: [], name: nome, testRunId });
  if (!r.ok) throw new Error(`query ${nome}: ${r.status} ${await r.text()}`);
  return ((await r.json()) as { id: string }).id;
}

function componente(idQuery: string, tipo: string, amostra: Record<string, unknown>, i: number) {
  const colunas = Object.keys(amostra);
  const nameKey = colunas[0];
  const valueKey = colunas.find((c) => c !== nameKey && typeof amostra[c] === "number") ?? colunas.at(-1)!;
  const props: Record<string, unknown> = { title: `Componente ${i + 1}`, queryUuid: idQuery };
  if (tipo === "stat_card") Object.assign(props, { field: colunas[0], format: "number" });
  else if (tipo === "data_table") props.columns = colunas.slice(0, 8).map((key) => ({ key }));
  else Object.assign(props, { nameKey, valueKey });
  return {
    id: `c${i}`,
    component: tipo,
    layoutProps: { colSpan: tipo === "stat_card" ? 4 : 6, rowSpan: tipo === "stat_card" ? 2 : 4 },
    props,
  };
}

// Medição feita dentro da página: devolve geometria e estilos de cada cartão.
const MEDIR = `(() => {
  const cs = (e) => getComputedStyle(e);
  const cartoes = [...document.querySelectorAll('[data-slot=card]')].map((el) => {
    const r = el.getBoundingClientRect(), s = cs(el);
    const titulo = el.querySelector('[data-slot=card-title]') ?? el.querySelector('h2,h3');
    const ts = titulo ? cs(titulo) : null;
    const tr = titulo ? titulo.getBoundingClientRect() : null;
    const borda = (l) => parseFloat(s['border' + l + 'Width']) > 0 && s['border' + l + 'Style'] !== 'none';
    const fechado = (e) => { const c = cs(e); return ['Top','Right','Bottom','Left'].every((l) => parseFloat(c['border'+l+'Width']) > 0 && c['border'+l+'Style'] !== 'none'); };
    const lista = [...el.querySelectorAll('*')].filter((x) => !x.closest('.recharts-tooltip-wrapper') && x.tagName !== 'TD' && x.tagName !== 'TH' && x.tagName !== 'TABLE' && x.tagName !== 'BUTTON' && x.tagName !== 'INPUT' && fechado(x));
    const aninhados = lista.length; const quem = lista.slice(0,2).map((x) => x.tagName + '.' + String(x.getAttribute('class') ?? '').slice(0,50)).join(' | ');
    const caminhos = [...el.querySelectorAll('svg path')].filter((p) => { const c = cs(p); return c.stroke !== 'none' && parseFloat(c.strokeWidth) > 0 && c.fill === 'none' && (p.getTotalLength?.() ?? 0) > 20; }).length;
    return {
      tipo: el.closest('[data-component-type]')?.getAttribute('data-component-type') ?? null,
      x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom,
      bg: s.backgroundColor, radius: s.borderRadius, padding: s.padding,
      borda4: ['Top','Right','Bottom','Left'].every(borda), sombra: s.boxShadow !== 'none',
      tituloFonte: ts ? ts.fontSize + '|' + ts.fontWeight + '|' + ts.color + '|' + ts.fontFamily : null,
      distTitulo: tr ? tr.top - r.top : null,
      aninhados, caminhos, quem, estiloCartao: s.boxShadow.slice(0,40) + ' bg=' + s.backgroundColor + ' pad=' + s.padding,
      temTexto: (el.textContent ?? '').trim().length > 0,
      grafico: el.querySelectorAll('svg.recharts-surface').length,
      tabela: el.querySelectorAll('table').length,
    };
  });
  const main = document.querySelector('main main') ?? document.querySelector('main');
  const grade = document.querySelector('[data-slot=card]')?.parentElement?.parentElement;
  const g = grade?.getBoundingClientRect();
  return { cartoes, grade: g ? { x: g.left, y: g.top, w: g.width } : null,
           fundoPagina: cs(document.body).backgroundColor, ocupado: main ? 1 : 0 };
})()`;

interface Cartao {
  x: number; y: number; w: number; h: number; r: number; b: number;
  bg: string; radius: string; padding: string; borda4: boolean; sombra: boolean;
  tituloFonte: string | null; quem: string; estiloCartao: string; distTitulo: number | null; aninhados: number; caminhos: number;
  grafico: number; tabela: number; temTexto: boolean;
}
const iguais = (v: number[], tol = TOL) => v.length === 0 || Math.max(...v) - Math.min(...v) <= tol;
const unicos = (v: number[]) => [...new Set(v.map((n) => Math.round(n)))].sort((a, b) => a - b);

function classe(c: Cartao): string {
  return c.tabela ? "data_table" : c.grafico ? (c.caminhos ? "grafico_linha_ou_area" : "grafico") : "stat_card";
}

function avaliar(cartoes: Cartao[], grade: { x: number; w: number } | null, fundo: string) {
  const det: Record<string, string> = {};
  // 1. Proximidade: o espaço entre cartões vizinhos é uniforme e maior que o espaço interno (borda->título).
  const folgas: number[] = [];
  for (const a of cartoes)
    for (const b of cartoes) {
      const mesmaLinha = Math.abs(a.y - b.y) < 2 || (a.y < b.b - 2 && b.y < a.b - 2);
      if (mesmaLinha && b.x > a.r - TOL && b.x - a.r < 80) folgas.push(b.x - a.r);
      const mesmaColuna = a.x < b.r - 2 && b.x < a.r - 2;
      if (mesmaColuna && b.y > a.b - TOL && b.y - a.b < 80) folgas.push(b.y - a.b);
    }
  const internos = cartoes.map((c) => c.distTitulo ?? 0).filter((n) => n > 0);
  const proximidade = folgas.length > 0 && iguais(folgas);
  det.proximidade = `folgas entre cartões: ${unicos(folgas).join("/")} px; título a ${unicos(internos).join("/")} px da borda`;

  // 2. Similaridade: cartões do mesmo tipo têm o mesmo estilo (fundo, raio, preenchimento, fonte do título).
  const porTipo = new Map<string, Cartao[]>();
  for (const c of cartoes) porTipo.set(classe(c), [...(porTipo.get(classe(c)) ?? []), c]);
  const assina = (c: Cartao) => [c.bg, c.radius, c.padding, c.tituloFonte].join("§");
  const todos = new Set(cartoes.map(assina));
  const similaridade = [...porTipo.values()].every((g) => new Set(g.map(assina)).size === 1) ;
  det.similaridade = `${todos.size} estilo(s) distinto(s) de cartão em ${cartoes.length} cartões; por tipo: ${[...porTipo].map(([k, g]) => k + '=' + new Set(g.map(assina)).size).join(', ')}`;

  // 3. Cercamento: todo componente está dentro de um contêiner visível (borda nos 4 lados, ou fundo diferente do da página).
  const cercados = cartoes.filter((c) => c.borda4 || c.sombra || c.bg !== fundo).length;
  const cercamento = cartoes.length > 0 && cercados === cartoes.length;
  det.cercamento = `${cercados}/${cartoes.length} cartões com contêiner visível`;

  // 4. Fechamento: o fechamento vem do contêiner; não há molduras fechadas aninhadas dentro dos cartões (exceto tabelas/botões).
  const aninhados = cartoes.reduce((s, c) => s + c.aninhados, 0);
  const fechamento = cartoes.length > 0 && aninhados === 0;
  det.fechamento = `${aninhados} moldura(s) fechada(s) aninhada(s)`;

  // 5. Continuidade: bordas esquerdas e superiores alinhadas a poucas linhas (colunas/linhas da grade) e sem sobreposição.
  const xs = unicos(cartoes.map((c) => c.x));
  const sobrepoe = cartoes.some((a, i) => cartoes.some((b, j) => j > i && a.x < b.r - 1 && b.x < a.r - 1 && a.y < b.b - 1 && b.y < a.b - 1));
  const naGrade = grade ? cartoes.every((c) => c.x >= grade.x - TOL && c.r <= grade.x + grade.w + TOL) : false;
  // cada x distinto deve ser múltiplo do passo comum (diferença entre colunas consecutivas constante)
  const passos = xs.slice(1).map((v, i) => v - xs[i]);
  const minPasso = passos.length ? Math.min(...passos) : 0;
  const regular = passos.every((p) => Math.abs(p / minPasso - Math.round(p / minPasso)) < 0.05);
  const continuidade = !sobrepoe && naGrade && regular;
  det.continuidade = `${xs.length} coluna(s) de alinhamento; sobreposição: ${sobrepoe ? "sim" : "não"}; dentro da grade: ${naGrade ? "sim" : "não"}`;

  // 6. Conexão: gráficos de linha ligam os pontos por um traço contínuo. Não se aplica sem gráfico de linha.
  const linhas = cartoes.filter((c) => c.grafico && c.caminhos > 0);
  const temLinha = cartoes.some((c) => c.grafico && c.caminhos > 0);
  const conexao = temLinha ? linhas.length > 0 : null;
  det.conexao = temLinha ? `${linhas.length} gráfico(s) com traço contínuo` : "não aplicável (sem gráfico de linha)";
  return { proximidade, similaridade, cercamento, fechamento, continuidade, conexao, det };
}

async function main() {
  const casos = JSON.parse(await readFile(path.join(AQUI, "gold/casos.json"), "utf8")) as Caso[];
  const login = await api("POST", "/api/auth/login", {
    email: process.env.AVAL_EMAIL ?? "admin@tcc.local",
    password: process.env.AVAL_PASSWORD ?? "Admin@123",
  });
  cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const banco = new pg.Pool({
    connectionString: process.env.AVAL_OLIST_URL ?? "postgres://olist_reader:olist_readonly_password@127.0.0.1:5433/olist",
    max: 2,
  });
  const pegar = (cen: string, n: number, tipo?: string) =>
    casos.filter((c) => c.cenario === cen && (!tipo || c.tipo_esperado === tipo)).slice(0, n);
  const conjuntos: Array<[string, Caso[]]> = [
    ["kpi", pegar("kpi", 4)],
    ["temporal", pegar("temporal", 4)],
    ["juncoes", [...pegar("juncoes", 2, "bar_chart"), ...pegar("juncoes", 1, "pie_chart")]],
    ["lista", pegar("lista", 2)],
    ["misto", [pegar("kpi", 2), pegar("temporal", 1), pegar("juncoes", 1, "bar_chart"), pegar("juncoes", 1, "pie_chart"), pegar("lista", 1)].flat()],
  ];

  const dashs: string[] = [];
  const queries: string[] = [];
  const linhasCsv: Array<Record<string, unknown>> = [];
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", headless: true });
  try {
    const ctx = await browser.newContext();
    await ctx.addInitScript("window.__name=(f)=>f");
    const page = await ctx.newPage();
    await page.goto(`${WEB}/login`);
    await page.fill("input[type=email]", process.env.AVAL_EMAIL ?? "admin@tcc.local");
    await page.fill("input[type=password]", process.env.AVAL_PASSWORD ?? "Admin@123");
    await page.keyboard.press("Enter");
    await page.waitForURL((u) => !u.pathname.includes("login"));

    for (const [nome, lista] of conjuntos) {
      const comps = [];
      const ids: string[] = [];
      for (const [i, c] of lista.entries()) {
        const q = await criarQuery(`Gestalt ${nome} ${i}`, c.sql_gold);
        queries.push(q);
        ids.push(q);
        const amostra = (await banco.query(`SELECT * FROM (${c.sql_gold.replace(/;\s*$/, "")}) t LIMIT 1`)).rows[0] ?? {};
        comps.push(componente(q, c.tipo_esperado, amostra, i));
      }
      const { id } = (await (await api("POST", "/api/admin/dashboards", { name: `Gestalt ${nome}`, description: "" })).json()) as { id: string };
      dashs.push(id);
      const atual = (await (await api("GET", `/api/admin/dashboards/${id}`)).json()) as { document: Record<string, unknown>; revision: string };
      const put = await api("PUT", `/api/admin/dashboards/${id}`, {
        document: { ...atual.document, queryBindings: ids.map((q) => ({ queryUuid: q, parameters: {} })), ui: { components: comps } },
        expectedRevision: atual.revision,
      });
      if (!put.ok) throw new Error(`PUT ${nome}: ${put.status} ${(await put.text()).slice(0, 300)}`);

      for (const w of LARGURAS) {
        await page.setViewportSize({ width: w, height: 1000 });
        await page.goto(`${WEB}/dashboards/${id}`);
        await page.waitForSelector("[data-slot=card]");
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(1500);
        const m = (await page.evaluate(MEDIR)) as { cartoes: Cartao[]; grade: { x: number; w: number } | null; fundoPagina: string };
        if (m.cartoes.length !== lista.length) throw new Error(`${nome}@${w}: ${m.cartoes.length} cartões, esperados ${lista.length}`);
        const r = avaliar(m.cartoes, m.grade, m.fundoPagina);
        const linha = { dashboard: nome, largura: w, cartoes: m.cartoes.length, ...r.det, proximidade_ok: r.proximidade, similaridade_ok: r.similaridade, cercamento_ok: r.cercamento, fechamento_ok: r.fechamento, continuidade_ok: r.continuidade, conexao_ok: r.conexao };
        linhasCsv.push(linha);
        console.log(JSON.stringify(linha));
      }
    }
  } finally {
    await browser.close();
    for (const id of dashs) await api("DELETE", `/api/admin/dashboards/${id}`).catch(() => undefined);
    for (const id of queries) await api("DELETE", `/api/queries/${id}`).catch(() => undefined);
    await banco.end();
  }
  const pasta = path.join(AQUI, "resultados-oficiais");
  await mkdir(pasta, { recursive: true });
  await writeFile(path.join(pasta, "gestalt.json"), JSON.stringify(linhasCsv, null, 1) + "\n");
  const cols = Object.keys(linhasCsv[0]);
  await writeFile(path.join(pasta, "gestalt.csv"), [cols.join(","), ...linhasCsv.map((l) => cols.map((c) => JSON.stringify(l[c] ?? "")).join(","))].join("\n") + "\n");
}
main().catch((e) => { console.error(e); process.exit(1); });
