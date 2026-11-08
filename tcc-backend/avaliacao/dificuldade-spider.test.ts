import { describe, expect, it } from "vitest";
import {
  classificarSpider,
  contarComponentes,
  nivelPorComponentes,
} from "./dificuldade-spider.js";

describe("nivelPorComponentes (eval_hardness do script oficial)", () => {
  it("easy: comp1<=1, outros=0, comp2=0", () => {
    expect(nivelPorComponentes({ comp1: 1, comp2: 0, outros: 0 })).toBe("easy");
  });
  it("medium: outros<=2 e comp1<=1, ou comp1<=2 e outros<2", () => {
    expect(nivelPorComponentes({ comp1: 1, comp2: 0, outros: 2 })).toBe(
      "medium",
    );
    expect(nivelPorComponentes({ comp1: 2, comp2: 0, outros: 1 })).toBe(
      "medium",
    );
  });
  it("hard: outros>2 e comp1<=2; comp1=3 e outros<=2; ou uma aninhada simples", () => {
    expect(nivelPorComponentes({ comp1: 2, comp2: 0, outros: 3 })).toBe("hard");
    expect(nivelPorComponentes({ comp1: 3, comp2: 0, outros: 2 })).toBe("hard");
    expect(nivelPorComponentes({ comp1: 1, comp2: 1, outros: 0 })).toBe("hard");
  });
  it("extra: o resto", () => {
    expect(nivelPorComponentes({ comp1: 4, comp2: 0, outros: 0 })).toBe(
      "extra",
    );
    expect(nivelPorComponentes({ comp1: 3, comp2: 0, outros: 3 })).toBe(
      "extra",
    );
    expect(nivelPorComponentes({ comp1: 1, comp2: 2, outros: 0 })).toBe(
      "extra",
    );
  });
});

describe("contarComponentes", () => {
  it("SELECT simples sem cláusulas", async () => {
    expect(await contarComponentes("SELECT COUNT(*) FROM t")).toEqual({
      comp1: 0,
      comp2: 0,
      outros: 0,
    });
  });
  it("WHERE, GROUP BY, ORDER BY, LIMIT e JOINs somam em comp1", async () => {
    const c = await contarComponentes(
      "SELECT a FROM t JOIN u ON t.x = u.x JOIN v ON v.x = u.x WHERE a = 1 GROUP BY a ORDER BY a LIMIT 3",
    );
    expect(c.comp1).toBe(6);
  });
  it("OR e LIKE somam em comp1; várias condições e colunas somam em outros", async () => {
    expect(
      await contarComponentes("SELECT a, b FROM t WHERE a LIKE 'x%' OR b = 2"),
    ).toEqual({ comp1: 3, comp2: 0, outros: 2 });
  });
  it("subconsulta em IN conta em comp2", async () => {
    const c = await contarComponentes(
      "SELECT a FROM t WHERE a IN (SELECT a FROM u)",
    );
    expect(c.comp2).toBe(1);
  });
  it("INTERSECT, EXCEPT e UNION contam 1 cada em comp2", async () => {
    for (const op of ["INTERSECT", "EXCEPT", "UNION", "UNION ALL"]) {
      const c = await contarComponentes(
        `SELECT a FROM t ${op} SELECT a FROM u`,
      );
      expect(c.comp2, op).toBe(1);
    }
  });
  it("mais de uma agregação (select + order by) soma 1 em outros", async () => {
    const c = await contarComponentes(
      "SELECT a, SUM(b) FROM t GROUP BY a ORDER BY SUM(b) DESC",
    );
    expect(c.outros).toBe(2); // 2 colunas + 2 agregações
  });
  it("replica o script: agregação no HAVING não conta, mas 'and' e condição negada contam", async () => {
    const um = await contarComponentes(
      "SELECT a FROM t GROUP BY a HAVING COUNT(*) > 1",
    );
    expect(um.outros).toBe(0);
    const dois = await contarComponentes(
      "SELECT SUM(b) FROM t GROUP BY a HAVING COUNT(*) > 1 AND MAX(b) > 2",
    );
    expect(dois.outros).toBe(1); // SUM + o 'and' do HAVING = 2 agregações
    const negada = await contarComponentes(
      "SELECT SUM(b) FROM t WHERE a NOT IN (1, 2)",
    );
    expect(negada.outros).toBe(1); // SUM + NOT IN (not_op) = 2 agregações
  });
});

describe("adaptações para PostgreSQL (decisões do autor)", () => {
  it("cada CTE conta como 1 consulta aninhada", async () => {
    const c = await contarComponentes(
      "WITH a AS (SELECT 1 AS x), b AS (SELECT 2 AS y) SELECT x FROM a",
    );
    expect(c.comp2).toBe(2);
  });
  it("subconsulta no FROM é table_unit e também aninhada", async () => {
    const c = await contarComponentes(
      "SELECT x FROM (SELECT 1 AS x) s JOIN u ON u.x = s.x",
    );
    expect(c.comp1).toBe(1);
    expect(c.comp2).toBe(1);
  });
  it("agregação envolta em ROUND/aritmética/cast conta; janela agregada também", async () => {
    const c = await contarComponentes(
      "SELECT ROUND(AVG(a), 2), MIN(b)::date FROM t",
    );
    expect(c.outros).toBe(2); // 2 colunas + 2 agregações
    const janela = await contarComponentes(
      "SELECT AVG(a) OVER (ORDER BY b ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), SUM(a) FROM t",
    );
    expect(janela.outros).toBe(2); // 2 colunas + 2 agregações
  });
  it("funções de data e janelas sem agregador não pesam", async () => {
    const data = await classificarSpider(
      "SELECT to_char(date_trunc('month', d), 'YYYY-MM') FROM t",
    );
    expect(data.nivel).toBe("easy");
    expect(
      await contarComponentes(
        "SELECT ROW_NUMBER() OVER (PARTITION BY a ORDER BY b) FROM t",
      ),
    ).toEqual({ comp1: 0, comp2: 0, outros: 0 });
  });
  it("ORDER BY por apelido e por ordinal resolve para a expressão do SELECT", async () => {
    const porApelido = await contarComponentes(
      "SELECT a, SUM(b) AS s FROM t GROUP BY a ORDER BY s",
    );
    const porOrdinal = await contarComponentes(
      "SELECT a, SUM(b) AS s FROM t GROUP BY a ORDER BY 2",
    );
    expect(porApelido.outros).toBe(2);
    expect(porOrdinal.outros).toBe(2);
  });
});

describe("classificarSpider", () => {
  it("devolve nível e contagens", async () => {
    expect(
      await classificarSpider("SELECT COUNT(*) FROM t WHERE a = 1"),
    ).toEqual({
      nivel: "easy",
      componentes: { comp1: 1, comp2: 0, outros: 0 },
    });
    const aninhada = await classificarSpider(
      "SELECT a FROM t WHERE a IN (SELECT a FROM u)",
    );
    expect(aninhada.nivel).toBe("hard");
  });
});
