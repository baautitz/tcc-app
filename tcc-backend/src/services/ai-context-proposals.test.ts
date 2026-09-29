import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "./auth.js";
import {
  approveContextProposal,
  ContextProposalConflictError,
  ContextProposalUnavailableError,
  createAiContextProposalTools,
  dismissContextProposal,
  getContextProposal,
  listPendingContextProposals,
  type AiContextProposal,
  type AiContextProposalRepository,
  type ContextProposalTarget,
  type ContextProposalTransaction,
} from "./ai-context-proposals.js";

const admin = { id: "admin-id", name: "Admin", email: "admin@example.test", active: true, isAdmin: true, permissions: [] } as AuthenticatedUser;
const sourceId = "10000000-0000-4000-8000-000000000001";
const tableId = "20000000-0000-4000-8000-000000000002";

class FakeRepository implements AiContextProposalRepository {
  target: ContextProposalTarget = {
    targetType: "table",
    dataSourceId: sourceId,
    sourceName: "Analytics",
    tableId,
    schemaName: "public",
    tableName: "orders",
    contextVersion: 3,
    context: "Order records",
  };
  proposals = new Map<string, AiContextProposal>();
  writes: string[] = [];
  nextId = 0;

  async readTarget(input: { targetType: "source" | "table"; dataSourceId: string; tableId?: string }) {
    if (input.dataSourceId !== this.target.dataSourceId) return undefined;
    if (input.targetType === "table" && input.tableId !== this.target.tableId) return undefined;
    return { ...this.target };
  }

  async createProposal(input: Omit<AiContextProposal, "id" | "createdAt" | "resolvedAt" | "status">) {
    const proposal: AiContextProposal = {
      ...input,
      id: `30000000-0000-4000-8000-${String(++this.nextId).padStart(12, "0")}`,
      status: "pending",
      createdAt: new Date("2026-09-29T12:00:00.000Z"),
      resolvedAt: null,
    };
    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  async findProposal(proposalId: string) {
    return this.proposals.get(proposalId);
  }

  async listPending(actorId: string, now: Date) {
    return [...this.proposals.values()].filter((proposal) => proposal.actorId === actorId && proposal.status === "pending" && proposal.expiresAt > now);
  }

  async transaction<T>(work: (tx: ContextProposalTransaction) => Promise<T>) {
    const tx: ContextProposalTransaction = {
      lockProposal: async (proposalId, actorId) => {
        const proposal = this.proposals.get(proposalId);
        return proposal?.actorId === actorId ? proposal : undefined;
      },
      lockTarget: async (proposal) => {
        if (proposal.dataSourceId !== this.target.dataSourceId) return undefined;
        if (proposal.targetType === "table" && proposal.tableId !== this.target.tableId) return undefined;
        return { ...this.target };
      },
      updateTargetContext: async (proposal, context, nextVersion) => {
        this.writes.push("context");
        this.target = { ...this.target, context, contextVersion: nextVersion };
        if (proposal.targetType === "source") this.target.targetType = "source";
      },
      updateProposalStatus: async (proposalId, status, resolvedAt) => {
        const proposal = this.proposals.get(proposalId);
        if (proposal) this.proposals.set(proposalId, { ...proposal, status, resolvedAt });
      },
    };
    return work(tx);
  }
}

describe("propostas de contexto da IA", () => {
  it("persiste uma proposta, mas a ferramenta nunca altera o contexto", async () => {
    const repository = new FakeRepository();
    const events: unknown[] = [];
    const [contextTool] = createAiContextProposalTools({
      currentUser: admin,
      repository,
      onProposal: (event) => { events.push(event); },
    });
    const result = await contextTool!.invoke({
      targetType: "table",
      dataSourceId: sourceId,
      tableId: tableId,
      context: "Order lines with one row per purchase item",
      reason: "Clarifies the grain of the table",
    }) as { proposalId: string; approved: boolean; requiresAdminConfirmation: boolean };

    expect(result.approved).toBe(false);
    expect(result.requiresAdminConfirmation).toBe(true);
    expect(repository.writes).toEqual([]);
    expect(repository.target.context).toBe("Order records");
    expect(await repository.findProposal(result.proposalId)).toMatchObject({ status: "pending", actorId: admin.id, baseContextVersion: 3 });
    expect(events).toHaveLength(1);
  });

  it("aplica contexto somente após aprovação explícita e incrementa sua versão", async () => {
    const repository = new FakeRepository();
    const [contextTool] = createAiContextProposalTools({ currentUser: admin, repository });
    const { proposalId } = await contextTool!.invoke({
      targetType: "table",
      dataSourceId: sourceId,
      tableId: tableId,
      context: "One row per order line",
      reason: "Defines table grain",
    }) as { proposalId: string };

    const result = await approveContextProposal(repository, proposalId, admin.id, new Date("2026-09-29T12:01:00.000Z"));
    expect(result.status).toBe("approved");
    expect(repository.target.context).toBe("One row per order line");
    expect(repository.target.contextVersion).toBe(4);
    expect(repository.writes).toEqual(["context"]);
  });

  it("marca proposta obsoleta sem escrever quando a revisão mudou", async () => {
    const repository = new FakeRepository();
    const [contextTool] = createAiContextProposalTools({ currentUser: admin, repository });
    const { proposalId } = await contextTool!.invoke({
      targetType: "table",
      dataSourceId: sourceId,
      tableId: tableId,
      context: "New version",
      reason: "Updated description",
    }) as { proposalId: string };
    repository.target = { ...repository.target, context: "Manually changed", contextVersion: 4 };

    await expect(approveContextProposal(repository, proposalId, admin.id)).rejects.toBeInstanceOf(ContextProposalConflictError);
    expect((await repository.findProposal(proposalId))?.status).toBe("stale");
    expect(repository.writes).toEqual([]);
    expect(repository.target.context).toBe("Manually changed");
  });

  it("impede que outro administrador leia ou resolva a proposta", async () => {
    const repository = new FakeRepository();
    const [contextTool] = createAiContextProposalTools({ currentUser: admin, repository });
    const { proposalId } = await contextTool!.invoke({
      targetType: "table",
      dataSourceId: sourceId,
      tableId,
      context: "Private pending proposal",
      reason: "Created by another administrator",
    }) as { proposalId: string };
    const otherAdminId = "other-admin-id";

    await expect(getContextProposal(repository, proposalId, otherAdminId))
      .rejects.toMatchObject({ name: "ContextProposalNotFoundError" });
    expect(await listPendingContextProposals(repository, otherAdminId)).toEqual([]);
    await expect(approveContextProposal(repository, proposalId, otherAdminId))
      .rejects.toMatchObject({ name: "ContextProposalNotFoundError" });
    await expect(dismissContextProposal(repository, proposalId, otherAdminId))
      .rejects.toMatchObject({ name: "ContextProposalNotFoundError" });
    expect(repository.writes).toEqual([]);
    expect((await repository.findProposal(proposalId))?.status).toBe("pending");
  });

  it("marca expirada ao recuperar uma proposta fora do TTL", async () => {
    const repository = new FakeRepository();
    const [contextTool] = createAiContextProposalTools({ currentUser: admin, repository });
    const { proposalId } = await contextTool!.invoke({
      targetType: "table",
      dataSourceId: sourceId,
      tableId,
      context: "Expired context",
      reason: "Old proposal",
    }) as { proposalId: string };

    const recovered = await getContextProposal(repository, proposalId, admin.id, new Date("2027-01-01T00:00:00.000Z"));
    expect(recovered.status).toBe("expired");
    expect((await repository.findProposal(proposalId))?.status).toBe("expired");
    await expect(approveContextProposal(repository, proposalId, admin.id)).rejects.toBeInstanceOf(ContextProposalUnavailableError);
    expect(repository.writes).toEqual([]);
  });

  it("dismissal resolve apenas o registro e uma proposta expirada não pode ser aprovada", async () => {
    const repository = new FakeRepository();
    const [contextTool] = createAiContextProposalTools({ currentUser: admin, repository });
    const first = await contextTool!.invoke({
      targetType: "table",
      dataSourceId: sourceId,
      tableId: tableId,
      context: "Unused proposal",
      reason: "Pending choice",
    }) as { proposalId: string };
    await dismissContextProposal(repository, first.proposalId, admin.id);
    expect((await repository.findProposal(first.proposalId))?.status).toBe("dismissed");
    expect(repository.writes).toEqual([]);

    const second = await contextTool!.invoke({
      targetType: "table",
      dataSourceId: sourceId,
      tableId: tableId,
      context: "Expired proposal",
      reason: "Pending choice",
    }) as { proposalId: string };
    await expect(approveContextProposal(repository, second.proposalId, admin.id, new Date("2027-01-01T00:00:00.000Z")))
      .rejects.toBeInstanceOf(ContextProposalUnavailableError);
    expect((await repository.findProposal(second.proposalId))?.status).toBe("expired");
    expect(repository.writes).toEqual([]);
  });
});
