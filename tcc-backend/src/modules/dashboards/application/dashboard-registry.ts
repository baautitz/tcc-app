import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { dashboardCreateSchema } from "../../../shared/lib/contracts.js";
import {
  DrizzleDashboardsRepository,
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

type RepositoryFactory = (
  executor?: DashboardDbExecutor,
) => DashboardsRepository;

export class DashboardRegistryService {
  constructor(private readonly repositoryFor: RepositoryFactory) {}

  async registerDashboardFile(
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
    const repo = this.repositoryFor(executor);
    await repo.deleteByPathExceptId(storedPath, dashboard.id);
    await repo.upsert({ dashboardId: dashboard.id, filePath: storedPath });
    return dashboard;
  }

  async createDashboardFile(
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
      await this.repositoryFor(executor).insert({
        dashboardId: dashboard.id,
        filePath: relative(process.cwd(), filePath),
      });
    } catch (error) {
      await unlinkIfExists(filePath);
      throw error;
    }

    return { dashboard, rollback: () => unlinkIfExists(filePath) };
  }

  async syncDashboardDirectory(executor?: DashboardDbExecutor): Promise<{
    dashboardIds: string[];
    synchronized: number;
    removedOrphans: number;
  }> {
    const dashboardFiles = await getDashboardFiles();
    const registeredPaths: string[] = [];
    const dashboardIds: string[] = [];
    for (const { dashboard, filePath } of dashboardFiles) {
      await this.registerDashboardFile(filePath, executor);
      registeredPaths.push(relative(process.cwd(), filePath));
      dashboardIds.push(dashboard.id);
    }

    const repo = this.repositoryFor(executor);
    const existing = await repo.list();
    const orphanIds = existing
      .filter((row) => !registeredPaths.includes(row.filePath))
      .map((row) => row.dashboardId);
    if (orphanIds.length > 0) await repo.deleteByIds(orphanIds);

    return {
      dashboardIds,
      synchronized: dashboardIds.length,
      removedOrphans: orphanIds.length,
    };
  }

  async getRegisteredDashboardFiles(
    repo: DashboardsRepository = this.repositoryFor(),
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

  async getRegisteredDashboards(): Promise<DashboardDocument[]> {
    return (await this.getRegisteredDashboardFiles()).map(
      ({ dashboard }) => dashboard,
    );
  }

  async getDashboardFileById(
    id: string,
  ): Promise<DashboardDocument | undefined> {
    return (await this.getRegisteredDashboardFiles()).find(
      (entry) => entry.dashboard.id === id,
    )?.dashboard;
  }
}

export const dashboardRegistry = new DashboardRegistryService(
  (executor) => new DrizzleDashboardsRepository(executor),
);

/** Compat: consumido pelo módulo ai (sem tocar em ai nesta etapa). */
export const getRegisteredDashboardFiles = () =>
  dashboardRegistry.getRegisteredDashboardFiles();
