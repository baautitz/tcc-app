import { DomainError } from "../../../shared/lib/domain-error.js";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  createDashboardsRepository,
  type DashboardDbExecutor,
  type DashboardsRepository,
} from "../infrastructure/dashboards-repository.js";
import {
  dashboardCreateSchema,
  dashboardDocumentSchema,
} from "../../../shared/lib/contracts.js";

export type DashboardDocument = ReturnType<
  typeof dashboardDocumentSchema.parse
>;

async function unlinkIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function validateDashboardDocument(value: unknown): DashboardDocument {
  return dashboardDocumentSchema.parse(value);
}

export class DashboardFileCompensationError extends DomainError {
  constructor(
    public readonly operationError: unknown,
    public readonly compensationError: unknown,
  ) {
    super("The dashboard file could not be compensated after the database transaction failed.", "FILE_COMPENSATION_FAILED", "conflict");
    this.name = "DashboardFileCompensationError";
  }
}

export async function withDashboardFileCompensation<T>(
  operation: () => Promise<T>,
  getRollback: () => (() => Promise<void>) | undefined,
): Promise<T> {
  try {
    return await operation();
  } catch (operationError) {
    const rollback = getRollback();
    if (rollback) {
      try {
        await rollback();
      } catch (compensationError) {
        throw new DashboardFileCompensationError(operationError, compensationError);
      }
    }
    throw operationError;
  }
}

/** Atomically replaces a dashboard JSON file and returns a rollback for a DB commit failure. */
export async function writeDashboardDocumentAtomically(
  filePath: string,
  value: unknown,
): Promise<() => Promise<void>> {
  const resolvedPath = resolve(filePath);
  if (!isEditableDashboardFilePath(resolvedPath)) {
    throw new Error("O dashboard só pode ser gravado dentro da pasta dashboards da aplicação.");
  }
  const dashboard = validateDashboardDocument(value);
  const body = `${JSON.stringify(dashboard, null, 2)}\n`;
  await mkdir(resolve(resolvedPath, ".."), { recursive: true });
  let previous: Buffer | undefined;
  try {
    previous = await readFile(resolvedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporaryPath = `${resolvedPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, body, { encoding: "utf8", flag: "wx" });
  try {
    await rename(temporaryPath, resolvedPath);
  } catch (error) {
    await unlinkIfExists(temporaryPath);
    throw error;
  }
  return async () => {
    if (previous) {
      const rollbackPath = `${resolvedPath}.${randomUUID()}.rollback`;
      await writeFile(rollbackPath, previous, { flag: "wx" });
      await rename(rollbackPath, resolvedPath);
    } else {
      await unlinkIfExists(resolvedPath);
    }
  };
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
  executor?: DashboardDbExecutor,
): Promise<DashboardDocument> {
  const resolvedPath = resolve(filePath);
  if (!isEditableDashboardFilePath(resolvedPath)) {
    throw new Error(
      "Dashboards devem ser arquivos JSON dentro da pasta dashboards da aplicação.",
    );
  }

  const dashboard = await readDashboardFile(resolvedPath);
  const storedPath = relative(process.cwd(), resolvedPath);
  const repo = createDashboardsRepository(executor);
  await repo.deleteByPathExceptId(storedPath, dashboard.id);
  await repo.upsert({ dashboardId: dashboard.id, filePath: storedPath });
  return dashboard;
}

export async function createDashboardFile(
  input: unknown,
  executor?: DashboardDbExecutor,
): Promise<{ dashboard: DashboardDocument; rollback: () => Promise<void> }> {
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
    await createDashboardsRepository(executor).insert({
      dashboardId: dashboard.id,
      filePath: relative(process.cwd(), filePath),
    });
  } catch (error) {
    await unlinkIfExists(filePath);
    throw error;
  }

  return { dashboard, rollback: () => unlinkIfExists(filePath) };
}

export async function syncDashboardDirectory(
  executor?: DashboardDbExecutor,
): Promise<{
  dashboardIds: string[];
  synchronized: number;
  removedOrphans: number;
}> {
  const dashboardFiles = await getDashboardFiles();
  const registeredPaths: string[] = [];
  const dashboardIds: string[] = [];
  for (const { dashboard, filePath } of dashboardFiles) {
    await registerDashboardFile(filePath, executor);
    registeredPaths.push(relative(process.cwd(), filePath));
    dashboardIds.push(dashboard.id);
  }

  const repo = createDashboardsRepository(executor);
  const existing = await repo.list();
  const orphanIds = existing
    .filter((row) => !registeredPaths.includes(row.filePath))
    .map((row) => row.dashboardId);
  if (orphanIds.length > 0)
    await repo.deleteByIds(orphanIds);

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

export async function getRegisteredDashboardFiles(
  repo: DashboardsRepository = createDashboardsRepository(),
): Promise<Array<{ dashboard: DashboardDocument; filePath: string }>> {
  const rows = await repo.list();
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
