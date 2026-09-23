import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(8, "A senha deve ter no mínimo 8 caracteres.")
  .regex(/[A-Z]/, "A senha deve conter uma letra maiúscula.")
  .regex(/[a-z]/, "A senha deve conter uma letra minúscula.")
  .regex(/[0-9]/, "A senha deve conter um número.")
  .regex(/[^A-Za-z0-9]/, "A senha deve conter um caractere especial.");

export const permissionKeySchema = z.string().min(3).max(255).regex(/^[a-z][a-z0-9:_-]*$/, "Use letras minúsculas, números, ':', '_' ou '-'.");

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
  name: z.string().trim().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  label: z.string().trim().min(1).max(160),
  type: z.enum(["text", "number", "date", "boolean", "multi_select"]),
  required: z.boolean().default(false),
});

export const queryInputSchema = z.object({
  dashboardId: z.string().uuid(),
  dataSourceId: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  sqlText: z.string().trim().min(8).max(100000),
  parameters: z.array(parameterDefinitionSchema).default([]),
  requiredPermissionKeys: z.array(permissionKeySchema).default([]),
});

const componentSchema = z.object({
  id: z.string().trim().min(1).max(160),
  type: z.enum(["stat_card", "bar_chart", "pie_chart", "data_table"]),
  title: z.string().trim().min(1).max(160),
  queryUuid: z.string().uuid(),
  layoutProps: z.object({
    colSpan: z.number().int().min(1).max(12).default(12),
    rowSpan: z.number().int().min(1).max(12).default(1),
  }).default({ colSpan: 12, rowSpan: 1 }),
  props: z.record(z.unknown()).default({}),
}).passthrough();

export const dashboardDefinitionSchema = z.object({
  layout: z.object({
    columns: z.literal(12).default(12),
    gap: z.number().int().min(0).max(48).default(16),
  }).default({ columns: 12, gap: 16 }),
  components: z.array(componentSchema).default([]),
}).passthrough().superRefine((definition, context) => {
  const ids = new Set<string>();
  for (const [index, component] of definition.components.entries()) {
    if (ids.has(component.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["components", index, "id"], message: "O id do componente deve ser único no dashboard." });
    }
    ids.add(component.id);
  }
});

export const dashboardInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(20000).nullable().optional(),
  definition: dashboardDefinitionSchema.default({ layout: { columns: 12, gap: 16 }, components: [] }),
});

export type ParameterDefinition = z.infer<typeof parameterDefinitionSchema>;
export type DashboardDefinition = z.infer<typeof dashboardDefinitionSchema>;
