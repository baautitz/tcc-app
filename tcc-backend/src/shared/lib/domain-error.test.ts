import { expect, it } from "vitest";
import { ApiError, DomainError, toApiError } from "./domain-error.js";

it("mapeia kind para status e permite sobrescrever a mensagem por code", () => {
  for (const [kind, status] of [["not_found", 404], ["conflict", 409], ["bad_request", 400], ["forbidden", 403]] as const) {
    const mapped = toApiError(new DomainError("msg", "X", kind));
    expect(mapped).toBeInstanceOf(ApiError);
    expect(mapped?.status).toBe(status);
    expect(mapped?.message).toBe("msg");
  }
  expect(toApiError(new DomainError("msg", "X", "conflict"), { X: "outra" })?.message).toBe("outra");
  expect(toApiError(new Error("x"))).toBeUndefined();
});
