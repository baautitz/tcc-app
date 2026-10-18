import type { DashboardFilesPort } from "../../queries/domain/dashboard-files-port.js";
import { DashboardFileCompensationError, getDashboardFiles, withDashboardFileCompensation, writeDashboardDocumentAtomically } from "../domain/dashboards.js";

export const dashboardFilesAdapter: DashboardFilesPort = {
  getFiles: getDashboardFiles,
  writeAtomically: writeDashboardDocumentAtomically,
  withCompensation: withDashboardFileCompensation,
  asCompensationFailure: (error) => error instanceof DashboardFileCompensationError ? error : undefined,
};
