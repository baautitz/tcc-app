import type { AiContextProposal } from "@/modules/ai/model/types";
import type {
  ComponentValues,
  DashboardPreviewQuery,
} from "@/modules/ai/model/chat-items";
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
  approveAiComponentReceipt = (id: string, values?: ComponentValues) =>
    this.http.request<{ id: string; approved: true }>(
      `/api/admin/ai/component-receipts/${encodeURIComponent(id)}/approve`,
      { method: "POST", ...(values ? { body: JSON.stringify(values) } : {}) },
    );
  /** Repete a prévia do componente isolado com os valores informados, sem a IA. */
  previewAiComponentReceipt = (id: string, values: ComponentValues) =>
    this.http.request<{ query: DashboardPreviewQuery }>(
      `/api/admin/ai/component-receipts/${encodeURIComponent(id)}/preview`,
      { method: "POST", body: JSON.stringify(values) },
    );
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
