import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api";
import { queriesApi } from "@/modules/queries/api/queries.api";
import { useSaveQuery } from "@/modules/queries/hooks/useSaveQuery";

vi.mock("@/modules/queries/api/queries.api", () => ({
  queriesApi: { createQuery: vi.fn(), updateQuery: vi.fn(), savedQuery: vi.fn() },
}));

const body = { name: "q" } as any;
beforeEach(() => vi.clearAllMocks());

describe("useSaveQuery", () => {
  it("persist cria sem id e atualiza com id + expectedUpdatedAt", async () => {
    const { result } = renderHook(() => useSaveQuery());
    (queriesApi.createQuery as any).mockResolvedValue({ id: "n" });
    (queriesApi.updateQuery as any).mockResolvedValue({ id: "1" });
    await result.current.persist(undefined, body);
    expect(queriesApi.createQuery).toHaveBeenCalledWith(body);
    await result.current.persist("1", body, "t0");
    expect(queriesApi.updateQuery).toHaveBeenCalledWith("1", { ...body, expectedUpdatedAt: "t0" });
  });

  it("run liga saving/pendingRef durante a execução e desliga mesmo com erro", async () => {
    const { result } = renderHook(() => useSaveQuery());
    let release!: () => void;
    let p: Promise<void>;
    act(() => { p = result.current.run(() => new Promise<void>((r) => (release = r))); });
    expect(result.current.saving).toBe(true);
    expect(result.current.pendingRef.current).toBe(true);
    await act(async () => { release(); await p; });
    expect(result.current.saving).toBe(false);
    expect(result.current.pendingRef.current).toBe(false);

    await act(async () => { await result.current.run(() => Promise.reject(new Error("x"))).catch(() => {}); });
    expect(result.current.saving).toBe(false);
    expect(result.current.pendingRef.current).toBe(false);
  });

  it("reloadOnConflict devolve a query ou undefined se falhar", async () => {
    const { result } = renderHook(() => useSaveQuery());
    (queriesApi.savedQuery as any).mockResolvedValueOnce({ id: "1" }).mockRejectedValueOnce(new Error("x"));
    expect(await result.current.reloadOnConflict("1")).toEqual({ id: "1" });
    expect(await result.current.reloadOnConflict("1")).toBeUndefined();
  });

  it("isConflict só é true para ApiError 409", () => {
    const { result } = renderHook(() => useSaveQuery());
    const mk = (s: number) => Object.assign(Object.create(ApiError.prototype), { status: s });
    expect(result.current.isConflict(mk(409))).toBe(true);
    expect(result.current.isConflict(mk(500))).toBe(false);
    expect(result.current.isConflict(new Error("x"))).toBe(false);
  });
});
