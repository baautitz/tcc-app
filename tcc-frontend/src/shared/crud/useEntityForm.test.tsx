import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/shared/ui/toast";
import { useEntityForm } from "./useEntityForm";

vi.mock("@/shared/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

type V = { name: string };
const resolver = (async (values: V) => ({ values, errors: {} })) as any;
const toDefaults = (e: { name: string } | undefined) => ({
  name: e?.name ?? "",
});

function setup(save: any, extra: Record<string, unknown> = {}) {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(
    (props: { entity?: { name: string } }) =>
      useEntityForm<V, { name: string }>({
        resolver,
        entity: props.entity,
        open: true,
        toDefaults,
        save,
        onOpenChange,
        onSaved,
        ...extra,
      }),
    { initialProps: { entity: undefined } as { entity?: { name: string } } },
  );
  return { ...hook, onOpenChange, onSaved };
}

beforeEach(() => vi.clearAllMocks());

describe("useEntityForm", () => {
  it("reseta o form ao trocar a entidade", () => {
    const { result, rerender } = setup(vi.fn());
    expect(result.current.form.getValues("name")).toBe("");
    rerender({ entity: { name: "A" } });
    expect(result.current.form.getValues("name")).toBe("A");
  });

  it("sucesso: toast, fecha e chama onSaved", async () => {
    const save = vi.fn().mockResolvedValue("Salvo");
    const { result, onOpenChange, onSaved } = setup(save);
    await act(() => result.current.submit());
    expect(save).toHaveBeenCalledWith({ name: "" }, result.current.form);
    expect(toast.success).toHaveBeenCalledWith("Salvo");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSaved).toHaveBeenCalled();
  });

  it("save retornando undefined aborta sem toast nem fechar", async () => {
    const { result, onOpenChange, onSaved } = setup(
      vi.fn().mockResolvedValue(undefined),
    );
    await act(() => result.current.submit());
    expect(toast.success).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("erro: mostra toast.error e não fecha", async () => {
    const { result, onOpenChange } = setup(
      vi.fn().mockRejectedValue(new Error("ruim")),
    );
    await act(() => result.current.submit());
    expect(toast.error).toHaveBeenCalledWith("ruim");
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
