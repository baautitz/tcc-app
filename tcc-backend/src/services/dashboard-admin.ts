

import { z } from "zod";

import { dashboardFilesRepository } from "../repositories/dashboard-files-repository.js";
import { withDashboardFilesLock } from "../shared/db/db-executor.js";
import {
  
  
  
  
  
  
  
  
  dashboardCreateSchema,
  dashboardDocumentSchema,
  
  
  
} from "../shared/lib/contracts.js";

import { createDashboardFile, DashboardFileCompensationError, isEditableDashboardFilePath, syncDashboardDirectory, withDashboardFileCompensation, writeDashboardDocumentAtomically } from "./dashboards.js";

import { dashboardDocumentFingerprint } from "./ai-dashboard-proposals.js";

import { ApiError } from "../shared/lib/domain-error.js";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function syncDashboardDirectoryLocked() {
  return withDashboardFilesLock((tx) => syncDashboardDirectory(tx));
}
export async function createDashboard(input: z.infer<typeof dashboardCreateSchema>) {
  let rollbackFile: (() => Promise<void>) | undefined;
  let dashboard: Awaited<ReturnType<typeof createDashboardFile>>["dashboard"];
  try {
    dashboard = await withDashboardFileCompensation(
      () => withDashboardFilesLock(async (tx) => {
        const created = await createDashboardFile(input, tx);
        rollbackFile = created.rollback;
        return created.dashboard;
      }),
      () => rollbackFile,
    );
  } catch (error) {
    if (error instanceof DashboardFileCompensationError) {
      console.error("[dashboard] new-file compensation failed after transaction error", {
        operationError: error.operationError,
        compensationError: error.compensationError,
      });
      throw new ApiError(500, "O cadastro do dashboard falhou e a remoção do arquivo também falhou. É necessária reconciliação administrativa.");
    }
    throw error;
  }
  rollbackFile = undefined;
  return dashboard;
}
export async function saveDashboardDocument(dashboardId: string, input: { document: z.infer<typeof dashboardDocumentSchema>; expectedRevision: string }): Promise<void> {
  let rollbackFile: (() => Promise<void>) | undefined;
  try {
    await withDashboardFilesLock(async (tx) => {
      const target = await dashboardFilesRepository.lockByDashboardId(tx, dashboardId);
      if (!target) throw new ApiError(404, "Dashboard não encontrado.");
      const filePath = resolve(process.cwd(), target.filePath);
      if (!isEditableDashboardFilePath(filePath)) throw new ApiError(400, "O dashboard só pode ser gravado dentro da pasta dashboards da aplicação.");
      let currentDocument;
      try {
        currentDocument = dashboardDocumentSchema.parse(JSON.parse(await readFile(filePath, "utf8")) as unknown);
      } catch {
        throw new ApiError(409, "Não foi possível verificar a versão atual do dashboard. Recarregue-o.");
      }
      if (dashboardDocumentFingerprint(currentDocument) !== input.expectedRevision) {
        throw new ApiError(409, "O dashboard foi editado por outra sessão. Recarregue e aplique suas alterações novamente.");
      }
      rollbackFile = await writeDashboardDocumentAtomically(filePath, input.document);
    });
  } catch (error) {
    let rollbackError: unknown;
    try {
      await rollbackFile?.();
    } catch (restoreError) {
      rollbackError = restoreError;
      console.error("[dashboard] file compensation failed after context update error", { error, restoreError });
    }
    if (rollbackError) {
      throw new ApiError(500, "A atualização falhou e a restauração do arquivo também falhou. O dashboard precisa de reconciliação administrativa.");
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, error instanceof Error ? error.message : "Não foi possível salvar o dashboard.");
  }
  rollbackFile = undefined;
}
