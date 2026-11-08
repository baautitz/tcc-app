/**
 * Dificuldade estrutural do SQL pelo critério do Spider 1.0 (Yu et al., 2018, p. 7, "SQL Hardness Criteria").
 * Reproduz as regras do script oficial `evaluation.py` (commit b7b5b8c): `count_component1`,
 * `count_component2`, `count_others` e `eval_hardness` (linhas 303-377), a partir do AST do PostgreSQL
 * (`libpg-query`, o parser real do PostgreSQL) em vez do parser SQLite do Spider.
 *
 * Construções que o script oficial não prevê (CTE, subconsulta no FROM ou no SELECT, funções de janela,
 * funções de data, apelidos e ordinais em ORDER BY) seguem adaptações conservadoras, marcadas abaixo como
 * "DECISÃO DO AUTOR" (sem fonte na literatura). Como no script oficial, subconsultas não são analisadas
 * recursivamente: cada uma só conta como 1 em `comp2`.
 */
import { parse } from "libpg-query";

export type NivelSpider = "easy" | "medium" | "hard" | "extra";

export interface ComponentesSpider {
  comp1: number;
  comp2: number;
  outros: number;
}

/** AGG_OPS do script oficial (sem 'none'). */
const AGREGACOES = new Set(["max", "min", "count", "sum", "avg"]);

/** Nó do AST do libpg-query: objetos `{ NomeDoNo: { ... } }`. */
type No = Record<string, unknown>;

interface UnidadeCondicao {
  /** `not_op` do cond_unit do Spider (NOT IN, NOT LIKE, NOT EXISTS, NOT BETWEEN, NOT (...)). */
  negada: boolean;
  op: string;
  subconsultas: number;
}

interface Condicao {
  unidades: UnidadeCondicao[];
  /** Conectores 'and'/'or' entre as unidades (como `condition[1::2]` do Spider). */
  conectores: string[];
}

function ehNo(valor: unknown): valor is No {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** Conteúdo de um nó embrulhado, `{ Tipo: conteúdo }`, se for do tipo pedido. */
function conteudo(no: unknown, tipo: string): No | undefined {
  if (!ehNo(no)) return undefined;
  const interno = no[tipo];
  return ehNo(interno) ? interno : undefined;
}

function ultimoNome(lista: unknown): string {
  if (!Array.isArray(lista)) return "";
  const ultimo = conteudo(lista[lista.length - 1], "String");
  return typeof ultimo?.sval === "string" ? ultimo.sval : "";
}

/**
 * Percorre o AST chamando `visitar` em cada nó embrulhado. Uma subconsulta (`SubLink`) é visitada, mas só se
 * desce na expressão testada (`testexpr`), nunca no seu SELECT: subconsultas não são analisadas recursivamente.
 */
function percorrer(
  valor: unknown,
  visitar: (tipo: string, no: No) => void,
): void {
  if (Array.isArray(valor)) {
    for (const item of valor) percorrer(item, visitar);
    return;
  }
  if (!ehNo(valor)) return;
  for (const [chave, filho] of Object.entries(valor)) {
    if (ehNo(filho)) visitar(chave, filho);
    if (chave === "SubLink" && ehNo(filho)) {
      percorrer(filho.testexpr, visitar);
    } else {
      percorrer(filho, visitar);
    }
  }
}

function contarSubconsultas(expr: unknown): number {
  let total = 0;
  percorrer(expr, (tipo) => {
    if (tipo === "SubLink") total++;
  });
  return total;
}

/**
 * DECISÃO DO AUTOR: o script oficial só conta o agregador mais externo do item (`agg_id`). Aqui o item conta
 * como agregado se contiver count/sum/avg/min/max em qualquer profundidade (ROUND(AVG(x)), SUM(a)/COUNT(b),
 * MIN(x)::date), inclusive como função de janela (AVG(x) OVER (...)). ROW_NUMBER, LAG etc. não são agregadores.
 */
function contemAgregacao(expr: unknown): boolean {
  let achou = false;
  percorrer(expr, (tipo, no) => {
    if (
      tipo === "FuncCall" &&
      AGREGACOES.has(ultimoNome(no.funcname).toLowerCase())
    )
      achou = true;
  });
  return achou;
}

const SEM_CONDICAO: Condicao = { unidades: [], conectores: [] };

function folha(op: string, negada: boolean, expr: unknown): Condicao {
  return {
    unidades: [{ negada, op, subconsultas: contarSubconsultas(expr) }],
    conectores: [],
  };
}

/** Achata a árvore AND/OR na sequência plana de condições do Spider (parênteses não existem lá). */
function achatarCondicao(expr: unknown, negada = false): Condicao {
  if (!ehNo(expr)) return SEM_CONDICAO;

  const bool = conteudo(expr, "BoolExpr");
  if (bool) {
    const args = (bool.args as unknown[]) ?? [];
    if (bool.boolop === "NOT_EXPR") {
      // DECISÃO DO AUTOR: NOT (a AND b) marca todas as condições do grupo como negadas.
      return achatarCondicao(args[0], !negada);
    }
    const conector = bool.boolop === "OR_EXPR" ? "or" : "and";
    const partes = args.map((a) => achatarCondicao(a, negada));
    return {
      unidades: partes.flatMap((p) => p.unidades),
      conectores: partes.flatMap((p, i) =>
        i === 0 ? p.conectores : [conector, ...p.conectores],
      ),
    };
  }

  const aexpr = conteudo(expr, "A_Expr");
  if (aexpr) {
    const kind = String(aexpr.kind);
    const nome = ultimoNome(aexpr.name);
    if (kind === "AEXPR_LIKE" || kind === "AEXPR_ILIKE")
      return folha("like", negada !== nome.startsWith("!"), expr);
    if (kind === "AEXPR_IN")
      return folha("in", negada !== (nome === "<>"), expr);
    if (kind.includes("BETWEEN"))
      return folha("between", negada !== kind.includes("NOT_BETWEEN"), expr);
    return folha(nome, negada, expr);
  }

  const sublink = conteudo(expr, "SubLink");
  if (sublink) {
    if (sublink.subLinkType === "EXISTS_SUBLINK")
      return folha("exists", negada, expr);
    if (sublink.subLinkType === "ANY_SUBLINK") return folha("in", negada, expr);
    return folha("other", negada, expr);
  }

  // DECISÃO DO AUTOR: IS [NOT] NULL é o operador 'is' do Spider, sem marcar not_op.
  if (conteudo(expr, "NullTest")) return folha("is", negada, expr);

  return folha("other", negada, expr);
}

function juntar(...condicoes: Condicao[]): Condicao {
  return {
    unidades: condicoes.flatMap((c) => c.unidades),
    conectores: condicoes.flatMap((c) => c.conectores),
  };
}

interface ItemSelect {
  expr: unknown;
  alias?: string;
}

/** Resolve ORDER BY por ordinal ou apelido para a expressão do SELECT (DECISÃO DO AUTOR). */
function resolverOrdenacao(por: unknown, itens: ItemSelect[]): unknown {
  const constante = conteudo(por, "A_Const");
  const ordinal = conteudo(constante?.ival, "ival") ?? constante?.ival;
  if (ehNo(ordinal) && typeof ordinal.ival === "number") {
    return itens[ordinal.ival - 1]?.expr ?? por;
  }
  const coluna = conteudo(por, "ColumnRef");
  if (coluna) {
    const campos = coluna.fields as unknown[];
    if (campos.length === 1) {
      const nome = ultimoNome(campos);
      const item = itens.find((i) => i.alias === nome);
      if (item) return item.expr;
    }
  }
  return por;
}

interface Origens {
  unidades: number;
  subconsultas: number;
  condicoesOn: Condicao[];
}

/** Itens do FROM: cada tabela/subconsulta/função é uma `table_unit`; ON/USING vira condição do `from`. */
function lerOrigens(itens: unknown[], acumulado: Origens): Origens {
  for (const item of itens) {
    const juncao = conteudo(item, "JoinExpr");
    if (juncao) {
      lerOrigens([juncao.larg, juncao.rarg], acumulado);
      if (juncao.quals)
        acumulado.condicoesOn.push(achatarCondicao(juncao.quals));
      else if (juncao.usingClause)
        acumulado.condicoesOn.push(folha("=", false, null));
      continue;
    }
    acumulado.unidades++;
    if (conteudo(item, "RangeSubselect")) acumulado.subconsultas++;
  }
  return acumulado;
}

function componentesSelect(sel: No): ComponentesSpider {
  const itens: ItemSelect[] = ((sel.targetList as unknown[]) ?? []).map((t) => {
    const alvo = conteudo(t, "ResTarget") ?? {};
    return {
      expr: alvo.val,
      alias: typeof alvo.name === "string" ? alvo.name : undefined,
    };
  });
  const origens = lerOrigens((sel.fromClause as unknown[]) ?? [], {
    unidades: 0,
    subconsultas: 0,
    condicoesOn: [],
  });
  const agrupar = (sel.groupClause as unknown[]) ?? [];
  const ordenar = ((sel.sortClause as unknown[]) ?? []).map(
    (s) => conteudo(s, "SortBy")?.node,
  );

  const condicaoWhere = achatarCondicao(sel.whereClause);
  const condicaoHaving = achatarCondicao(sel.havingClause);
  const todas = juntar(...origens.condicoesOn, condicaoWhere, condicaoHaving);

  // count_component1
  let comp1 = 0;
  if (condicaoWhere.unidades.length > 0) comp1++;
  if (agrupar.length > 0) comp1++;
  if (ordenar.length > 0) comp1++;
  if (sel.limitCount) comp1++;
  if (origens.unidades > 0) comp1 += origens.unidades - 1;
  comp1 += todas.conectores.filter((c) => c === "or").length;
  comp1 += todas.unidades.filter((u) => u.op === "like").length;

  // count_component2 (get_nestedSQL): subconsultas em condições; operações de conjunto e CTE entram fora daqui
  let comp2 = todas.unidades.reduce((soma, u) => soma + u.subconsultas, 0);
  // DECISÃO DO AUTOR: subconsulta no FROM (que no Spider só entra como table_unit) e subconsulta escalar na
  // lista do SELECT contam também como consulta aninhada.
  comp2 += origens.subconsultas;
  comp2 += itens.reduce((soma, i) => soma + contarSubconsultas(i.expr), 0);

  // count_others
  let outros = 0;
  let agregacoes = itens.filter((i) => contemAgregacao(i.expr)).length;
  // O script oficial aplica has_agg a `where[::2]` e a `having` inteiro; como cada cond_unit começa por
  // `not_op`, o que é contado ali são condições negadas (WHERE) e, no HAVING, também os próprios 'and'/'or'.
  agregacoes += condicaoWhere.unidades.filter((u) => u.negada).length;
  agregacoes += agrupar.filter((g) => contemAgregacao(g)).length;
  agregacoes += ordenar.filter((o) =>
    contemAgregacao(resolverOrdenacao(o, itens)),
  ).length;
  agregacoes += condicaoHaving.conectores.length;
  agregacoes += condicaoHaving.unidades.filter((u) => u.negada).length;
  if (agregacoes > 1) outros++;
  if (itens.length > 1) outros++;
  if (condicaoWhere.unidades.length > 1) outros++;
  if (agrupar.length > 1) outros++;

  return { comp1, comp2, outros };
}

function componentesStatement(sel: No): ComponentesSpider {
  const ctes = ((conteudo({ w: sel.withClause }, "w")?.ctes as unknown[]) ?? [])
    .length;
  let base: ComponentesSpider;
  if (sel.op === "SETOP_NONE") {
    base = componentesSelect(sel);
  } else {
    // INTERSECT/EXCEPT/UNION: a consulta do lado direito é o `nested` do script oficial (+1 por operador).
    const esquerda = componentesStatement(sel.larg as No);
    base = { ...esquerda, comp2: esquerda.comp2 + 1 };
  }
  // DECISÃO DO AUTOR: cada CTE conta como 1 consulta aninhada (espírito da p. 7: aninhadas são mais difíceis).
  return { ...base, comp2: base.comp2 + ctes };
}

/** Contagens `count_component1`, `count_component2` e `count_others` do script oficial. */
export async function contarComponentes(
  sql: string,
): Promise<ComponentesSpider> {
  const { stmts = [] } = await parse(sql);
  const select = conteudo(stmts[0]?.stmt, "SelectStmt");
  if (stmts.length !== 1 || !select)
    throw new Error("Esperado exatamente um comando SELECT");
  return componentesStatement(select);
}

/** `eval_hardness` do script oficial (linhas 362-377), sem alteração. */
export function nivelPorComponentes({
  comp1,
  comp2,
  outros,
}: ComponentesSpider): NivelSpider {
  if (comp1 <= 1 && outros === 0 && comp2 === 0) return "easy";
  if (
    (outros <= 2 && comp1 <= 1 && comp2 === 0) ||
    (comp1 <= 2 && outros < 2 && comp2 === 0)
  )
    return "medium";
  if (
    (outros > 2 && comp1 <= 2 && comp2 === 0) ||
    (comp1 > 2 && comp1 <= 3 && outros <= 2 && comp2 === 0) ||
    (comp1 <= 1 && outros === 0 && comp2 <= 1)
  )
    return "hard";
  return "extra";
}

export async function classificarSpider(sql: string): Promise<{
  nivel: NivelSpider;
  componentes: ComponentesSpider;
}> {
  const componentes = await contarComponentes(sql);
  return { nivel: nivelPorComponentes(componentes), componentes };
}
