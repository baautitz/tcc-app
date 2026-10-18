import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request, stream } from "./client";

const mock = (res: Partial<Response> & { json?: () => Promise<unknown> }) =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("returns parsed body and sends credentials", async () => {
    mock({ ok: true, status: 200, json: async () => ({ a: 1 }) });
    await expect(request("/x")).resolves.toEqual({ a: 1 });
    expect((fetch as any).mock.calls[0][1].credentials).toBe("include");
  });
  it("returns undefined on 204", async () => {
    mock({ ok: true, status: 204 });
    await expect(request("/x")).resolves.toBeUndefined();
  });
  it("throws ApiError with server message", async () => {
    mock({ ok: false, status: 403, json: async () => ({ error: "nope" }) });
    await expect(request("/x")).rejects.toMatchObject({ message: "nope", status: 403 });
  });
  it("falls back to default message", async () => {
    mock({ ok: false, status: 500, json: async () => { throw new Error("x"); } });
    const e = await request("/x").catch((e: unknown) => e) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.message).toBe("A requisição falhou.");
  });
  it("stream returns raw response with credentials", async () => {
    const res = { ok: true } as Response;
    mock(res);
    await expect(stream("/s", { method: "POST" })).resolves.toBe(res);
    expect((fetch as any).mock.calls[0][1]).toMatchObject({ credentials: "include", method: "POST" });
  });
});
