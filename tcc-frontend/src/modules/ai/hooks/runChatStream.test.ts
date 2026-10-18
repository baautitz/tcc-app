import { afterEach, describe, expect, it, vi } from "vitest";
import { runChatStream } from "@/modules/ai/hooks/useChatStream";

const sse = (name: string, payload: object) => `event: ${name}\ndata: ${JSON.stringify({ version: 1, type: name, ...payload })}\n\n`;
const bodyOf = (text: string) =>
  new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });

afterEach(() => vi.unstubAllGlobals());

describe("runChatStream (fluxo de sucesso)", () => {
  it("repassa eventos e sinaliza done", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      body: bodyOf(sse("start", { requestId: "r", messageId: "m" }) + sse("token", { messageId: "m", delta: "Oi" }) + sse("done", { messageId: "m", finishReason: "stop" })),
    }));
    const types: string[] = [];
    const out = await runChatStream({ q: 1 }, new AbortController().signal, (e) => types.push(e.type));
    expect(types).toEqual(["start", "token", "done"]);
    expect(out).toEqual({ receivedDone: true, receivedError: false });
  });

  it("sinaliza evento error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      body: bodyOf(sse("start", { requestId: "r", messageId: "m" }) + sse("error", { messageId: "m", code: "x", message: "falhou", retryable: false })),
    }));
    const out = await runChatStream({}, new AbortController().signal, () => {});
    expect(out.receivedError).toBe(true);
    expect(out.receivedDone).toBe(false);
  });

  it("usa mensagem padrão quando erro não tem corpo JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => { throw new Error("x"); } }));
    await expect(runChatStream({}, new AbortController().signal, () => {})).rejects.toThrow("Não foi possível iniciar");
  });
});
