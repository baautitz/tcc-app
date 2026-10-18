import type { AiContextProposal } from "@/modules/ai/model/types";
import { request, stream } from "@/shared/api/client";

export const aiApi = {
  streamAiChat: (body: unknown, signal: AbortSignal) =>
    stream("/api/admin/ai/chat", {
      method: "POST",
      headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }),
  pendingAiContextProposals: () =>
    request<AiContextProposal[]>("/api/admin/ai/context-proposals"),
  aiContextProposal: (id: string) =>
    request<AiContextProposal>(`/api/admin/ai/context-proposals/${encodeURIComponent(id)}`),
  approveAiContextProposal: (id: string) =>
    request<AiContextProposal>(`/api/admin/ai/context-proposals/${encodeURIComponent(id)}/approve`, { method: "POST" }),
  dismissAiContextProposal: (id: string) =>
    request<AiContextProposal>(`/api/admin/ai/context-proposals/${encodeURIComponent(id)}/dismiss`, { method: "POST" }),
};
