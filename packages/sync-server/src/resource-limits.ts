export const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;
export const DEFAULT_MAX_JSON_DEPTH = 32;
export const DEFAULT_MAX_PENDING_AUTH_MESSAGES = 100;
export const DEFAULT_MAX_PENDING_AUTH_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MESSAGES_PER_SECOND = 120;
export const DEFAULT_MESSAGE_BURST = 240;
export const DEFAULT_PRESENCE_THROTTLE_MS = 50;
/** Per-connection presence throttle lanes, INCLUDING the reserved fallback lane. */
export const DEFAULT_MAX_PRESENCE_LANES = 16;

export function hasJsonDepthAtMost(message: string, maxDepth: number): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (const char of message) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') {
      depth += 1;
      if (depth > maxDepth) return false;
    } else if (char === '}' || char === ']') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }

  return depth === 0 && !inString;
}

export class MessageRateLimiter {
  private tokens: number;
  private updatedAt: number;

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst: number,
    now = Date.now(),
  ) {
    this.tokens = burst;
    this.updatedAt = now;
  }

  take(now = Date.now()): boolean {
    const elapsedSeconds = Math.max(0, now - this.updatedAt) / 1000;
    this.tokens = Math.min(this.burst, this.tokens + elapsedSeconds * this.ratePerSecond);
    this.updatedAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
