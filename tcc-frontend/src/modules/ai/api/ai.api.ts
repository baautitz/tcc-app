import type { AiContextProposal } from "@/modules/ai/model/types";
import { httpClient, type HttpClient } from "@/shared/api/client";

export class AiApi {
  constructor(private readonly http: HttpClient) {}

  streamAiChat = (body: unknown, signal: AbortSignal) =>
    this.http.stream("/api/admin/ai/chat", {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
  pendingAiContextProposals = () =>
    this.http.request<AiContextProposal[]>("/api/admin/ai/context-proposals");
  aiContextProposal = (id: string) =>
    this.http.request<AiContextProposal>(
      `/api/admin/ai/context-proposals/${encodeURIComponent(id)}`,
    );
  approveAiContextProposal = (id: string) =>
    this.http.request<AiContextProposal>(
      `/api/admin/ai/context-proposals/${encodeURIComponent(id)}/approve`,
      { method: "POST" },
    );
  dismissAiContextProposal = (id: string) =>
    this.http.request<AiContextProposal>(
      `/api/admin/ai/context-proposals/${encodeURIComponent(id)}/dismiss`,
      { method: "POST" },
    );
}

export const aiApi = new AiApi(httpClient);
