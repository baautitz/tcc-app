import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import { dashboards } from "../db/schema.js";
import {
  dashboardCreateSchema,
  dashboardDocumentSchema,
} from "../lib/contracts.js";

export type DashboardDocument = ReturnType<
  typeof dashboardDocumentSchema.parse
>;

export function validateDashboardDocument(value: unknown): DashboardDocument {
  return dashboardDocumentSchema.parse(value);
}

function isPathInside(directory: string, filePath: string): boolean {
  const relativePath = relative(resolve(directory), resolve(filePath));
  return (
    Boolean(relativePath) &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  );
}

export function isEditableDashboardFilePath(filePath: string): boolean {
  return isPathInside(resolve(process.cwd(), "dashboards"), filePath);
}

async function readDashboardFile(filePath: string): Promise<DashboardDocument> {
  if (!isEditableDashboardFilePath(filePath)) {
    throw new Error(
      "O arquivo do dashboard deve estar dentro da pasta dashboards da aplicação.",
    );
  }
  return validateDashboardDocument(
    JSON.parse(await readFile(filePath, "utf8")) as unknown,
  );
}

export async function registerDashboardFile(
  filePath: string,
): Promise<DashboardDocument> {
  const resolvedPath = resolve(filePath);
  if (!isEditableDashboardFilePath(resolvedPath)) {
    throw new Error(
      "Dashboards devem ser arquivos JSON dentro da pasta dashboards da aplicação.",
    );
  }

  const dashboard = await readDashboardFile(resolvedPath);
  const storedPath = relative(process.cwd(), resolvedPath);
  await db
    .delete(dashboards)
    .where(
      and(
        eq(dashboards.filePath, storedPath),
        ne(dashboards.dashboardId, dashboard.id),
      ),
    );
  await db
    .insert(dashboards)
    .values({ dashboardId: dashboard.id, filePath: storedPath })
    .onConflictDoUpdate({
      target: dashboards.dashboardId,
      set: { filePath: storedPath },
    });
  return dashboard;
}

export async function createDashboardFile(
  input: unknown,
): Promise<DashboardDocument> {
  const metadata = dashboardCreateSchema.parse(input);
  const dashboard = validateDashboardDocument({
    id: randomUUID(),
    name: metadata.name,
    description: metadata.description || undefined,
    workspace: { params: [] },
    queryBindings: [],
    ui: { layout: { type: "grid", columns: 12, gap: 16 }, components: [] },
  });

  const directory = resolve(process.cwd(), "dashboards");
  await mkdir(directory, { recursive: true });
  const filePath = resolve(directory, `${dashboard.id}.json`);
  await writeFile(filePath, `${JSON.stringify(dashboard, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });

  try {
    await db
      .insert(dashboards)
      .values({
        dashboardId: dashboard.id,
        filePath: relative(process.cwd(), filePath),
      });
  } catch (error) {
    await unlink(filePath).catch(() => undefined);
    throw error;
  }

  return dashboard;
}

export async function syncDashboardDirectory(): Promise<{
  dashboardIds: string[];
  synchronized: number;
  removedOrphans: number;
}> {
  const dashboardFiles = await getDashboardFiles();
  const registeredPaths: string[] = [];
  const dashboardIds: string[] = [];
  for (const { dashboard, filePath } of dashboardFiles) {
    await registerDashboardFile(filePath);
    registeredPaths.push(relative(process.cwd(), filePath));
    dashboardIds.push(dashboard.id);
  }

  const existing = await db
    .select({
      dashboardId: dashboards.dashboardId,
      filePath: dashboards.filePath,
    })
    .from(dashboards);
  const orphanIds = existing
    .filter((row) => !registeredPaths.includes(row.filePath))
    .map((row) => row.dashboardId);
  if (orphanIds.length > 0)
    await db
      .delete(dashboards)
      .where(inArray(dashboards.dashboardId, orphanIds));

  return {
    dashboardIds,
    synchronized: dashboardIds.length,
    removedOrphans: orphanIds.length,
  };
}

export async function getDashboardFiles(): Promise<
  Array<{ dashboard: DashboardDocument; filePath: string }>
> {
  const directory = resolve(process.cwd(), "dashboards");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const files = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".json"),
  );
  const dashboardFiles: Array<{
    dashboard: DashboardDocument;
    filePath: string;
  }> = [];
  const ids = new Set<string>();
  for (const entry of files) {
    const filePath = resolve(directory, entry.name);
    const dashboard = await readDashboardFile(filePath);
    if (ids.has(dashboard.id))
      throw new Error(
        `Mais de um arquivo declara o dashboard_id '${dashboard.id}'.`,
      );
    ids.add(dashboard.id);
    dashboardFiles.push({ dashboard, filePath });
  }
  return dashboardFiles;
}

export async function getRegisteredDashboardFiles(): Promise<
  Array<{ dashboard: DashboardDocument; filePath: string }>
> {
  const rows = await db.select().from(dashboards);
  const files: Array<{ dashboard: DashboardDocument; filePath: string }> = [];
  for (const row of rows) {
    const filePath = resolve(process.cwd(), row.filePath);
    if (!isEditableDashboardFilePath(filePath))
      throw new Error(
        `O caminho '${row.filePath}' do dashboard está fora da pasta dashboards.`,
      );
    const dashboard = await readDashboardFile(filePath);
    if (dashboard.id !== row.dashboardId) continue;
    files.push({ dashboard, filePath });
  }
  return files;
}

export async function getRegisteredDashboards(): Promise<DashboardDocument[]> {
  return (await getRegisteredDashboardFiles()).map(
    ({ dashboard }) => dashboard,
  );
}

export async function getDashboardFileById(
  id: string,
): Promise<DashboardDocument | undefined> {
  return (await getRegisteredDashboardFiles()).find(
    (entry) => entry.dashboard.id === id,
  )?.dashboard;
}

export async function saveDashboardFile(
  id: string,
  value: unknown,
): Promise<DashboardDocument> {
  const dashboard = validateDashboardDocument(value);
  if (dashboard.id !== id)
    throw new Error("O id do dashboard não pode ser alterado.");

  const filePath = (await getRegisteredDashboardFiles()).find(
    (entry) => entry.dashboard.id === id,
  )?.filePath;
  if (!filePath) throw new Error("Dashboard não encontrado.");
  if (!isEditableDashboardFilePath(filePath)) {
    throw new Error(
      "O dashboard só pode ser gravado dentro da pasta dashboards da aplicação.",
    );
  }

  await writeFile(filePath, `${JSON.stringify(dashboard, null, 2)}\n`, "utf8");
  return dashboard;
}
