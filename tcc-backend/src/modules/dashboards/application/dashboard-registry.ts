import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { dashboardCreateSchema } from "../../../shared/lib/contracts.js";
import {
  createDashboardsRepository,
  type DashboardDbExecutor,
  type DashboardsRepository,
} from "../infrastructure/dashboards-repository.js";
import {
  getDashboardFiles,
  isEditableDashboardFilePath,
  readDashboardFile,
  unlinkIfExists,
  validateDashboardDocument,
  type DashboardDocument,
} from "../domain/dashboards.js";

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
