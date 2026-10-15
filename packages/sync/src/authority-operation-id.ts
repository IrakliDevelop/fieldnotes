/** Mint a timestamp-profile authority ID suitable for bounded uncertain-retry recovery. */
export function createAuthorityOperationId(issuedAt: number = Date.now()): string {
  if (
    !Number.isSafeInteger(issuedAt) ||
    issuedAt < 1_000_000_000_000 ||
    issuedAt > 9_999_999_999_999
  ) {
    throw new RangeError('Invalid authority operation timestamp');
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let random = '';
  for (const byte of bytes) random += byte.toString(16).padStart(2, '0');
  return `fn1:${issuedAt}:${random}`;
}
