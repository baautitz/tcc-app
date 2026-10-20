export const baseUrl = (
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : "A requisição falhou.";
    throw new ApiError(message, response.status);
  }
  return body as T;
}

/** Raw fetch (SSE etc.): credentials included, response returned untouched. */
export function stream(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { credentials: "include", ...options });
}

export interface HttpClient {
  request: typeof request;
  stream: typeof stream;
}

export const httpClient: HttpClient = { request, stream };
