const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const MAX_KEY_LENGTH = 128;
// The smallest integer has no key below it, so it is never issued.
const SMALLEST_INTEGER = 'A' + '0'.repeat(26);

function integerLength(head: string): number | null {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 97 + 2;
  if (head >= 'A' && head <= 'Z') return 90 - head.charCodeAt(0) + 2;
  return null;
}

function isDigits(s: string): boolean {
  for (const ch of s) if (!DIGITS.includes(ch)) return false;
  return true;
}

/** True when `key` is a well-formed fractional order key. */
export function isValidIndexKey(key: string): boolean {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) return false;
  const length = integerLength(key.charAt(0));
  if (length === null || key.length < length) return false;
  const integer = key.slice(0, length);
  const fraction = key.slice(length);
  if (key === SMALLEST_INTEGER || !isDigits(integer.slice(1)) || !isDigits(fraction)) return false;
  return !fraction.endsWith('0');
}

function split(key: string): [integer: string, fraction: string] {
  const length = integerLength(key.charAt(0)) ?? 0;
  return [key.slice(0, length), key.slice(length)];
}

// Fractions are digit strings without a trailing '0'; `a < b` when b is set.
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a.charAt(n) || '0') === b.charAt(n)) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a.charAt(0)) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b.charAt(0)) : DIGITS.length;
  if (digitB - digitA > 1) return DIGITS.charAt(Math.round((digitA + digitB) / 2));
  if (b !== null && b.length > 1) return b.charAt(0);
  return DIGITS.charAt(digitA) + midpoint(a.slice(1), null);
}

function step(integer: string, delta: 1 | -1): string | null {
  const head = integer.charAt(0);
  const digits = [...integer.slice(1)];
  const wrapFrom = delta === 1 ? 'z' : '0';
  const wrapTo = delta === 1 ? '0' : 'z';
  for (let i = digits.length - 1; i >= 0; i--) {
    if (digits[i] !== wrapFrom) {
      digits[i] = DIGITS.charAt(DIGITS.indexOf(digits[i] ?? '0') + delta);
      return head + digits.join('');
    }
    digits[i] = wrapTo;
  }
  if (delta === 1 && head === 'Z') return 'a0';
  if (delta === -1 && head === 'a') return 'Zz';
  if (head === (delta === 1 ? 'z' : 'A')) return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + delta);
  // Positive integers grow by a digit moving up; negative ones grow moving down.
  if (nextHead > 'a' === (delta === 1)) digits.push(wrapTo);
  else digits.pop();
  return nextHead + digits.join('');
}

function between(a: string | null, b: string | null): string {
  if (a === null && b === null) return 'a0';
  if (a === null) {
    const [intB, fracB] = split(b ?? '');
    if (intB === SMALLEST_INTEGER) return intB + midpoint('', fracB);
    if (fracB) return intB;
    const lower = step(intB, -1);
    if (lower === null) throw new RangeError('Cannot generate a key below the smallest integer');
    return lower;
  }
  const [intA, fracA] = split(a);
  const higher = step(intA, 1);
  if (b === null) return higher ?? intA + midpoint(fracA, null);
  const [intB, fracB] = split(b);
  if (intA === intB) return intA + midpoint(fracA, fracB);
  if (higher !== null && higher < b) return higher;
  return intA + midpoint(fracA, null);
}

/** Returns an order key strictly between `a` and `b`; `null` means unbounded on that side. */
export function generateKeyBetween(a: string | null, b: string | null): string {
  for (const key of [a, b]) {
    if (key !== null && !isValidIndexKey(key)) throw new RangeError(`Invalid index key: ${key}`);
  }
  if (a !== null && b !== null && a >= b) throw new RangeError(`${a} is not below ${b}`);
  const key = between(a, b);
  if (key.length > MAX_KEY_LENGTH) throw new RangeError('Index key exceeds 128 characters');
  return key;
}

/** Returns `n` strictly increasing order keys between `a` and `b`. */
export function generateNKeysBetween(a: string | null, b: string | null, n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) return [generateKeyBetween(a, b)];
  if (b === null) {
    const keys: string[] = [];
    let last = a;
    for (let i = 0; i < n; i++) keys.push((last = generateKeyBetween(last, null)));
    return keys;
  }
  if (a === null) {
    const keys: string[] = [];
    let first: string | null = b;
    for (let i = 0; i < n; i++) keys.unshift((first = generateKeyBetween(null, first)));
    return keys;
  }
  const half = Math.floor(n / 2);
  const mid = generateKeyBetween(a, b);
  return [
    ...generateNKeysBetween(a, mid, half),
    mid,
    ...generateNKeysBetween(mid, b, n - half - 1),
  ];
}
