import { z } from "zod";
import type { QueryParameter, QueryPreview } from "@/modules/queries/model/types";

const parameterSchema = z.object({
  name: z.string().trim().min(1),
  label: z.string().trim().min(1),
  type: z.enum(["text", "number", "date", "boolean", "multi_select"]),
  required: z.boolean(),
});

export const queryFormSchema = z.object({
  dataSourceId: z.string().uuid("Selecione o servidor PostgreSQL."),
  name: z
    .string()
    .trim()
    .min(2, "Informe um nome com pelo menos 2 caracteres."),
  sqlText: z.string().trim().min(8, "Informe uma consulta SELECT."),
  parameters: z.string().min(2, "Informe um array JSON de parâmetros."),
});

export type QueryForm = z.infer<typeof queryFormSchema>;
export type ReviewedQueryPreview = QueryPreview & { draftKey: string };

export function parseParameters(raw: string): QueryParameter[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Os parâmetros devem conter JSON válido.");
  }
  return z.array(parameterSchema).parse(parsed);
}

export function parseTestValues(raw: string): Record<string, string | string[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Os valores de teste devem conter JSON válido.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Os valores de teste devem ser um objeto JSON.");
  }
  return z.record(z.union([z.string(), z.array(z.string())])).parse(parsed);
}

