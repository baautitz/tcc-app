import {
  AI_QUERY_RETRY_JITTER_MS,
  AI_QUERY_RETRY_MIN_DELAY_MS,
  ExternalQueryExecutionError,
  classifyExternalQueryError,
  runBoundedReadOnlyQuery,
  type BoundedReadOnlyQueryOptions,
  type BoundedReadOnlyQueryResult,
  type ExternalPostgresConfig,
} from "./pg-exec.js";

export async function runBoundedReadOnlyQueryWithRetry(
  config: ExternalPostgresConfig,
  sqlText: string,
  values: unknown[],
  options: BoundedReadOnlyQueryOptions & {
    beforeAttempt?: (attempt: number) => boolean | Promise<boolean>;
  } = {},
): Promise<BoundedReadOnlyQueryResult> {
  let attempt = 0;
  while (true) {
    attempt += 1;
    if (options.retrySignal?.aborted)
      throw (
        options.retrySignal.reason ?? new DOMException("Aborted", "AbortError")
      );
    if (options.beforeAttempt && !(await options.beforeAttempt(attempt))) {
      throw new ExternalQueryExecutionError("connection", null, false);
    }
    try {
      return await runBoundedReadOnlyQuery(config, sqlText, values, options);
    } catch (error) {
      const classified =
        error instanceof ExternalQueryExecutionError
          ? error
          : classifyExternalQueryError(error);
      if (attempt >= 2 || !classified.retryable) throw classified;
      await waitBeforeTechnicalRetry(options.retrySignal);
    }
  }
}

function waitBeforeTechnicalRetry(signal?: AbortSignal): Promise<void> {
  const delayMs =
    AI_QUERY_RETRY_MIN_DELAY_MS +
    Math.floor(Math.random() * (AI_QUERY_RETRY_JITTER_MS + 1));
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const complete = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(complete, delayMs);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
