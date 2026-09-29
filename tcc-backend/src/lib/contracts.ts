import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(8, "A senha deve ter no mínimo 8 caracteres.")
  .regex(/[A-Z]/, "A senha deve conter uma letra maiúscula.")
  .regex(/[a-z]/, "A senha deve conter uma letra minúscula.")
  .regex(/[0-9]/, "A senha deve conter um número.")
  .regex(/[^A-Za-z0-9]/, "A senha deve conter um caractere especial.");

export const permissionKeySchema = z
  .string()
  .min(3)
  .max(255)
  .regex(
    /^[a-z][a-z0-9:_-]*$/,
    "Use letras minúsculas, números, ':', '_' ou '-'.",
  );

export const sourceInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(5432),
  databaseName: z.string().trim().min(1).max(255),
  username: z.string().trim().min(1).max(255),
  password: z.string().min(1),
  context: z.string().max(20000).default(""),
});

export const sourceUpdateInputSchema = sourceInputSchema.extend({
  password: z.string().min(1).optional(),
});

export const parameterDefinitionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  label: z.string().trim().min(1).max(160),
  type: z.enum(["text", "number", "date", "boolean", "multi_select"]),
  required: z.boolean().default(false),
});

export const queryDraftSchema = z
  .object({
    dataSourceId: z.string().uuid(),
    sqlText: z.string().trim().min(8).max(100000),
    parameters: z.array(parameterDefinitionSchema).default([]),
  })
  .strict();

export const queryInputSchema = queryDraftSchema
  .extend({
    name: z.string().trim().min(2).max(160),
  })
  .strict();

export const dashboardCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).default(""),
  })
  .strict();

export const queryTestInputSchema = queryDraftSchema
  .extend({
    values: z.record(z.union([z.string(), z.array(z.string())])).default({}),
  })
  .strict();

export const dashboardLookupSchema = z
  .object({
    queryUuid: z.string().uuid().or(z.literal("")),
    valueField: z.string().trim().min(1).max(160).default("value"),
    labelField: z.string().trim().min(1).max(160).default("label"),
  })
  .strict();

export const dashboardOptionSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    value: z.string().trim().min(1).max(160),
  })
  .strict();

export const dashboardArgumentSchema = parameterDefinitionSchema
  .extend({
    lookup: dashboardLookupSchema.optional(),
    options: z.array(dashboardOptionSchema).optional(),
  })
  .superRefine((argument, context) => {
    if (argument.type !== "multi_select" && argument.options?.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message:
          "Opções manuais só podem ser usadas em argumentos multi_select.",
      });
    }
    if (argument.lookup && argument.options?.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message:
          "Escolha opções manuais ou uma query, sem misturar as duas fontes.",
      });
    }
    if (
      argument.type === "multi_select" &&
      argument.required &&
      !argument.lookup &&
      !argument.options?.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message:
          "Um argumento multi_select obrigatório precisa ter opções ou uma query de opções.",
      });
    }
    const values = new Set<string>();
    for (const [index, option] of (argument.options ?? []).entries()) {
      if (values.has(option.value)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options", index, "value"],
          message: "Os valores das opções devem ser únicos.",
        });
      }
      values.add(option.value);
    }
  });

export const queryParameterSourceSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("context"),
      argument: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      source: z.literal("manual"),
      value: z.union([z.string(), z.array(z.string())]),
    })
    .strict(),
]);

export const queryBindingSchema = z
  .object({
    queryUuid: z.string().uuid(),
    parameters: z.record(queryParameterSourceSchema),
  })
  .strict();

const dashboardDocumentComponentSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    component: z.enum(["stat_card", "bar_chart", "pie_chart", "data_table"]),
    layoutProps: z
      .object({
        colSpan: z.number().int().min(1).max(12).default(12),
        rowSpan: z.number().int().min(1).max(12).default(1),
      })
      .default({ colSpan: 12, rowSpan: 1 }),
    props: z.record(z.unknown()),
  })
  .passthrough();

export const dashboardDocumentSchema = z
  .object({
    id: z
      .string()
      .uuid()
      .transform((id) => id.toLowerCase()),
    name: z.string().min(1).max(200),
    description: z.string().optional(),
    workspace: z
      .object({ params: z.array(dashboardArgumentSchema).default([]) })
      .default({ params: [] }),
    queryBindings: z.array(queryBindingSchema).default([]),
    ui: z
      .object({
        layout: z
          .object({ gap: z.number().int().min(0).max(48).default(16) })
          .passthrough()
          .default({ gap: 16 }),
        components: z.array(dashboardDocumentComponentSchema).default([]),
      })
      .passthrough()
      .default({ layout: { gap: 16 }, components: [] }),
  })
  .passthrough()
  .superRefine((dashboard, context) => {
    if ("sources" in dashboard) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sources"],
        message:
          "SQL deve ser salva no catálogo de queries; o dashboard referencia somente UUIDs.",
      });
    }
    const names = new Set<string>();
    for (const [index, argument] of dashboard.workspace.params.entries()) {
      if (names.has(argument.name)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["workspace", "params", index, "name"],
          message: "Os nomes dos argumentos do dashboard devem ser únicos.",
        });
      }
      names.add(argument.name);
    }
    const bindingQueryIds = new Set<string>();
    for (const [index, binding] of dashboard.queryBindings.entries()) {
      if (bindingQueryIds.has(binding.queryUuid)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["queryBindings", index, "queryUuid"],
          message: "Cada query deve ter somente um mapeamento no dashboard.",
        });
      }
      bindingQueryIds.add(binding.queryUuid);
    }
    for (const [index, component] of dashboard.ui.components.entries()) {
      const queryUuid = component.props.queryUuid;
      if (
        queryUuid !== undefined &&
        queryUuid !== "" &&
        (typeof queryUuid !== "string" ||
          !z.string().uuid().safeParse(queryUuid).success)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ui", "components", index, "props", "queryUuid"],
          message: "O componente deve referenciar uma query salva pelo UUID.",
        });
      }
    }
  });

export const queryInputBindingSchema = queryBindingSchema;

const componentSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    type: z.enum(["stat_card", "bar_chart", "pie_chart", "data_table"]),
    title: z.string().trim().min(1).max(160),
    queryUuid: z.string().uuid(),
    layoutProps: z
      .object({
        colSpan: z.number().int().min(1).max(12).default(12),
        rowSpan: z.number().int().min(1).max(12).default(1),
      })
      .default({ colSpan: 12, rowSpan: 1 }),
    props: z.record(z.unknown()).default({}),
  })
  .passthrough();

export const dashboardDefinitionSchema = z
  .object({
    layout: z
      .object({
        columns: z.literal(12).default(12),
        gap: z.number().int().min(0).max(48).default(16),
      })
      .default({ columns: 12, gap: 16 }),
    components: z.array(componentSchema).default([]),
    workspace: z
      .object({ params: z.array(dashboardArgumentSchema).default([]) })
      .default({ params: [] }),
    queryBindings: z.array(queryInputBindingSchema).default([]),
  })
  .passthrough()
  .superRefine((definition, context) => {
    const ids = new Set<string>();
    for (const [index, component] of definition.components.entries()) {
      if (ids.has(component.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["components", index, "id"],
          message: "O id do componente deve ser único no dashboard.",
        });
      }
      ids.add(component.id);
    }
    const argumentNames = new Set(
      definition.workspace.params.map((argument) => argument.name),
    );
    const bindingQueryIds = new Set<string>();
    for (const [index, binding] of definition.queryBindings.entries()) {
      if (bindingQueryIds.has(binding.queryUuid)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["queryBindings", index, "queryUuid"],
          message: "Cada query deve ter somente um mapeamento no dashboard.",
        });
      }
      bindingQueryIds.add(binding.queryUuid);
      for (const [parameterName, source] of Object.entries(
        binding.parameters,
      )) {
        if (
          source.source === "context" &&
          !argumentNames.has(source.argument)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [
              "queryBindings",
              index,
              "parameters",
              parameterName,
              "argument",
            ],
            message: `O argumento '${source.argument}' não foi declarado no contexto do dashboard.`,
          });
        }
      }
    }
  });

export type ParameterDefinition = z.infer<typeof parameterDefinitionSchema>;
export type DashboardArgument = z.infer<typeof dashboardArgumentSchema>;
export type QueryBinding = z.infer<typeof queryBindingSchema>;
export type DashboardDefinition = z.infer<typeof dashboardDefinitionSchema>;
