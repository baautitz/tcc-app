import { describe, expect, it } from "vitest";
import {
  markQueryPreviewSavedOnce,
  movePendingQueryPreviewToEnd,
  shouldResurfaceQueryPreview,
  shouldSendPendingPreviewContext,
} from "@/modules/ai/model/chat-followup";

describe("continuação com prévia pendente", () => {
  it("reapresenta cartão ao pedir inclusão e reconhece acentos e referências indiretas", () => {
    expect(shouldResurfaceQueryPreview(
      "adicionar esta tabela no meu dashboard, usando os filtros disponíveis",
      "Vendas por cidade — agosto de 2017",
    )).toBe(true);
    expect(shouldResurfaceQueryPreview(
      "Inclua Vendas por cidade no painel",
      "Vendas por cidade — agosto de 2017",
    )).toBe(true);
    expect(shouldSendPendingPreviewContext("adicionar esta tabela no meu dashboard")).toBe(true);
    expect(shouldSendPendingPreviewContext('Respostas ao formulário "Como prosseguir?": agosto fixo')).toBe(true);
    expect(shouldSendPendingPreviewContext("quero acompanhar o filtro de período")).toBe(true);
    expect(shouldSendPendingPreviewContext("quero dinâmico")).toBe(true);
    expect(shouldResurfaceQueryPreview("agosto fixo", "Vendas por cidade")).toBe(true);
    expect(shouldResurfaceQueryPreview("quero dinâmico", "Vendas por cidade")).toBe(true);
    expect(shouldResurfaceQueryPreview("Respostas ao formulário: acompanhar Data inicial", "Vendas por cidade")).toBe(true);
  });

  it("não ressuscita prévia só porque a conversa menciona o nome da query", () => {
    expect(shouldResurfaceQueryPreview(
      "A query Vendas por cidade falhou ontem",
      "Vendas por cidade",
    )).toBe(false);
    expect(shouldSendPendingPreviewContext("quais foram as vendas por cidade?")).toBe(false);
  });

  it("move somente cartão pendente para depois da resposta mais recente", () => {
    const items = [
      { id: "preview-1", kind: "query_preview", stale: false },
      { id: "user-1", kind: "message" },
      { id: "assistant-1", kind: "message" },
    ];
    expect(movePendingQueryPreviewToEnd(items, "preview-1").map(({ id }) => id)).toEqual([
      "user-1", "assistant-1", "preview-1",
    ]);
  });

  it("mantém cartões salvos, desatualizados ou inexistentes no lugar", () => {
    const saved = [{ id: "saved", kind: "query_preview", savedQueryId: "query-1" }, { id: "message", kind: "message" }];
    const stale = [{ id: "stale", kind: "query_preview", stale: true }, { id: "message", kind: "message" }];
    expect(movePendingQueryPreviewToEnd(saved, "saved")).toBe(saved);
    expect(movePendingQueryPreviewToEnd(stale, "stale")).toBe(stale);
    expect(movePendingQueryPreviewToEnd(stale, "missing")).toBe(stale);
  });

  it("ao salvar cartões ressurgidos, mantém um único cartão atualizado", () => {
    type TestItem = {
      id: string;
      kind: string;
      testRunId?: string;
      savedQueryId?: string;
      savedQueryName?: string;
      stale?: boolean;
      name?: string;
    };
    const items: TestItem[] = [
      { id: "original", kind: "query_preview", testRunId: "run-1", name: "Vendas" },
      { id: "message", kind: "message" },
      { id: "resurfaced", kind: "query_preview", testRunId: "run-1", name: "Vendas" },
    ];
    const saved = markQueryPreviewSavedOnce(items, "run-1", "query-1", "Vendas", {
      id: "fallback", kind: "query_preview", testRunId: "run-1", savedQueryId: "query-1",
    });

    expect(saved.map(({ id }) => id)).toEqual(["message", "resurfaced"]);
    expect(saved[1]).toMatchObject({ savedQueryId: "query-1", savedQueryName: "Vendas", stale: false });
  });
});
