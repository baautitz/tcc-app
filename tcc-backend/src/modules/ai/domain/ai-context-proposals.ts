import { DomainError } from "../../../shared/lib/domain-error.js";
import { z } from "zod";

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

export const proposeContextSchema = z
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
