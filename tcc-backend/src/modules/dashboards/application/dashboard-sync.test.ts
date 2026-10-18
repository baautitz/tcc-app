import { describe, expect, it } from "vitest";
import { validateDashboardDocument } from "../domain/dashboards.js";
import { buildDashboardDefinitionFromDocument } from "./dashboard-sync.js";

const salesId = "00000000-0000-4000-8000-000000000011";
const totalId = "00000000-0000-4000-8000-000000000012";
const lookupId = "00000000-0000-4000-8000-000000000013";
const dashboardId = "00000000-0000-4000-8000-000000000014";

function dashboard() {
  return validateDashboardDocument({
    id: dashboardId,
    name: "Dashboard de teste",
    workspace: {
      params: [
        {
          name: "from_date",
          label: "Data inicial",
          type: "date",
          required: true,
        },
        { name: "to_date", label: "Data final", type: "date", required: true },
        {
          name: "categories",
          label: "Categorias",
          type: "multi_select",
          required: false,
          lookup: {
            queryUuid: lookupId,
            valueField: "value",
            labelField: "label",
          },
        },
      ],
    },
    queryBindings: [
      {
        queryUuid: salesId,
        parameters: {
          start_at: { source: "context", argument: "from_date" },
          end_at: { source: "context", argument: "to_date" },
          category_names: { source: "context", argument: "categories" },
        },
      },
      {
        queryUuid: totalId,
        parameters: {
          start_at: { source: "context", argument: "from_date" },
          end_at: { source: "context", argument: "to_date" },
          category_names: { source: "context", argument: "categories" },
        },
      },
    ],
    ui: {
      layout: { gap: 16 },
      components: [
        {
          id: "sales-table",
          component: "data_table",
          props: { title: "Vendas", queryUuid: salesId },
        },
        {
          id: "total-card",
          component: "stat_card",
          props: { title: "Total", queryUuid: totalId },
        },
      ],
    },
  });
}

function query(id: string) {
  return {
    id,
    parameters: [
      {
        name: "start_at",
        label: "Data de início",
        type: "date",
        required: true,
      },
      { name: "end_at", label: "Data de fim", type: "date", required: true },
      {
        name: "category_names",
        label: "Categorias",
        type: "multi_select",
        required: false,
      },
    ],
  };
}

describe("sincronização de dashboards por UUID", () => {
  it("mantém argumentos e mapeia um argumento para várias queries", () => {
    const definition = buildDashboardDefinitionFromDocument(dashboard(), [
      query(salesId),
      query(totalId),
      { id: lookupId, parameters: [] },
    ]);

    expect(
      definition.workspace.params.map((argument) => argument.name),
    ).toEqual(["from_date", "to_date", "categories"]);
    expect(definition.queryBindings).toHaveLength(2);
    expect(
      definition.components.map((component) => component.queryUuid),
    ).toEqual([salesId, totalId]);
  });

  it("rejeita UUIDs que não existem no catálogo", () => {
    expect(() => buildDashboardDefinitionFromDocument(dashboard(), [])).toThrow(
      "não existe no catálogo",
    );
  });

  it("rejeita incompatibilidade de tipos entre argumento e parâmetro", () => {
    const incompatible = query(salesId);
    incompatible.parameters[0] = {
      name: "start_at",
      label: "Data de início",
      type: "text",
      required: true,
    };
    expect(() =>
      buildDashboardDefinitionFromDocument(dashboard(), [
        incompatible,
        query(totalId),
        { id: lookupId, parameters: [] },
      ]),
    ).toThrow("não é compatível");
  });

  it("rejeita mapeamento para parâmetro não declarado pela query", () => {
    const invalid = validateDashboardDocument({
      ...dashboard(),
      queryBindings: [
        {
          queryUuid: salesId,
          parameters: {
            missing_parameter: { source: "context", argument: "from_date" },
          },
        },
      ],
    });
    expect(() =>
      buildDashboardDefinitionFromDocument(invalid, [
        query(salesId),
        query(totalId),
        { id: lookupId, parameters: [] },
      ]),
    ).toThrow("não foi declarado pela query");
  });

  it("rejeita componentes sem UUID de query válido e mapeamentos duplicados", () => {
    expect(() =>
      validateDashboardDocument({
        ...dashboard(),
        ui: {
          layout: { gap: 16 },
          components: [
            {
              id: "bad",
              component: "data_table",
              props: { queryUuid: "not-a-uuid" },
            },
          ],
        },
      }),
    ).toThrow("O componente deve referenciar uma query salva pelo UUID");
    expect(() =>
      validateDashboardDocument({
        ...dashboard(),
        queryBindings: [
          {
            queryUuid: salesId,
            parameters: {
              start_at: { source: "context", argument: "from_date" },
            },
          },
          {
            queryUuid: salesId,
            parameters: { end_at: { source: "context", argument: "to_date" } },
          },
        ],
      }),
    ).toThrow("Cada query deve ter somente um mapeamento");
  });

  it("rejeita parâmetros obrigatórios sem mapeamento", () => {
    const definition = dashboard();
    const noEndDate = validateDashboardDocument({
      ...definition,
      queryBindings: [
        {
          queryUuid: salesId,
          parameters: {
            start_at: { source: "context", argument: "from_date" },
          },
        },
      ],
      ui: {
        layout: { gap: 16 },
        components: [
          {
            id: "sales",
            component: "data_table",
            props: { queryUuid: salesId },
          },
        ],
      },
      workspace: {
        params: [
          {
            name: "from_date",
            label: "Data inicial",
            type: "date",
            required: true,
          },
        ],
      },
    });
    expect(() =>
      buildDashboardDefinitionFromDocument(noEndDate, [query(salesId)]),
    ).toThrow("não está mapeado");
  });

  it("aceita valor manual para parâmetro sem expor um filtro de contexto", () => {
    const manual = validateDashboardDocument({
      id: "00000000-0000-4000-8000-000000000015",
      name: "Dashboard manual",
      workspace: { params: [] },
      queryBindings: [
        {
          queryUuid: totalId,
          parameters: {
            category_names: { source: "manual", value: ["A", "B"] },
          },
        },
      ],
      ui: {
        layout: { gap: 16 },
        components: [
          {
            id: "total",
            component: "stat_card",
            props: { queryUuid: totalId },
          },
        ],
      },
    });
    const definition = buildDashboardDefinitionFromDocument(manual, [
      {
        id: totalId,
        parameters: [
          {
            name: "category_names",
            label: "Categorias",
            type: "multi_select",
            required: false,
          },
        ],
      },
    ]);
    expect(definition.queryBindings[0]?.parameters.category_names).toEqual({
      source: "manual",
      value: ["A", "B"],
    });
  });
});
