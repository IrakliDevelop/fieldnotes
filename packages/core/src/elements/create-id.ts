let counter = 0;

export function randomClientComponent(): string {
  // getRandomValues works in NON-secure contexts (an iPad on http://LAN) — unlike crypto.randomUUID, which
  // is secure-context-gated in browsers. Uniqueness, not security.
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''); // 16 hex = 64 bits
  }
  return Math.random().toString(36).slice(2, 14); // last resort — no crypto at all
}

// Per-process (per tab/worker) client component — generated ONCE at module load so two clients never collide
// even at counter 0 in the same millisecond.
const CLIENT = randomClientComponent();

// Internal (module-exported for tests; NOT in the package barrel — see index.ts / index.test.ts `removed`).
export function formatId(prefix: string, time: string, counter: string, client: string): string {
  return `${prefix}_${time}_${counter}_${client}`;
}

export function createId(prefix: string): string {
  return formatId(prefix, Date.now().toString(36), (counter++).toString(36), CLIENT);
}
