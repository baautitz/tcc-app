/** Grava em casos.json o campo `dificuldade_spider` (critério estrutural do Spider 1.0) de cada caso gold. */
import { readFileSync, writeFileSync } from "node:fs";
import { classificarSpider } from "./dificuldade-spider.js";

const CAMINHO = new URL("./gold/casos.json", import.meta.url);

const casos = JSON.parse(readFileSync(CAMINHO, "utf8")) as Record<
  string,
  unknown
>[];

const atualizados = await Promise.all(
  casos.map(async (caso) => {
    const { dificuldade_spider: _antigo, ...resto } = caso;
    const resultado = await classificarSpider(String(caso.sql_gold));
    const novo: Record<string, unknown> = {};
    for (const [chave, valor] of Object.entries(resto)) {
      novo[chave] = valor;
      if (chave === "dificuldade") novo.dificuldade_spider = resultado;
    }
    return novo;
  }),
);

writeFileSync(CAMINHO, `${JSON.stringify(atualizados, null, 2)}\n`);

const distribuicao: Record<string, number> = {};
for (const c of atualizados) {
  const { nivel, componentes } = c.dificuldade_spider as Awaited<
    ReturnType<typeof classificarSpider>
  >;
  distribuicao[nivel] = (distribuicao[nivel] ?? 0) + 1;
  console.log(
    `${c.id}\t${c.tokens_sql_gold}\t${c.dificuldade}\t${componentes.comp1}\t${componentes.comp2}\t${componentes.outros}\t${nivel}`,
  );
}
console.log(distribuicao);
