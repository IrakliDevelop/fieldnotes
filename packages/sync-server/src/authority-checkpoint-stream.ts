import {
  AUTHORITY_CHECKPOINT_TIMEOUT_MS,
  MAX_AUTHORITY_FRAME_BYTES,
  prepareAuthorityCheckpoint,
} from '@fieldnotes/sync';
import type {
  AuthorityCheckpointPayload,
  AuthorityCheckpointPrepareOptions,
  AuthorityCheckpointManifest,
  AuthorityServerFrame,
  PreparedAuthorityCheckpoint,
} from '@fieldnotes/sync';
import type { AuthorityTrackedSend } from './frame-transport';

/** Owns only one encoded frame at a time; the caller owns stream and peer reservations. */
export async function streamAuthorityCheckpoint(
  payload: AuthorityCheckpointPayload,
  options: AuthorityCheckpointPrepareOptions,
  send: (frame: string, kind: CheckpointFrameKind, deadlineAt: number) => AuthorityTrackedSend,
  onTracked?: (tracked: AuthorityTrackedSend) => void,
  beforeFrame?: (kind: CheckpointFrameKind, streamDeadline?: number) => Promise<void>,
): Promise<{
  readonly manifest: AuthorityCheckpointManifest;
  readonly settled: Promise<void>;
  readonly deadlineAt: number;
}> {
  const prepared = await prepareAuthorityCheckpoint(payload, options);
  return sendPreparedAuthorityCheckpoint(prepared, send, options.signal, onTracked, beforeFrame);
}

type CheckpointFrameKind = 'checkpoint-begin' | 'checkpoint-chunk' | 'checkpoint-end';

/** Only C2-produced frames enter here; C2 already owns their shape and payload digest. */
function encodePreparedFrame(
  frame: Extract<AuthorityServerFrame, { kind: CheckpointFrameKind }>,
): string {
  const encoded = JSON.stringify(frame);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_AUTHORITY_FRAME_BYTES)
    throw new RangeError('Authority frame byte limit');
  return encoded;
}

async function deliverNext(
  frames: PreparedAuthorityCheckpoint['frames'],
  deadline: number | undefined,
  send: (frame: string, kind: CheckpointFrameKind, deadlineAt: number) => AuthorityTrackedSend,
  onTracked?: (tracked: AuthorityTrackedSend) => void,
  beforeFrame?: (kind: CheckpointFrameKind, streamDeadline?: number) => Promise<void>,
): Promise<{
  readonly kind: CheckpointFrameKind;
  readonly deadline: number;
  readonly settled: Promise<void>;
}> {
  const next = frames.next();
  if (next.done) throw new Error('Incomplete authority checkpoint');
  const frame = next.value;
  if (beforeFrame && frame.kind !== 'checkpoint-chunk') await beforeFrame(frame.kind, deadline);
  const encoded = encodePreparedFrame(frame);
  const frameDeadline = deadline ?? Date.now() + AUTHORITY_CHECKPOINT_TIMEOUT_MS;
  if (Date.now() >= frameDeadline) throw new Error('Authority checkpoint timed out');
  const tracked = send(encoded, frame.kind, frameDeadline);
  onTracked?.(tracked);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Authority checkpoint timed out')),
        Math.max(0, frameDeadline - Date.now()),
      );
    });
    await Promise.race([tracked.completion, timeout]);
    if (Date.now() >= frameDeadline) throw new Error('Authority checkpoint timed out');
    if (frame.kind !== 'checkpoint-end') {
      await Promise.race([tracked.settled, timeout]);
      if (Date.now() >= frameDeadline) throw new Error('Authority checkpoint timed out');
    }
    return { kind: frame.kind, deadline: frameDeadline, settled: tracked.settled };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function sendPreparedAuthorityCheckpoint(
  prepared: PreparedAuthorityCheckpoint,
  send: (frame: string, kind: CheckpointFrameKind, deadlineAt: number) => AuthorityTrackedSend,
  signal?: AbortSignal,
  onTracked?: (tracked: AuthorityTrackedSend) => void,
  beforeFrame?: (kind: CheckpointFrameKind, streamDeadline?: number) => Promise<void>,
): Promise<{
  readonly manifest: AuthorityCheckpointManifest;
  readonly settled: Promise<void>;
  readonly deadlineAt: number;
}> {
  let deadline: number | undefined;
  try {
    for (;;) {
      if (signal?.aborted) throw new Error('Authority checkpoint aborted');
      if (deadline !== undefined && Date.now() >= deadline)
        throw new Error('Authority checkpoint timed out');
      // Each invocation drops its frame/data/string locals before the next iterator pull.
      const delivered = await deliverNext(prepared.frames, deadline, send, onTracked, beforeFrame);
      deadline = delivered.deadline;
      if (delivered.kind === 'checkpoint-end') {
        if (Date.now() >= delivered.deadline) throw new Error('Authority checkpoint timed out');
        return {
          manifest: prepared.manifest,
          settled: delivered.settled,
          deadlineAt: delivered.deadline,
        };
      }
    }
  } finally {
    prepared.dispose();
  }
}
