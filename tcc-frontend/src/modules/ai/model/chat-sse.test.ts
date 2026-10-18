import { describe, expect, it } from "vitest";
import { readChatStream, SseV1Parser } from "@/modules/ai/model/chat-sse";

function wireEvent(eventName: string, payload: unknown, ending = "\n\n") {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}${ending}`;
}

describe("protocolo SSE v1 do chat", () => {
  it("preserva a ordem ao receber linhas CRLF fragmentadas entre chunks", () => {
    const parser = new SseV1Parser();
    const wire = [
      wireEvent("start", { version: 1, type: "start", requestId: "r1", messageId: "m1" }, "\r\n\r\n"),
      wireEvent("token", { version: 1, type: "token", messageId: "m1", delta: "Olá" }, "\r\n\r\n"),
      wireEvent("done", { version: 1, type: "done", messageId: "m1", finishReason: "stop" }, "\r\n\r\n"),
    ].join("");
    const events = [...wire].flatMap((character) => parser.push(character));
    events.push(...parser.push("", true));

    expect(events.map((event) => event.type)).toEqual(["start", "token", "done"]);
    expect(events[1]).toMatchObject({ type: "token", delta: "Olá" });
  });

  it("junta campos data repetidos e ignora heartbeat/comentários e campos desconhecidos", () => {
    const parser = new SseV1Parser();
    const events = parser.push([
      "event: start",
      'data: {"version":1,"type":"start","requestId":"r2","messageId":"m2"}',
      "",
      "",
      ": keep-alive",
      "id: ignored-event-id",
      "event: token",
      'data: {"version":1,',
      'data: "type":"token","messageId":"m2","delta":"Oi"}',
      "",
      "",
      "event: done",
      'data: {"version":1,"type":"done","messageId":"m2","finishReason":"stop"}',
      "",
      "",
    ].join("\n"), true);

    expect(events.map((event) => event.type)).toEqual(["start", "token", "done"]);
    expect(events[1]).toMatchObject({ version: 1, type: "token", messageId: "m2", delta: "Oi" });
  });

  it("decodifica caracteres UTF-8 divididos no meio do byte sequence", async () => {
    const events: unknown[] = [];
    const wire = wireEvent("start", { version: 1, type: "start", requestId: "r3", messageId: "m3" }) +
      wireEvent("token", { version: 1, type: "token", messageId: "m3", delta: "ação" }) +
      wireEvent("done", { version: 1, type: "done", messageId: "m3", finishReason: "stop" });
    const encoded = new TextEncoder().encode(wire);
    const splitAt = new TextEncoder().encode(wire.slice(0, wire.indexOf("ç"))).length + 1;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, splitAt));
        controller.enqueue(encoded.slice(splitAt));
        controller.close();
      },
    });

    await readChatStream(body, (event) => events.push(event));

    expect(events).toEqual([
      { version: 1, type: "start", requestId: "r3", messageId: "m3" },
      { version: 1, type: "token", messageId: "m3", delta: "ação" },
      { version: 1, type: "done", messageId: "m3", finishReason: "stop" },
    ]);
  });

  it("despacha o último evento completo no EOF mesmo sem a linha em branco final", () => {
    const parser = new SseV1Parser();
    parser.push(wireEvent("start", { version: 1, type: "start", requestId: "r4", messageId: "m4" }));
    const events = parser.push(wireEvent("done", {
      version: 1,
      type: "done",
      messageId: "m4",
      finishReason: null,
    }, ""), true);

    expect(events).toMatchObject([{ type: "done", finishReason: null }]);
  });

  it.each([
    ["versão desconhecida", "token", { version: 2, type: "token", messageId: "m", delta: "x" }, /versão.*não é compatível/i],
    ["nome de evento divergente", "token", { version: 1, type: "done", messageId: "m", finishReason: null }, /não corresponde ao protocolo/i],
    ["token incompleto", "token", { version: 1, type: "token", messageId: 1, delta: "x" }, /evento de texto.*malformado/i],
    ["tipo desconhecido", "unknown", { version: 1, type: "unknown" }, /evento.*desconhecido/i],
  ])("rejeita %s", (_label, eventName, payload, error) => {
    const parser = new SseV1Parser();
    expect(() => parser.push(wireEvent(eventName, payload), true)).toThrow(error as RegExp);
  });

  it.each([
    ["token antes de start", [], "token", { version: 1, type: "token", messageId: "m", delta: "x" }, /antes do evento de início/i],
    ["start duplicado", [["start", { version: 1, type: "start", requestId: "r", messageId: "m" }]], "start", { version: 1, type: "start", requestId: "r2", messageId: "m2" }, /mais de uma vez/i],
    ["messageId divergente", [["start", { version: 1, type: "start", requestId: "r", messageId: "m" }]], "token", { version: 1, type: "token", messageId: "other", delta: "x" }, /ID da mensagem.*não corresponde/i],
    ["evento após done", [["start", { version: 1, type: "start", requestId: "r", messageId: "m" }], ["done", { version: 1, type: "done", messageId: "m", finishReason: null }]], "token", { version: 1, type: "token", messageId: "m", delta: "x" }, /após a conclusão/i],
  ])("impõe a sequência do protocolo: %s", (_label, before, eventName, payload, error) => {
    const parser = new SseV1Parser();
    for (const [name, value] of before as Array<[string, unknown]>) {
      parser.push(wireEvent(name, value));
    }
    expect(() => parser.push(wireEvent(eventName as string, payload), true)).toThrow(error as RegExp);
  });

  it("valida os limites e campos dos eventos de prévia antes de expô-los ao chat", () => {
    const queryPreview = {
      version: 1,
      type: "query_preview",
      toolCallId: "tool-1",
      testRunId: "run-1",
      dataSource: { id: "source-1", name: "Analytics" },
      intent: { mode: "create", queryName: "Pedidos" },
      sqlText: "SELECT 1",
      parameters: [],
      testValues: {},
      rows: [{ total: 1 }],
      rowCount: 1,
      rowLimit: 50,
      byteLimit: 48_000,
      bytes: 12,
      truncated: false,
      truncationReason: null,
    };
    const validParser = new SseV1Parser();
    validParser.push(wireEvent("start", { version: 1, type: "start", requestId: "r5", messageId: "m5" }));
    expect(validParser.push(wireEvent("query_preview", queryPreview))[0]).toMatchObject({ type: "query_preview", rowCount: 1 });
    expect(validParser.push(wireEvent("done", { version: 1, type: "done", messageId: "m5", finishReason: "stop" }), true)[0]).toMatchObject({ type: "done" });

    const invalidParser = new SseV1Parser();
    invalidParser.push(wireEvent("start", { version: 1, type: "start", requestId: "r6", messageId: "m6" }));
    expect(() => invalidParser.push(wireEvent("query_preview", { ...queryPreview, rowCount: 2 }), true)).toThrow(/prévia da query.*malformada/i);
  });

  it("aceita proposta de contexto para revisão e rejeita limites inconsistentes na prévia", () => {
    const parser = new SseV1Parser();
    parser.push(wireEvent("start", { version: 1, type: "start", requestId: "r7", messageId: "m7" }));
    const contextProposal = {
      version: 1,
      type: "context_proposal",
      toolCallId: "tool-7",
      proposal: {
        id: "proposal-7",
        actorId: "admin-1",
        targetType: "table",
        dataSourceId: "source-1",
        tableId: "table-1",
        sourceName: "Analytics",
        schemaName: "public",
        tableName: "orders",
        baseContextVersion: 1,
        currentContext: "Pedidos",
        proposedContext: "Pedidos confirmados por cliente",
        reason: "Esclarece a definição de venda.",
        status: "pending",
        expiresAt: "2026-09-29T20:00:00.000Z",
        createdAt: "2026-09-29T19:00:00.000Z",
        resolvedAt: null,
      },
    };
    expect(parser.push(wireEvent("context_proposal", contextProposal))[0]).toMatchObject({ type: "context_proposal", proposal: { id: "proposal-7" } });

    const sourceProposalParser = new SseV1Parser();
    sourceProposalParser.push(wireEvent("start", { version: 1, type: "start", requestId: "r7-source", messageId: "m7-source" }));
    const sourceProposal = {
      ...contextProposal,
      proposal: { ...contextProposal.proposal, targetType: "source", tableId: null, schemaName: null, tableName: null },
    };
    expect(sourceProposalParser.push(wireEvent("context_proposal", sourceProposal))[0]).toMatchObject({ type: "context_proposal", proposal: { targetType: "source" } });

    const invalidTargetParser = new SseV1Parser();
    invalidTargetParser.push(wireEvent("start", { version: 1, type: "start", requestId: "r7-invalid-target", messageId: "m7-invalid-target" }));
    const invalidTarget = { ...contextProposal, proposal: { ...contextProposal.proposal, tableId: null } };
    expect(() => invalidTargetParser.push(wireEvent("context_proposal", invalidTarget))).toThrow(/proposta de contexto.*malformada/i);

    const invalidStatusParser = new SseV1Parser();
    invalidStatusParser.push(wireEvent("start", { version: 1, type: "start", requestId: "r7-invalid-status", messageId: "m7-invalid-status" }));
    const invalidStatus = { ...contextProposal, proposal: { ...contextProposal.proposal, status: "approved" } };
    expect(() => invalidStatusParser.push(wireEvent("context_proposal", invalidStatus))).toThrow(/proposta de contexto.*malformada/i);

    const invalidParser = new SseV1Parser();
    invalidParser.push(wireEvent("start", { version: 1, type: "start", requestId: "r8", messageId: "m8" }));
    const queryPreview = {
      version: 1,
      type: "query_preview",
      toolCallId: "tool-8",
      testRunId: "run-8",
      dataSource: { id: "source-1", name: "Analytics" },
      intent: { mode: "create", queryName: "Pedidos" },
      sqlText: "SELECT 1",
      parameters: [],
      testValues: {},
      rows: [{ total: 1 }],
      rowCount: 1,
      rowLimit: 1,
      byteLimit: 10,
      bytes: 11,
      truncated: false,
      truncationReason: null,
    };
    expect(() => invalidParser.push(wireEvent("query_preview", queryPreview), true)).toThrow(/prévia da query.*malformada/i);
  });

  it("cancela o response body se o parser rejeitar um evento", async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(wireEvent("token", {
          version: 1,
          type: "token",
          messageId: "before-start",
          delta: "inválido",
        })));
      },
      cancel() {
        canceled = true;
      },
    });

    await expect(readChatStream(body, () => undefined)).rejects.toThrow(/antes do evento de início/i);
    expect(canceled).toBe(true);
  });

  it("rejeita EOF antes de receber um evento terminal", () => {
    const parser = new SseV1Parser();
    parser.push(wireEvent("start", { version: 1, type: "start", requestId: "r9", messageId: "m9" }));
    parser.push(wireEvent("token", { version: 1, type: "token", messageId: "m9", delta: "parcial" }));

    expect(() => parser.push("", true)).toThrow(/sem evento terminal/i);
  });
});
