import { externalSource } from "../../data-sources/application/external-source.js";

import { z } from "zod";

import { dashboardFilesRepository } from "../infrastructure/dashboard-files-repository.js";
import { withDashboardFilesLock } from "../../../shared/db/db-executor.js";
import { savedQueriesPort } from "../../queries/application/saved-queries.js";
import {
  parameterDefinitionSchema,
  dashboardDocumentSchema,
} from "../../../shared/lib/contracts.js";

import {
  AI_QUERY_MAX_BYTES,
  AI_QUERY_MAX_ROWS,
} from "../../data-sources/domain/external-source.js";
import type { AuthenticatedUser } from "../../identity/domain/auth-user.js";

import {
  isEditableDashboardFilePath,
  writeDashboardDocumentAtomically,
} from "../domain/dashboards.js";
import {
  buildDashboardDefinitionFromDocument,
  dashboardQueryReferences,
} from "./dashboard-sync.js";

import {
  assertParameterDefinitions,
  assertSqlParameters,
  bindQueryParameters,
} from "../../../shared/security/query-security.js";

import { querySourceTargetHash } from "../../queries/domain/query-lifecycle.js";
import { validateDashboardPreviewFields } from "../domain/dashboard-preview-validation.js";
import {
  dashboardDocumentFingerprint,
  dashboardProposalPreviewScope,
  dashboardReferenceFingerprint,
} from "../domain/dashboard-proposals.js";
import {
  assertDashboardPreviewAcknowledged,
  assertDashboardProposalFresh,
  assertDashboardProposalUsable,
  isDashboardProposalAlreadyApplied,
} from "../domain/dashboard-proposal-lifecycle.js";
import { ApiError } from "../../../shared/lib/domain-error.js";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function previewDashboardProposal(
  currentUser: AuthenticatedUser,
  receiptId: string,
  input: {
    contextValues: Record<string, string | string[]>;
    componentIds: string[];
  },
) {
  const receipt = await savedQueriesPort().findReceipt(receiptId);
  if (!receipt)
    throw new ApiError(409, "A prévia expirou. Gere uma nova proposta.");
  try {
    assertDashboardProposalUsable(
      { ...receipt, mode: receipt.mode as "create" | "update" },
      currentUser.id,
      new Date(),
    );
  } catch {
    throw new ApiError(
      409,
      "A prévia expirou, já foi aplicada ou pertence a outra sessão. Gere uma nova proposta.",
    );
  }

  const document = dashboardDocumentSchema.parse(receipt.document);
  let previewScope: ReturnType<typeof dashboardProposalPreviewScope>;
  try {
    previewScope = dashboardProposalPreviewScope(document, input.componentIds);
  } catch (error) {
    throw new ApiError(
      400,
      error instanceof Error
        ? error.message
        : "Os componentes da prévia são inválidos.",
    );
  }
  const argumentNames = new Set(
    document.workspace.params.map((argument) => argument.name),
  );
  const unknownValues = Object.keys(input.contextValues).filter(
    (name) => !argumentNames.has(name),
  );
  if (unknownValues.length > 0)
    throw new ApiError(
      400,
      "A prévia recebeu filtros que não existem neste dashboard.",
    );
  const referenceIds = [...dashboardQueryReferences(document)];
  if (referenceIds.length === 0)
    throw new ApiError(409, "A proposta não possui queries salvas.");

  const queryRows = await savedQueriesPort().listWithSourcesByIds(referenceIds);
  if (queryRows.length !== referenceIds.length)
    throw new ApiError(
      409,
      "Uma query da proposta foi removida. Gere uma nova prévia.",
    );
  const referencesFingerprint = dashboardReferenceFingerprint(
    queryRows.map(({ query, source }) => ({
      queryId: query.id,
      queryUpdatedAt: query.updatedAt,
      dataSourceId: query.dataSourceId,
      sourceUpdatedAt: source.updatedAt,
      sourceTargetHash: querySourceTargetHash(source),
    })),
  );
  if (referencesFingerprint !== receipt.referenceFingerprint) {
    throw new ApiError(
      409,
      "Uma query ou servidor mudou desde a proposta. Gere uma nova prévia.",
    );
  }
  try {
    buildDashboardDefinitionFromDocument(
      document,
      queryRows.map(({ query }) => ({
        id: query.id,
        parameters: query.parameters,
      })),
      { validateCatalog: true },
    );
  } catch (error) {
    throw new ApiError(
      409,
      error instanceof Error
        ? error.message
        : "As referências do dashboard não são válidas.",
    );
  }

  const queryRowsById = new Map(queryRows.map((row) => [row.query.id, row]));
  const bindingByQueryId = new Map(
    document.queryBindings.map((binding) => [binding.queryUuid, binding]),
  );
  const componentQueryIds = [...previewScope.queryIds];
  const previews: Record<
    string,
    {
      rows: Record<string, unknown>[];
      rowLimit: number;
      byteLimit: number;
      bytes: number;
      truncated: boolean;
      truncationReason: "row_limit" | "byte_limit" | null;
      error?: string;
      previewPending?: string;
    }
  > = {};

  for (const queryId of componentQueryIds) {
    const entry = queryRowsById.get(queryId);
    if (!entry)
      throw new ApiError(
        409,
        "Uma query usada por um componente não existe mais.",
      );
    const parameters = z
      .array(parameterDefinitionSchema)
      .parse(entry.query.parameters);
    const binding = bindingByQueryId.get(queryId);
    const values: Record<string, string | string[]> = {};
    for (const [parameterName, source] of Object.entries(
      binding?.parameters ?? {},
    )) {
      if (source.source === "manual") values[parameterName] = source.value;
      else if (Object.hasOwn(input.contextValues, source.argument)) {
        const value = input.contextValues[source.argument]!;
        if (Array.isArray(value) ? value.length > 0 : value.trim().length > 0)
          values[parameterName] = value;
      }
    }
    const pending = parameters.filter((parameter) => {
      const value = values[parameter.name];
      return (
        parameter.required &&
        (value === undefined ||
          (Array.isArray(value)
            ? value.length === 0
            : value.trim().length === 0))
      );
    });
    if (pending.length > 0) {
      const labels = pending.map((parameter) => {
        const source = binding?.parameters[parameter.name];
        const argument =
          source?.source === "context"
            ? document.workspace.params.find(
                (item) => item.name === source.argument,
              )
            : undefined;
        return argument?.label ?? parameter.label;
      });
      previews[queryId] = {
        rows: [],
        rowLimit: AI_QUERY_MAX_ROWS,
        byteLimit: AI_QUERY_MAX_BYTES,
        bytes: 0,
        truncated: false,
        truncationReason: null,
        previewPending: `Preencha: ${labels.join(", ")}.`,
      };
      continue;
    }
    try {
      assertParameterDefinitions(parameters);
      assertSqlParameters(entry.query.sqlText, parameters);
      const bound = bindQueryParameters(
        entry.query.sqlText,
        parameters,
        values,
      );
      previews[queryId] =
        await externalSource().runBoundedReadOnlyQueryWithRetry(
          externalSource().sourceConnection(entry.source),
          bound.sqlText,
          bound.values,
          {
            rowLimit: AI_QUERY_MAX_ROWS,
            byteLimit: AI_QUERY_MAX_BYTES,
            preserveConfiguredSearchPath: true,
            allowGeneralReadOnlySql: true,
          },
        );
    } catch (error) {
      previews[queryId] = {
        rows: [],
        rowLimit: AI_QUERY_MAX_ROWS,
        byteLimit: AI_QUERY_MAX_BYTES,
        bytes: 0,
        truncated: false,
        truncationReason: null,
        error:
          error instanceof Error
            ? error.message.slice(0, 400)
            : "A consulta falhou durante o teste.",
      };
    }
  }
  const pendingIssues = Object.entries(previews).flatMap(
    ([queryId, preview]) =>
      preview.previewPending
        ? [
            `A prévia da query ${queryId.slice(0, 8)} continua aguardando filtros: ${preview.previewPending}`,
          ]
        : [],
  );
  const issues = [
    ...pendingIssues,
    ...validateDashboardPreviewFields(
      document,
      previews,
      new Set(previewScope.componentIds),
      new Set(previewScope.arguments.map((argument) => argument.name)),
    ),
  ];
  return { queries: previews, issues };
}
export async function commitDashboardProposal(
  currentUser: AuthenticatedUser,
  receiptId: string,
  confirmation: { acknowledgeTruncation: boolean },
) {
  let rollbackFile: (() => Promise<void>) | undefined;
  try {
    const committed = await withDashboardFilesLock(async (tx) => {
      const receipt = await dashboardFilesRepository.lockReceipt(tx, receiptId);
      const now = new Date();
      if (!receipt) {
        throw new ApiError(
          409,
          "A proposta expirou, já foi aplicada ou pertence a outra sessão. Gere uma nova prévia.",
        );
      }
      if (receipt.actorId !== currentUser.id) {
        throw new ApiError(
          409,
          "A proposta pertence a outra sessão. Gere uma nova prévia nesta sessão.",
        );
      }
      if (receipt.consumedAt) {
        const current = await dashboardFilesRepository.lockByDashboardId(
          tx,
          receipt.dashboardId,
        );
        if (current) {
          try {
            const persisted = dashboardDocumentSchema.parse(
              JSON.parse(
                await readFile(
                  resolve(process.cwd(), current.filePath),
                  "utf8",
                ),
              ) as unknown,
            );
            const persistedFingerprint =
              persisted.id === receipt.dashboardId
                ? dashboardDocumentFingerprint(persisted)
                : null;
            if (
              isDashboardProposalAlreadyApplied(
                receipt,
                currentUser.id,
                persistedFingerprint,
              )
            ) {
              return {
                id: receipt.dashboardId,
                mode: receipt.mode as "create" | "update",
                alreadyApplied: true,
              };
            }
          } catch {
            // The receipt is only idempotent while its exact document is still persisted.
          }
        }
        throw new ApiError(
          409,
          "A proposta já foi consumida, mas o dashboard mudou desde a aplicação. Recarregue a tela.",
        );
      }
      try {
        assertDashboardProposalUsable(
          { ...receipt, mode: receipt.mode as "create" | "update" },
          currentUser.id,
          now,
        );
      } catch {
        throw new ApiError(
          409,
          "A proposta expirou, já foi aplicada ou pertence a outra sessão. Gere uma nova prévia.",
        );
      }
      try {
        assertDashboardPreviewAcknowledged(
          receipt.hasTruncatedPreview,
          confirmation.acknowledgeTruncation,
        );
      } catch {
        throw new ApiError(
          400,
          "Confirme que revisou a prévia truncada antes de aplicar o dashboard.",
        );
      }
      const document = dashboardDocumentSchema.parse(receipt.document);
      if (document.id !== receipt.dashboardId) {
        throw new ApiError(
          409,
          "O conteúdo da proposta não corresponde ao recibo. Gere uma nova prévia.",
        );
      }
      const referenceIds = [...dashboardQueryReferences(document)];
      if (referenceIds.length === 0)
        throw new ApiError(409, "A proposta não possui queries salvas.");
      const queryRows = await savedQueriesPort().listWithSourcesByIds(
        referenceIds,
        tx,
      );
      if (queryRows.length !== referenceIds.length) {
        throw new ApiError(
          409,
          "Uma query da proposta foi removida. Gere a prévia novamente.",
        );
      }
      const referencesFingerprint = dashboardReferenceFingerprint(
        queryRows.map(({ query, source }) => ({
          queryId: query.id,
          queryUpdatedAt: query.updatedAt,
          dataSourceId: query.dataSourceId,
          sourceUpdatedAt: source.updatedAt,
          sourceTargetHash: querySourceTargetHash(source),
        })),
      );
      try {
        buildDashboardDefinitionFromDocument(
          document,
          queryRows.map(({ query }): { id: string; parameters: unknown } => ({
            id: query.id,
            parameters: query.parameters,
          })),
          { validateCatalog: true },
        );
      } catch (error) {
        throw new ApiError(
          409,
          error instanceof Error
            ? error.message
            : "As referências do dashboard não são válidas.",
        );
      }

      const target = await dashboardFilesRepository.lockByDashboardId(
        tx,
        receipt.dashboardId,
      );
      let filePath: string;
      let currentDashboardFingerprint: string | null;
      if (receipt.mode === "create") {
        if (receipt.expectedDashboardFingerprint !== null || target) {
          throw new ApiError(
            409,
            "O dashboard já existe. Gere uma proposta de edição para a versão atual.",
          );
        }
        currentDashboardFingerprint = null;
        filePath = resolve(
          process.cwd(),
          "dashboards",
          `${receipt.dashboardId}.json`,
        );
        try {
          await readFile(filePath);
          throw new ApiError(
            409,
            "Já existe um arquivo com o identificador proposto. Gere outra prévia.",
          );
        } catch (error) {
          if (error instanceof ApiError) throw error;
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      } else {
        if (!target || !receipt.expectedDashboardFingerprint) {
          throw new ApiError(
            409,
            "O dashboard foi removido depois da prévia. Gere outra proposta.",
          );
        }
        filePath = resolve(process.cwd(), target.filePath);
        if (!isEditableDashboardFilePath(filePath))
          throw new ApiError(
            409,
            "O arquivo do dashboard não está em um local editável.",
          );
        let currentDocument;
        try {
          currentDocument = dashboardDocumentSchema.parse(
            JSON.parse(await readFile(filePath, "utf8")) as unknown,
          );
        } catch {
          throw new ApiError(
            409,
            "Não foi possível verificar a versão atual do dashboard.",
          );
        }
        if (currentDocument.id !== receipt.dashboardId) {
          throw new ApiError(
            409,
            "O dashboard foi editado depois da prévia. Recarregue-o e gere uma nova proposta.",
          );
        }
        currentDashboardFingerprint =
          dashboardDocumentFingerprint(currentDocument);
      }

      try {
        assertDashboardProposalFresh(
          { ...receipt, mode: receipt.mode as "create" | "update" },
          {
            documentFingerprint: dashboardDocumentFingerprint(document),
            referenceFingerprint: referencesFingerprint,
            dashboardFingerprint: currentDashboardFingerprint,
          },
        );
      } catch {
        throw new ApiError(
          409,
          "O dashboard, uma query ou servidor mudou desde a prévia. Gere uma nova proposta.",
        );
      }

      rollbackFile = await writeDashboardDocumentAtomically(filePath, document);
      if (receipt.mode === "create") {
        const storedPath = filePath.slice(process.cwd().length + 1);
        const inserted = await dashboardFilesRepository.registerFile(
          tx,
          receipt.dashboardId,
          storedPath,
        );
        if (inserted.length === 0)
          throw new ApiError(
            409,
            "O identificador já está registrado por outro arquivo.",
          );
      }
      await dashboardFilesRepository.consumeReceipt(tx, receipt.id, now);
      return {
        id: receipt.dashboardId,
        mode: receipt.mode as "create" | "update",
        alreadyApplied: false,
      };
    });
    rollbackFile = undefined;
    return committed;
  } catch (error) {
    let rollbackError: unknown;
    try {
      await rollbackFile?.();
    } catch (restoreError) {
      rollbackError = restoreError;
      console.error(
        "[AI dashboard] file compensation failed after confirmation error",
        { error, restoreError },
      );
    }
    if (rollbackError) {
      throw new ApiError(
        500,
        "A aplicação falhou e a restauração do arquivo também falhou. O dashboard precisa de reconciliação administrativa.",
      );
    }
    if (error instanceof ApiError) throw error;
    console.error("[AI dashboard] confirmation failed", error);
    throw new ApiError(
      500,
      "Não foi possível aplicar a proposta do dashboard. As alterações em arquivo foram compensadas quando necessário; gere uma nova prévia.",
    );
  }
}
