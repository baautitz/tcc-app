import { DomainError } from "../../../shared/lib/domain-error.js";
import { assertLive } from "../../../shared/lib/lifecycle.js";

export interface DashboardProposalReceiptState {
  actorId: string;
  mode: "create" | "update";
  expectedDashboardFingerprint: string | null;
  documentFingerprint: string;
  referenceFingerprint: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

export class DashboardProposalConflict extends DomainError {
  constructor(public readonly code: "ACTOR_MISMATCH" | "EXPIRED" | "REPLAY" | "DOCUMENT_CHANGED" | "REFERENCES_CHANGED" | "DASHBOARD_CHANGED" | "TRUNCATION_UNACKNOWLEDGED") {
    super(code, code, "conflict");
    this.name = "DashboardProposalConflict";
  }
}

export function isDashboardProposalAlreadyApplied(
  receipt: Pick<DashboardProposalReceiptState, "actorId" | "consumedAt" | "documentFingerprint">,
  actorId: string,
  persistedDocumentFingerprint: string | null,
): boolean {
  return receipt.actorId === actorId
    && receipt.consumedAt !== null
    && persistedDocumentFingerprint === receipt.documentFingerprint;
}

export function assertDashboardPreviewAcknowledged(
  hasTruncatedPreview: boolean,
  acknowledged: boolean,
): void {
  if (hasTruncatedPreview && !acknowledged) {
    throw new DashboardProposalConflict("TRUNCATION_UNACKNOWLEDGED");
  }
}

export function assertDashboardProposalUsable(
  receipt: DashboardProposalReceiptState,
  actorId: string,
  now: Date,
): void {
  if (receipt.actorId !== actorId) throw new DashboardProposalConflict("ACTOR_MISMATCH");
  if (receipt.consumedAt) throw new DashboardProposalConflict("REPLAY");
  assertLive(receipt.expiresAt, now, () => new DashboardProposalConflict("EXPIRED"));
}

export function assertDashboardProposalFresh(
  receipt: DashboardProposalReceiptState,
  current: {
    documentFingerprint: string;
    referenceFingerprint: string;
    dashboardFingerprint: string | null;
  },
): void {
  if (receipt.documentFingerprint !== current.documentFingerprint) throw new DashboardProposalConflict("DOCUMENT_CHANGED");
  if (receipt.referenceFingerprint !== current.referenceFingerprint) throw new DashboardProposalConflict("REFERENCES_CHANGED");
  if (receipt.mode === "create") {
    if (receipt.expectedDashboardFingerprint !== null || current.dashboardFingerprint !== null) throw new DashboardProposalConflict("DASHBOARD_CHANGED");
  } else if (!receipt.expectedDashboardFingerprint || receipt.expectedDashboardFingerprint !== current.dashboardFingerprint) {
    throw new DashboardProposalConflict("DASHBOARD_CHANGED");
  }
}
