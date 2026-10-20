import {
  tool,
  type StructuredToolInterface,
  type ToolRuntime,
} from "@langchain/core/tools";
import type { AuthenticatedUser } from "../../identity/domain/auth-user.js";
import { expireIfStale } from "../../../shared/lib/lifecycle.js";
import {
  CONTEXT_PROPOSAL_TTL_MS,
  ContextProposalConflictError,
  ContextProposalNotFoundError,
  ContextProposalUnavailableError,
  proposeContextSchema,
  type AiContextProposalRepository,
  type ContextProposalProgressEvent,
} from "../domain/ai-context-proposals.js";
import { DrizzleAiContextProposalRepository } from "../infrastructure/ai-context-proposals-repository.js";

type RuntimeWithToolCallId = ToolRuntime & { toolCallId?: string };

export interface ContextProposalToolsOptions {
  currentUser: AuthenticatedUser;
  repository: AiContextProposalRepository;
  onProposal?: (event: ContextProposalProgressEvent) => void | Promise<void>;
  now?: () => Date;
}

export class ContextProposalTools {
  private readonly now: () => Date;

  constructor(private readonly options: ContextProposalToolsOptions) {
    this.now = options.now ?? (() => new Date());
    if (!options.currentUser.isAdmin)
      throw new Error(
        "Propostas de contexto estão disponíveis apenas para administradores.",
      );
  }

  tools(): StructuredToolInterface[] {
    return [this.proposeContextUpdate()];
  }

  private proposeContextUpdate() {
    return tool(
      async (input, runtime) => {
        const target = await this.options.repository.readTarget(input);
        if (!target)
          throw new Error("Servidor ou tabela catalogada não encontrada.");

        const proposal = await this.options.repository.createProposal({
          actorId: this.options.currentUser.id,
          targetType: target.targetType,
          dataSourceId: target.dataSourceId,
          tableId: target.tableId,
          sourceName: target.sourceName,
          schemaName: target.schemaName,
          tableName: target.tableName,
          baseContextVersion: target.contextVersion,
          currentContext: target.context,
          proposedContext: input.context,
          reason: input.reason,
          expiresAt: new Date(this.now().getTime() + CONTEXT_PROPOSAL_TTL_MS),
        });
        try {
          await this.options.onProposal?.({
            type: "context_proposal",
            toolCallId:
              (runtime as RuntimeWithToolCallId).toolCallId ??
              crypto.randomUUID(),
            proposal,
          });
        } catch {
          // Persisted proposals remain recoverable when the SSE client disconnects.
        }
        return {
          proposalId: proposal.id,
          status: proposal.status,
          targetType: proposal.targetType,
          target:
            proposal.targetType === "source"
              ? proposal.sourceName
              : `${proposal.sourceName} · ${proposal.schemaName}.${proposal.tableName}`,
          expiresAt: proposal.expiresAt.toISOString(),
          requiresAdminConfirmation: true,
          approved: false,
        };
      },
      {
        name: "propose_context_update",
        description:
          "Cria uma proposta persistida para alterar o contexto de um servidor ou tabela. Nunca aplica a alteração; um administrador deve revisar e aprovar em uma ação separada da interface. Use somente quando o administrador pedir explicitamente para propor uma alteração de contexto.",
        schema: proposeContextSchema,
      },
    );
  }
}

export class ContextProposalService {
  constructor(private readonly repository: AiContextProposalRepository) {}

  async get(proposalId: string, actorId: string, now = new Date()) {
    const proposal = await this.repository.transaction(async (tx) => {
      const current = await tx.lockProposal(proposalId, actorId);
      if (!current) return undefined;
      if (
        current.status === "pending" &&
        (await expireIfStale(current.expiresAt, now, () =>
          tx.updateProposalStatus(current.id, "expired", now),
        ))
      ) {
        return { ...current, status: "expired" as const, resolvedAt: now };
      }
      return current;
    });
    if (!proposal) throw new ContextProposalNotFoundError();
    return proposal;
  }

  async listPending(actorId: string, now = new Date()) {
    return this.repository.listPending(actorId, now);
  }

  async approve(proposalId: string, actorId: string, now = new Date()) {
    const result = await this.repository.transaction(async (tx) => {
      const proposal = await tx.lockProposal(proposalId, actorId);
      if (!proposal) return { kind: "missing" as const };
      if (proposal.status !== "pending")
        return { kind: "unavailable" as const, status: proposal.status };
      if (
        await expireIfStale(proposal.expiresAt, now, () =>
          tx.updateProposalStatus(proposal.id, "expired", now),
        )
      ) {
        return { kind: "unavailable" as const, status: "expired" as const };
      }

      const target = await tx.lockTarget(proposal);
      if (!target) {
        await tx.updateProposalStatus(proposal.id, "stale", now);
        return { kind: "conflict" as const };
      }
      if (
        target.contextVersion !== proposal.baseContextVersion ||
        target.context !== proposal.currentContext
      ) {
        await tx.updateProposalStatus(proposal.id, "stale", now);
        return { kind: "conflict" as const };
      }

      await tx.updateTargetContext(
        proposal,
        proposal.proposedContext,
        target.contextVersion + 1,
      );
      await tx.updateProposalStatus(proposal.id, "approved", now);
      return { kind: "approved" as const, proposal };
    });

    if (result.kind === "missing") throw new ContextProposalNotFoundError();
    if (result.kind === "unavailable")
      throw new ContextProposalUnavailableError(result.status);
    if (result.kind === "conflict") throw new ContextProposalConflictError();
    return { ...result.proposal, status: "approved" as const, resolvedAt: now };
  }

  async dismiss(proposalId: string, actorId: string, now = new Date()) {
    const result = await this.repository.transaction(async (tx) => {
      const proposal = await tx.lockProposal(proposalId, actorId);
      if (!proposal) return { kind: "missing" as const };
      if (proposal.status !== "pending")
        return { kind: "unavailable" as const, status: proposal.status };
      if (
        await expireIfStale(proposal.expiresAt, now, () =>
          tx.updateProposalStatus(proposal.id, "expired", now),
        )
      ) {
        return { kind: "unavailable" as const, status: "expired" as const };
      }
      await tx.updateProposalStatus(proposal.id, "dismissed", now);
      return { kind: "dismissed" as const, proposal };
    });

    if (result.kind === "missing") throw new ContextProposalNotFoundError();
    if (result.kind === "unavailable")
      throw new ContextProposalUnavailableError(result.status);
    return {
      ...result.proposal,
      status: "dismissed" as const,
      resolvedAt: now,
    };
  }
}

export const contextProposalService = new ContextProposalService(
  new DrizzleAiContextProposalRepository(),
);
