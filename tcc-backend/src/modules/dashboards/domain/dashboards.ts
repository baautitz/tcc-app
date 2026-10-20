import { DomainError } from "../../../shared/lib/domain-error.js";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  dashboardCreateSchema,
  dashboardDocumentSchema,
} from "../../../shared/lib/contracts.js";

export type DashboardDocument = ReturnType<
  typeof dashboardDocumentSchema.parse
>;

export async function unlinkIfExists(filePath: string): Promise<void> {
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
    super(
      "The dashboard file could not be compensated after the database transaction failed.",
      "FILE_COMPENSATION_FAILED",
      "conflict",
    );
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
        throw new DashboardFileCompensationError(
          operationError,
          compensationError,
        );
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
    throw new Error(
      "O dashboard só pode ser gravado dentro da pasta dashboards da aplicação.",
    );
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

export async function readDashboardFile(
  filePath: string,
): Promise<DashboardDocument> {
  if (!isEditableDashboardFilePath(filePath)) {
    throw new Error(
      "O arquivo do dashboard deve estar dentro da pasta dashboards da aplicação.",
    );
  }
  return validateDashboardDocument(
    JSON.parse(await readFile(filePath, "utf8")) as unknown,
  );
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
