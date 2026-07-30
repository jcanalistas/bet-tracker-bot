const RETRYABLE_PATTERN = /"code":\s*(429|5\d\d)|RESOURCE_EXHAUSTED|UNAVAILABLE|rate.?limit/i;

export function isRetryableGeminiError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return RETRYABLE_PATTERN.test(message);
}

interface RetryOptions {
  retries: number;
  baseDelayMs: number;
}

/** Reintenta `fn` con backoff exponencial ante errores transitorios (429/5xx) de la API de Gemini. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === options.retries || !isRetryableGeminiError(err)) throw err;
      const delay = options.baseDelayMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

/** Corta la espera de verdad si la API tarda más de `ms` — el timeout de httpOptions del SDK de Gemini no siempre aborta la petición. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${message} (${ms / 1000}s)`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
