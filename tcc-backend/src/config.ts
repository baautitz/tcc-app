import { z } from "zod";
import { loadEnvFile } from "node:process";

let attemptedDotenvLoad = false;

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:5173"),
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(1),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  // AI configuration is optional: a missing or invalid AI provider must not
  // prevent the rest of the API from starting.
  AI_BASE_URL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
});

export type Environment = z.infer<typeof environmentSchema>;

export function getEnvironment(
  values: NodeJS.ProcessEnv = process.env,
): Environment {
  if (values === process.env && !attemptedDotenvLoad) {
    attemptedDotenvLoad = true;
    try {
      loadEnvFile(".env");
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("ENOENT"))
        throw error;
    }
  }
  return environmentSchema.parse(values);
}
