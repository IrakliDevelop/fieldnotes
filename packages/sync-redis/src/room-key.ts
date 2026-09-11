/**
 * Encodes a room name for use inside a Redis key. Room-scoped hashes are laid
 * out as `<prefix><room>` plus `<prefix><room>:<suffix>` sub-keys, so an
 * unescaped `:` in a room name lets `foo:layers` alias room `foo`'s layer
 * ledger. `encodeURIComponent` leaves the relay's valid room alphabet
 * (`[A-Za-z0-9_-]`) untouched, so existing keys keep their historical layout.
 */
export function encodeRoomKey(room: string): string {
  return encodeURIComponent(room);
}
