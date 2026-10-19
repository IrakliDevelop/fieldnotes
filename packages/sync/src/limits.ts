/** Wire size, count and depth caps shared by the sync client and server. */
export const SYNC_LIMITS = {
  maxFrameBytes: 1_048_576, // server default ws maxPayload
  maxFrameJsonDepth: 32, // server default inbound depth
  maxReceivedJsonDepth: 64, // client parseEnvelope guard (snapshots nest elements one level deeper)
  maxPresenceBytes: 4096, // server default presence cap
  maxIdLength: 256, // element/layer/group/binding ids, envelope from, layer editor
  maxShortStringLength: 256, // colors, htmlType, extensionType, layer name, fontFamily-like fields
  maxTextLength: 1_048_576, // note/text text, arrow label
  maxSrcLength: 16_777_216, // image src (data URIs); hosts may raise maxMessageBytes
  maxStrokePoints: 100_000,
  maxSnapshotElements: 1_000_000,
  maxBatchOps: 1000,
} as const;

/** An element op that would break a `SYNC_LIMITS` cap, so it was not sent. */
export class SyncLimitError extends Error {
  override readonly name = 'SyncLimitError';

  constructor(
    readonly elementId: string,
    readonly limit: string,
  ) {
    super(`Element ${elementId} exceeds sync limit ${limit}`);
  }
}

/** Whether `message` nests objects/arrays at most `maxDepth` deep and is structurally balanced. */
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
