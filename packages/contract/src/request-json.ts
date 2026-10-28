/**
 * Shared request helper: plain fetch with the server's error body decoded
 * into a typed exception. Pure logic — no DOM, no node: imports; runs
 * identically in the browser and on Node.
 */

/** Error thrown for any non-2xx response. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

interface ErrorBody {
  errorCode?: unknown;
  message?: unknown;
}

function decodeErrorBody(status: number, text: string): ApiError {
  try {
    const parsed = JSON.parse(text) as ErrorBody;
    const code = parsed.errorCode;
    const message = parsed.message;
    if (typeof code === "string" && typeof message === "string") {
      return new ApiError(status, code, message);
    }
  } catch {
    // Not JSON — fall through to the generic shape below.
  }
  return new ApiError(
    status,
    "HTTP_ERROR",
    `request failed with status ${status}`,
  );
}

/** Join a client's base URL with an API path, tolerating trailing slashes. */
export function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

export async function requestJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw decodeErrorBody(response.status, await response.text());
  }
  return (await response.json()) as T;
}
