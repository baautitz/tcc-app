import type { DashboardFilesPort } from "../../queries/domain/dashboard-files-port.js";
import {
  DashboardFileCompensationError,
  getDashboardFiles,
  withDashboardFileCompensation,
  writeDashboardDocumentAtomically,
} from "../domain/dashboards.js";

export class DashboardFilesAdapter implements DashboardFilesPort {
  getFiles() {
    return getDashboardFiles();
  }
  writeAtomically(filePath: string, value: unknown) {
    return writeDashboardDocumentAtomically(filePath, value);
  }
  withCompensation<T>(
    operation: () => Promise<T>,
    getRollback: () => (() => Promise<void>) | undefined,
  ) {
    return withDashboardFileCompensation(operation, getRollback);
  }
  asCompensationFailure(error: unknown) {
    return error instanceof DashboardFileCompensationError ? error : undefined;
  }
}

export const dashboardFilesAdapter = new DashboardFilesAdapter();
