/**
 * Retry wrapper with exponential backoff + jitter.
 * -------------------------------------------------------------
 * Spec requirement: "retry logic with at least 3 attempts and exponential
 * backoff with jitter". This module provides a generic, production-grade
 * `withRetry` plus an HTTP-aware convenience `withRetryHttp` that retries
 * on network errors and on the standard transient HTTP status codes
 * (429 / 500 / 502 / 503 / 504) but NOT on other 4xx client errors.
 *
 * Algorithm (per attempt, 1-indexed):
 *   base     = baseDelayMs * 2^(attempt - 1)
 *   capped   = min(base, maxDelayMs)
 *   delay    = applyJitter(capped)   // "full" | "equal"
 *   await sleep(delay)               // unless this was the last attempt
 *
 * Jitter strategies (AWS architecture blog reference):
 *   - "full":  delay = random(0, capped)             // best at throttling load
 *   - "equal": delay = capped/2 + random(0, capped/2) // caps the lower bound
 *
 * The wrapper respects an optional AbortSignal: if the signal aborts during
 * a sleep or between attempts, the function rejects immediately with the
 * abort reason and no further retry is attempted.
 *
 * REFACTOR: previously each call site implemented its own bespoke retry loop
 * (or none at all). Centralising here lets us tune backoff globally and keep
 * the per-source fault-tolerance in scraper.ts focused on isolation only.
 */

/** Options accepted by {@link withRetry}. */
export type RetryOptions = {
  /** Maximum number of attempts (inclusive). Default 3. Must be >= 1. */
  maxAttempts?: number;
  /** Base delay in ms for the first retry. Default 200. */
  baseDelayMs?: number;
  /** Upper bound for any single computed delay. Default 3000. */
  maxDelayMs?: number;
  /**
   * Jitter strategy:
   *  - "full"  (default): delay = random(0, capped)
   *  - "equal"        : delay = capped/2 + random(0, capped/2)
   */
  jitter?: "full" | "equal";
  /**
   * Predicate deciding whether to retry on a given error.
   * Defaults to "retry on every error". Return false to rethrow immediately.
   * Receives the error and the 1-indexed attempt number that just failed.
   */
  retryOn?: (err: unknown, attempt: number) => boolean;
  /**
   * Callback invoked right before each retry sleep, useful for logging or
   * emitting metrics. Receives the error, the 1-indexed attempt that just
   * failed, and the delay (ms) that will be slept before the next attempt.
   */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  /** Optional AbortSignal. Aborting rejects immediately with signal.reason. */
  signal?: AbortSignal;
};

/** Random float in [0, max). */
function randomFloat(max: number): number {
  return Math.random() * max;
}

/** Compute the sleep delay (ms) for a given attempt using backoff + jitter. */
export function computeBackoff(
  attempt: number, // 1-indexed attempt that JUST FAILED
  opts: Required<Pick<RetryOptions, "baseDelayMs" | "maxDelayMs" | "jitter">>
): number {
  const exp = opts.baseDelayMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exp, opts.maxDelayMs);
  if (opts.jitter === "equal") {
    return Math.round(capped / 2 + randomFloat(capped / 2));
  }
  // "full" jitter (default)
  return Math.round(randomFloat(capped));
}

/** Sleep that resolves early (rejecting) when the signal aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Execute `fn` with retry + exponential backoff + jitter.
 *
 * @param fn   The async operation to attempt.
 * @param opts See {@link RetryOptions}.
 * @returns    The resolved value of `fn` on the first successful attempt.
 * @throws     The last error if all attempts fail, or immediately if the
 *             AbortSignal fires, or if `retryOn` returns false for an error.
 *
 * @example
 * ```ts
 * const data = await withRetry(() => fetchPricePage(source), {
 *   maxAttempts: 3,
 *   baseDelayMs: 150,
 *   jitter: "full",
 *   onRetry: (err, n, delay) => console.warn(`attempt ${n} failed, retry in ${delay}ms`, err),
 * });
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const baseDelayMs = Math.max(0, opts.baseDelayMs ?? 200);
  const maxDelayMs = Math.max(baseDelayMs, opts.maxDelayMs ?? 3000);
  const jitter: "full" | "equal" = opts.jitter ?? "full";
  const retryOn = opts.retryOn ?? (() => true);
  const onRetry = opts.onRetry;
  const signal = opts.signal;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Bail out before even trying if already aborted.
    if (signal?.aborted) {
      throw signal.reason ?? new Error("Aborted");
    }
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // If this was the final attempt, give up.
      if (attempt >= maxAttempts) break;
      // Ask the predicate whether to retry.
      if (!retryOn(err, attempt)) throw err;
      // Compute backoff and announce the retry.
      const delay = computeBackoff(attempt, { baseDelayMs, maxDelayMs, jitter });
      onRetry?.(err, attempt, delay);
      // Sleep; may reject early if the signal aborts.
      await sleep(delay, signal);
    }
  }
  throw lastErr;
}

/**
 * HTTP status codes that are considered transient and therefore retryable.
 * 429 (Too Many Requests) is retryable; other 4xx are not.
 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** True if the given Response status is one we should retry on. */
function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

/**
 * Convenience wrapper around `fetch` that retries on:
 *  - network errors (fetch rejects — DNS, TCP, TLS, timeout, aborted-by-server)
 *  - HTTP 429 / 500 / 502 / 503 / 504 responses
 *
 * It does NOT retry on other 4xx client errors (400/401/403/404/...) since
 * those indicate a request-side problem that retrying will not fix.
 *
 * The body of retryable responses is NOT consumed, so the caller can read it
 * after the function returns. On a retryable status, we wrap it in an Error
 * so `retryOn` can inspect the original Response via `err.response`.
 *
 * @example
 * ```ts
 * const res = await withRetryHttp("https://kdl.kz/prices", {}, {
 *   maxAttempts: 4, baseDelayMs: 250, jitter: "equal",
 * });
 * if (!res.ok) throw new Error(`upstream ${res.status}`);
 * const html = await res.text();
 * ```
 */
export async function withRetryHttp(
  url: string,
  init?: RequestInit,
  opts: RetryOptions = {}
): Promise<Response> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  return withRetry<Response>(
    async () => {
      const res = await fetch(url, init);
      if (isRetryableStatus(res.status)) {
        // Wrap so the retry loop can decide; surface the original response so
        // callers can drain the body / inspect headers if needed after retries
        // are exhausted. We do NOT consume res.body here.
        const wrapped = new Error(
          `Retryable HTTP ${res.status} from ${url}`
        ) as Error & { response: Response; status: number };
        wrapped.response = res;
        wrapped.status = res.status;
        throw wrapped;
      }
      return res;
    },
    {
      ...opts,
      maxAttempts,
      retryOn: (err) => {
        // Retry on the wrapped retryable-status errors above.
        const status = (err as { status?: number }).status;
        if (typeof status === "number" && isRetryableStatus(status)) return true;
        // Retry on plain network errors (no .status).
        if (typeof status === "undefined") return true;
        return false;
      },
    }
  );
}
