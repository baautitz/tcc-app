import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_QUERY_RETRY_JITTER_MS,
  AI_QUERY_RETRY_MIN_DELAY_MS,
  runBoundedReadOnlyQueryWithRetry,
} from "./index.js";

const connection = {
  host: "database.internal",
  port: 5432,
  database: "analytics",
  user: "readonly",
  password: "secret",
};

function createClientFactory(connect: () => Promise<void>) {
  let connections = 0;
  const createClient = () => {
    connections += 1;
    return {
      connect: connections === 1 ? connect : async () => {},
      end: async () => {},
      query: async (_input: unknown) => {},
    };
  };
  return { createClient, connectionCount: () => connections };
}

describe("retry técnico de preview", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("aguarda backoff com jitter antes do único retry de transporte", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const factory = createClientFactory(async () => {
      throw Object.assign(new Error("connection reset"), {
        code: "ECONNRESET",
      });
    });
    const startedAt = Date.now();
    await expect(runBoundedReadOnlyQueryWithRetry(
      connection,
      "SELECT 1",
      [],
      {
        createClient: factory.createClient,
        createCursor: () => ({ read: async () => [], close: async () => {} }),
      },
    )).resolves.toMatchObject({ rows: [], truncated: false });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(
      AI_QUERY_RETRY_MIN_DELAY_MS + AI_QUERY_RETRY_JITTER_MS,
    );
    expect(factory.connectionCount()).toBe(2);
  });

  it("cancela o backoff e não abre a conexão do retry", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const factory = createClientFactory(async () => {
      throw Object.assign(new Error("connection reset"), {
        code: "ECONNRESET",
      });
    });
    const pending = runBoundedReadOnlyQueryWithRetry(
      connection,
      "SELECT 1",
      [],
      {
        retrySignal: controller.signal,
        createClient: factory.createClient,
        createCursor: () => ({ read: async () => [], close: async () => {} }),
      },
    );

    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(factory.connectionCount()).toBe(1);
  });
});
