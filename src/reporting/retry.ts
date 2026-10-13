// Google API 호출과 다운로드에서 공통으로 쓰는 재시도 유틸리티
const BASE_RETRY_DELAY_MS = 1500;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("status" in error && Number.isFinite(Number(error.status))) return Number(error.status);
  if ("response" in error && typeof error.response === "object" && error.response !== null && "status" in error.response) {
    const status = Number(error.response.status);
    return Number.isFinite(status) ? status : undefined;
  }
  return undefined;
}

export function isDeletedOAuthClientError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  if (message.includes("deleted_client")) {
    return true;
  }
  try {
    return JSON.stringify(error).toLowerCase().includes("deleted_client");
  } catch {
    return false;
  }
}

function isRetryableError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code).toLowerCase() : "";
  const status = getErrorStatus(error);

  return (
    ["econnreset", "etimedout", "eai_again", "socket hang up", "timeout", "503", "502", "500"].some((token) =>
      message.includes(token) || code.includes(token),
    ) ||
    (status !== undefined && [429, 500, 502, 503, 504].includes(status))
  );
}

export async function withRetries<T>(
  label: string,
  maxAttempts: number,
  fn: (attempt: number) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const retryable = isRetryableError(error);
      if (!retryable || attempt === maxAttempts) {
        throw error;
      }

      const delayMs = BASE_RETRY_DELAY_MS * attempt;
      console.warn(
        `[Retry] ${label} failed on attempt ${attempt}/${maxAttempts}: ${getErrorMessage(error)}. Retrying in ${delayMs}ms.`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}
