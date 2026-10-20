import { describe, expect, it } from "vitest";
import {
  assertDashboardProposalFresh,
  assertDashboardProposalUsable,
  DashboardProposalConflict,
  assertDashboardPreviewAcknowledged,
  isDashboardProposalAlreadyApplied,
  type DashboardProposalReceiptState,
} from "./dashboard-proposal-lifecycle.js";

const receipt: DashboardProposalReceiptState = {
  actorId: "admin-1",
  mode: "update",
  expectedDashboardFingerprint: "d".repeat(64),
  documentFingerprint: "a".repeat(64),
  referenceFingerprint: "b".repeat(64),
  expiresAt: new Date("2026-09-29T13:00:00.000Z"),
  consumedAt: null,
};

describe("recibos de confirmação de dashboard", () => {
  it("rejeita ator trocado, replay e expiração", () => {
    expect(() =>
      assertDashboardProposalUsable(
        receipt,
        "other-admin",
        new Date("2026-09-29T12:00:00Z"),
      ),
    ).toThrowError(new DashboardProposalConflict("ACTOR_MISMATCH"));
    expect(() =>
      assertDashboardProposalUsable(
        { ...receipt, consumedAt: new Date() },
        "admin-1",
        new Date("2026-09-29T12:00:00Z"),
      ),
    ).toThrowError(new DashboardProposalConflict("REPLAY"));
    expect(() =>
      assertDashboardProposalUsable(
        receipt,
        "admin-1",
        new Date("2026-09-29T13:00:00Z"),
      ),
    ).toThrowError(new DashboardProposalConflict("EXPIRED"));
  });

  it("revalida fingerprint do documento, queries/servidores e revisão do alvo", () => {
    const current = {
      documentFingerprint: "a".repeat(64),
      referenceFingerprint: "b".repeat(64),
      dashboardFingerprint: "d".repeat(64),
    };
    expect(() => assertDashboardProposalFresh(receipt, current)).not.toThrow();
    expect(() =>
      assertDashboardProposalFresh(receipt, {
        ...current,
        documentFingerprint: "x".repeat(64),
      }),
    ).toThrowError(new DashboardProposalConflict("DOCUMENT_CHANGED"));
    expect(() =>
      assertDashboardProposalFresh(receipt, {
        ...current,
        referenceFingerprint: "x".repeat(64),
      }),
    ).toThrowError(new DashboardProposalConflict("REFERENCES_CHANGED"));
    expect(() =>
      assertDashboardProposalFresh(receipt, {
        ...current,
        dashboardFingerprint: "x".repeat(64),
      }),
    ).toThrowError(new DashboardProposalConflict("DASHBOARD_CHANGED"));
  });

  it("impede colisão de criação com dashboard existente", () => {
    const createReceipt = {
      ...receipt,
      mode: "create" as const,
      expectedDashboardFingerprint: null,
    };
    expect(() =>
      assertDashboardProposalFresh(createReceipt, {
        documentFingerprint: receipt.documentFingerprint,
        referenceFingerprint: receipt.referenceFingerprint,
        dashboardFingerprint: "existing-dashboard-hash",
      }),
    ).toThrowError(new DashboardProposalConflict("DASHBOARD_CHANGED"));
  });

  it("reconhece retry após resposta perdida somente para o mesmo ator e documento persistido", () => {
    const consumed = {
      ...receipt,
      consumedAt: new Date("2026-09-29T12:01:00Z"),
    };
    expect(
      isDashboardProposalAlreadyApplied(
        consumed,
        "admin-1",
        receipt.documentFingerprint,
      ),
    ).toBe(true);
    expect(
      isDashboardProposalAlreadyApplied(
        consumed,
        "other-admin",
        receipt.documentFingerprint,
      ),
    ).toBe(false);
    expect(
      isDashboardProposalAlreadyApplied(consumed, "admin-1", "x".repeat(64)),
    ).toBe(false);
    expect(
      isDashboardProposalAlreadyApplied(
        receipt,
        "admin-1",
        receipt.documentFingerprint,
      ),
    ).toBe(false);
  });

  it("exige confirmação explícita para prévia truncada", () => {
    expect(() => assertDashboardPreviewAcknowledged(true, false)).toThrowError(
      new DashboardProposalConflict("TRUNCATION_UNACKNOWLEDGED"),
    );
    expect(() => assertDashboardPreviewAcknowledged(true, true)).not.toThrow();
    expect(() =>
      assertDashboardPreviewAcknowledged(false, false),
    ).not.toThrow();
  });
});
