import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { and, eq, like, notInArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { recipes } from "../db/schema.js";

const recipeDocumentSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
}).passthrough();

export type RecipeDocument = z.infer<typeof recipeDocumentSchema>;

export function validateRecipeDocument(value: unknown): RecipeDocument {
  return recipeDocumentSchema.parse(value);
}

async function readRecipeSource(sourceUri: string): Promise<string> {
  if (sourceUri.startsWith("file://")) return readFile(fileURLToPath(sourceUri), "utf8");
  if (sourceUri.startsWith("http://") || sourceUri.startsWith("https://")) {
    const response = await fetch(sourceUri);
    if (!response.ok) throw new Error(`Não foi possível carregar a recipe (${response.status}).`);
    return response.text();
  }
  throw new Error("A origem da recipe deve ser file:// ou uma URL HTTPS.");
}

export async function registerRecipeSource(sourceUri: string): Promise<RecipeDocument> {
  const raw = await readRecipeSource(sourceUri);
  const recipe = validateRecipeDocument(JSON.parse(raw) as unknown);
  const checksum = createHash("sha256").update(raw).digest("hex");
  await db.insert(recipes).values({
    id: recipe.id,
    name: recipe.name,
    description: recipe.description ?? null,
    sourceUri,
    checksum,
  }).onConflictDoUpdate({
    target: recipes.id,
    set: { name: recipe.name, description: recipe.description ?? null, sourceUri, checksum, updatedAt: new Date() },
  });
  return recipe;
}

export async function registerRecipeFile(filePath: string): Promise<RecipeDocument> {
  return registerRecipeSource(pathToFileURL(filePath).href);
}

export async function syncRecipeDirectory(directory = resolve(process.cwd(), "recipes")): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const recipeFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  const sourceUris: string[] = [];
  const ids: string[] = [];

  for (const entry of recipeFiles) {
    const filePath = resolve(directory, entry.name);
    const sourceUri = pathToFileURL(filePath).href;
    const recipe = await registerRecipeFile(filePath);
    sourceUris.push(sourceUri);
    ids.push(recipe.id);
  }

  await db.delete(recipes).where(
    sourceUris.length > 0
      ? and(like(recipes.sourceUri, "file://%"), notInArray(recipes.sourceUri, sourceUris))
      : like(recipes.sourceUri, "file://%"),
  );

  return ids;
}

export async function getPersistedRecipes(): Promise<RecipeDocument[]> {
  const rows = await db.select().from(recipes);
  const documents: RecipeDocument[] = [];
  for (const row of rows) {
    const raw = await readRecipeSource(row.sourceUri);
    const recipe = validateRecipeDocument(JSON.parse(raw) as unknown);
    const checksum = createHash("sha256").update(raw).digest("hex");
    if (checksum !== row.checksum) {
      await db.update(recipes).set({ name: recipe.name, description: recipe.description ?? null, checksum, updatedAt: new Date() }).where(eq(recipes.id, row.id));
    }
    documents.push(recipe);
  }
  return documents;
}
