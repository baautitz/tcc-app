import type { ErrorHandler } from "hono";

import { ZodError } from "zod";

import { ApiError } from "../lib/domain-error.js";

export const errorHandler: ErrorHandler = (error, context) => {
  if (error instanceof ApiError)
    return context.json({ error: error.message }, error.status as never);
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const path = issue?.path.join(".");
    const message = issue
      ? `Dados inválidos${path ? ` em '${path}'` : ""}: ${issue.message}`
      : "Dados inválidos.";
    return context.json({ error: message, details: error.flatten() }, 400);
  }
  console.error(error);
  return context.json({ error: "Erro interno do servidor." }, 500);
};
