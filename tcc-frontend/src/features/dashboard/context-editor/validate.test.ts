import { describe, expect, it } from "vitest";
import { dashboardValidationIssues } from "./validate";

const q = (over = {}) => ({
  id: "q1", name: "Vendas",
  parameters: [{ name: "p", label: "Período", type: "text", required: true }],
  ...over,
});
const dash = (over = {}) => ({
  ui: { components: [{ id: "c1", component: "stat_card", props: { title: "T", queryUuid: "q1" } }] },
  workspace: { params: [] },
  queryBindings: [{ queryUuid: "q1", parameters: { p: { source: "value", value: "x" } } }],
  ...over,
});
const run = (d: unknown, qs: unknown[] = [q()]) => dashboardValidationIssues(d as never, qs as never);

describe("dashboardValidationIssues", () => {
  it("valid dashboard has no issues", () => expect(run(dash())).toEqual([]));
  it("flags missing and unknown queries", () => {
    const c = (queryUuid: string) => dash({ ui: { components: [{ id: "c", component: "stat_card", props: { title: "T", queryUuid } }] }, queryBindings: [] });
    expect(run(c(""))[0]).toContain("não tem uma query");
    expect(run(c("zz"))[0]).toContain("não existe no catálogo");
  });
  it("flags unmapped required parameter", () => {
    expect(run(dash({ queryBindings: [] }))[0]).toContain("não está mapeado");
  });
  it("flags empty required value and unknown parameter", () => {
    const b = (parameters: unknown) => dash({ queryBindings: [{ queryUuid: "q1", parameters }] });
    expect(run(b({ p: { source: "value", value: " " } }))[0]).toContain("precisa de um valor");
    expect(run(b({ z: { source: "value", value: "1" }, p: { source: "value", value: "x" } }))[0]).toContain("não foi declarado");
  });
  it("checks context arguments", () => {
    const b = dash({
      workspace: { params: [{ name: "a", label: "A", type: "number", required: false }] },
      queryBindings: [{ queryUuid: "q1", parameters: { p: { source: "context", argument: "a" } } }],
    });
    expect(run(b)[0]).toContain("não é compatível");
    const missing = dash({ queryBindings: [{ queryUuid: "q1", parameters: { p: { source: "context", argument: "x" } } }] });
    expect(run(missing)[0]).toContain("não existe na dashboard");
  });
  it("validates typed literal values", () => {
    const one = (type: string, value: unknown) =>
      run(dash({ queryBindings: [{ queryUuid: "q1", parameters: { p: { source: "value", value } } }] }), [q({ parameters: [{ name: "p", label: "P", type, required: false }] })]);
    expect(one("number", "abc")[0]).toContain("numérico");
    expect(one("boolean", "talvez")[0]).toContain("verdadeiro ou falso");
    expect(one("date", "01/02/2024")[0]).toContain("AAAA-MM-DD");
    expect(one("multi_select", "a")[0]).toContain("lista");
    expect(one("text", ["a"])[0]).toContain("único valor");
  });
});
