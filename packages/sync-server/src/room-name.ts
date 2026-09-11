/**
 * Room names the relay admits. Backends derive storage keys from the room
 * name (`<prefix><room>:layers`, `<prefix><room>:fog:meta`, ...), so the
 * alphabet excludes every separator a key builder uses and bounds the length
 * before `authenticate` runs.
 */
export const ROOM_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidRoomName(room: unknown): room is string {
  return typeof room === 'string' && ROOM_NAME_PATTERN.test(room);
}
