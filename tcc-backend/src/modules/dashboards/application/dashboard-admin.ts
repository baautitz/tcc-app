import { z } from "zod";

import {
  DrizzleDashboardFilesRepository,
  type DashboardFilesRepository,
} from "../infrastructure/dashboard-files-repository.js";
import {
  DrizzleDashboardAccessRepository,
  type DashboardAccessRepository,
} from "../infrastructure/dashboard-access-repository.js";
import { withDashboardFilesLock } from "../../../shared/db/db-executor.js";
import {
  dashboardCreateSchema,
  dashboardDocumentSchema,
} from "../../../shared/lib/contracts.js";

import {
  DashboardFileCompensationError,
  isEditableDashboardFilePath,
  withDashboardFileCompensation,
  writeDashboardDocumentAtomically,
} from "../domain/dashboards.js";
import {
  dashboardRegistry,
  type DashboardRegistryService,
} from "./dashboard-registry.js";

import { dashboardDocumentFingerprint } from "../domain/dashboard-proposals.js";

import { ApiError } from "../../../shared/lib/domain-error.js";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export class DashboardAdminService {
  constructor(
    private readonly registry: Pick<
      DashboardRegistryService,
      | "syncDashboardDirectory"
      | "createDashboardFile"
      | "getRegisteredDashboardFiles"
      | "getDashboardFileById"
    >,
    private readonly files: Pick<DashboardFilesRepository, "lockByDashboardId">,
    private readonly access: DashboardAccessRepository,
  ) {}

  async syncDashboardDirectoryLocked() {
    return withDashboardFilesLock((tx) =>
      this.registry.syncDashboardDirectory(tx),
    );
  }
  async createDashboard(input: z.infer<typeof dashboardCreateSchema>) {
    let rollbackFile: (() => Promise<void>) | undefined;
    let dashboard: Awaited<
      ReturnType<DashboardRegistryService["createDashboardFile"]>
    >["dashboard"];
    try {
      dashboard = await withDashboardFileCompensation(
        () =>
          withDashboardFilesLock(async (tx) => {
            const created = await this.registry.createDashboardFile(input, tx);
            rollbackFile = created.rollback;
            return created.dashboard;
          }),
        () => rollbackFile,
      );
    } catch (error) {
      if (error instanceof DashboardFileCompensationError) {
        console.error(
          "[dashboard] new-file compensation failed after transaction error",
          {
            operationError: error.operationError,
            compensationError: error.compensationError,
          },
        );
        throw new ApiError(
          500,
          "O cadastro do dashboard falhou e a remoção do arquivo também falhou. É necessária reconciliação administrativa.",
        );
      }
      throw error;
    }
    rollbackFile = undefined;
    return dashboard;
  }
  async saveDashboardDocument(
    dashboardId: string,
    input: {
      document: z.infer<typeof dashboardDocumentSchema>;
      expectedRevision: string;
    },
  ): Promise<void> {
    let rollbackFile: (() => Promise<void>) | undefined;
    try {
      await withDashboardFilesLock(async (tx) => {
        const target = await this.files.lockByDashboardId(tx, dashboardId);
        if (!target) throw new ApiError(404, "Dashboard não encontrado.");
        const filePath = resolve(process.cwd(), target.filePath);
        if (!isEditableDashboardFilePath(filePath))
          throw new ApiError(
            400,
            "O dashboard só pode ser gravado dentro da pasta dashboards da aplicação.",
          );
        let currentDocument;
        try {
          currentDocument = dashboardDocumentSchema.parse(
            JSON.parse(await readFile(filePath, "utf8")) as unknown,
          );
        } catch {
          throw new ApiError(
            409,
            "Não foi possível verificar a versão atual do dashboard. Recarregue-o.",
          );
        }
        if (
          dashboardDocumentFingerprint(currentDocument) !==
          input.expectedRevision
        ) {
          throw new ApiError(
            409,
            "O dashboard foi editado por outra sessão. Recarregue e aplique suas alterações novamente.",
          );
        }
        rollbackFile = await writeDashboardDocumentAtomically(
          filePath,
          input.document,
        );
      });
    } catch (error) {
      let rollbackError: unknown;
      try {
        await rollbackFile?.();
      } catch (restoreError) {
        rollbackError = restoreError;
        console.error(
          "[dashboard] file compensation failed after context update error",
          { error, restoreError },
        );
      }
      if (rollbackError) {
        throw new ApiError(
          500,
          "A atualização falhou e a restauração do arquivo também falhou. O dashboard precisa de reconciliação administrativa.",
        );
      }
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        500,
        error instanceof Error
          ? error.message
          : "Não foi possível salvar o dashboard.",
      );
    }
    rollbackFile = undefined;
  }

  async getAdminDashboard(dashboardId: string) {
    const entry = (await this.registry.getRegisteredDashboardFiles()).find(
      (item) => item.dashboard.id === dashboardId,
    );
    if (!entry) throw new ApiError(404, "Dashboard não encontrado.");
    return {
      document: entry.dashboard,
      revision: dashboardDocumentFingerprint(entry.dashboard),
    };
  }

  async getDashboardUsers(dashboardId: string) {
    const dashboard = await this.registry.getDashboardFileById(dashboardId);
    if (!dashboard) throw new ApiError(404, "Dashboard não encontrado.");
    const assigned = await this.access.listAssignedUserIds(dashboardId);
    const availableUsers = await this.access.listAssignableUsers();
    return {
      users: availableUsers,
      userIds: assigned.map((assignment) => assignment.userId),
    };
  }

  /** `parseInput` roda depois da checagem de existência, como antes. */
  async setDashboardUsers(
    dashboardId: string,
    parseInput: () => Promise<{ userIds: string[] }>,
  ) {
    const dashboard = await this.registry.getDashboardFileById(dashboardId);
    if (!dashboard) throw new ApiError(404, "Dashboard não encontrado.");
    const input = await parseInput();
    const uniqueUserIds = [...new Set(input.userIds)];
    if (uniqueUserIds.length !== input.userIds.length)
      throw new ApiError(
        400,
        "Não repita usuários na lista de acesso do dashboard.",
      );
    const knownUsers = await this.access.findKnownUserIds(uniqueUserIds);
    if (knownUsers.length !== uniqueUserIds.length)
      throw new ApiError(400, "Um ou mais usuários selecionados não existem.");
    await this.access.replaceUsers(dashboardId, uniqueUserIds);
    return { dashboardId, userIds: uniqueUserIds };
  }
}

export const dashboardAdminService = new DashboardAdminService(
  dashboardRegistry,
  new DrizzleDashboardFilesRepository(),
  new DrizzleDashboardAccessRepository(),
);
