import { type Context } from "hono";

import { ZodError, z } from "zod";

import { ApiError } from "../lib/domain-error.js";

export async function jsonBody<Schema extends z.ZodTypeAny>(
  context: Context,
  schema: Schema,
): Promise<z.output<Schema>> {
  try {
    return schema.parse(await context.req.json());
  } catch (error) {
    if (error instanceof ZodError) throw error;
    throw new ApiError(400, "O corpo da requisição deve ser JSON válido.");
  }
}
