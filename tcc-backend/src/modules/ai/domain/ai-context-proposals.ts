import { DomainError } from "../../../shared/lib/domain-error.js";
import {
  tool,
  type StructuredToolInterface,
  type ToolRuntime,
} from "@langchain/core/tools";
import { z } from "zod";
import type { AuthenticatedUser } from "../../identity/domain/auth-user.js";
import { expireIfStale } from "../../../shared/lib/lifecycle.js";

export const CONTEXT_PROPOSAL_TTL_MS = 10 * 60 * 1000;

export type ContextProposalTargetType = "source" | "table";
export type ContextProposalStatus =
  "pending" | "approved" | "dismissed" | "stale" | "expired";

export interface ContextProposalTarget {
  targetType: ContextProposalTargetType;
  dataSourceId: string;
  sourceName: string;
  tableId: string | null;
  schemaName: string | null;
  tableName: string | null;
  contextVersion: number;
  context: string;
}

export interface AiContextProposal {
  id: string;
  actorId: string;
  targetType: ContextProposalTargetType;
  dataSourceId: string;
  tableId: string | null;
  sourceName: string;
  schemaName: string | null;
  tableName: string | null;
  baseContextVersion: number;
  currentContext: string;
  proposedContext: string;
  reason: string;
  status: ContextProposalStatus;
  expiresAt: Date;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface ContextProposalTransaction {
  lockProposal(
    proposalId: string,
    actorId: string,
  ): Promise<AiContextProposal | undefined>;
  lockTarget(
    proposal: AiContextProposal,
  ): Promise<ContextProposalTarget | undefined>;
  updateTargetContext(
    proposal: AiContextProposal,
    context: string,
    nextVersion: number,
  ): Promise<void>;
  updateProposalStatus(
    proposalId: string,
    status: ContextProposalStatus,
    resolvedAt: Date,
  ): Promise<void>;
}

export interface AiContextProposalRepository {
  readTarget(input: {
    targetType: ContextProposalTargetType;
    dataSourceId: string;
    tableId?: string;
  }): Promise<ContextProposalTarget | undefined>;
  createProposal(
    input: Omit<
      AiContextProposal,
      "id" | "createdAt" | "resolvedAt" | "status"
    >,
  ): Promise<AiContextProposal>;
  findProposal(proposalId: string): Promise<AiContextProposal | undefined>;
  listPending(actorId: string, now: Date): Promise<AiContextProposal[]>;
  transaction<T>(
    work: (tx: ContextProposalTransaction) => Promise<T>,
  ): Promise<T>;
}

export class ContextProposalConflictError extends DomainError {
  constructor(
    message = "O contexto mudou desde a criação desta proposta. Peça à IA uma nova proposta.",
  ) {
    super(message, "CONFLICT", "conflict");
    this.name = "ContextProposalConflictError";
  }
}

export class ContextProposalNotFoundError extends DomainError {
  constructor() {
    super("Proposta de contexto não encontrada.", "NOT_FOUND", "not_found");
    this.name = "ContextProposalNotFoundError";
  }
}

export class ContextProposalTargetNotFoundError extends DomainError {
  constructor() {
    super(
      "Servidor ou tabela de destino não existe mais.",
      "TARGET_NOT_FOUND",
      "not_found",
    );
    this.name = "ContextProposalTargetNotFoundError";
  }
}

export class ContextProposalUnavailableError extends DomainError {
  constructor(status: ContextProposalStatus) {
    super(
      status === "expired"
        ? "A proposta expirou. Peça à IA uma nova proposta."
        : "Esta proposta já foi resolvida.",
      "UNAVAILABLE",
      "conflict",
    );
    this.name = "ContextProposalUnavailableError";
  }
}

const proposeContextSchema = z
  .object({
    targetType: z.enum(["source", "table"]),
    dataSourceId: z.string().uuid(),
    tableId: z.string().uuid().optional(),
    context: z.string().max(20_000),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.targetType === "table" && !input.tableId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tableId"],
        message: "Informe a tabela catalogada.",
      });
    }
    if (input.targetType === "source" && input.tableId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tableId"],
        message: "O contexto do servidor não recebe ID de tabela.",
      });
    }
  });

export type ContextProposalProgressEvent = {
  type: "context_proposal";
  toolCallId: string;
  proposal: AiContextProposal;
};

type RuntimeWithToolCallId = ToolRuntime & { toolCallId?: string };

export function createAiContextProposalTools(options: {
  currentUser: AuthenticatedUser;
  repository: AiContextProposalRepository;
  onProposal?: (event: ContextProposalProgressEvent) => void | Promise<void>;
  now?: () => Date;
}): StructuredToolInterface[] {
  const now = options.now ?? (() => new Date());
  if (!options.currentUser.isAdmin)
    throw new Error(
      "Propostas de contexto estão disponíveis apenas para administradores.",
    );

  const proposeContextUpdate = tool(
    async (input, runtime) => {
      const target = await options.repository.readTarget(input);
      if (!target)
        throw new Error("Servidor ou tabela catalogada não encontrada.");

      const proposal = await options.repository.createProposal({
        actorId: options.currentUser.id,
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
        expiresAt: new Date(now().getTime() + CONTEXT_PROPOSAL_TTL_MS),
      });
      try {
        await options.onProposal?.({
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

  return [proposeContextUpdate];
}

export async function getContextProposal(
  repository: AiContextProposalRepository,
  proposalId: string,
  actorId: string,
  now = new Date(),
) {
  const proposal = await repository.transaction(async (tx) => {
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

export async function listPendingContextProposals(
  repository: AiContextProposalRepository,
  actorId: string,
  now = new Date(),
) {
  return repository.listPending(actorId, now);
}

export async function approveContextProposal(
  repository: AiContextProposalRepository,
  proposalId: string,
  actorId: string,
  now = new Date(),
) {
  const result = await repository.transaction(async (tx) => {
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

export async function dismissContextProposal(
  repository: AiContextProposalRepository,
  proposalId: string,
  actorId: string,
  now = new Date(),
) {
  const result = await repository.transaction(async (tx) => {
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
  return { ...result.proposal, status: "dismissed" as const, resolvedAt: now };
}
