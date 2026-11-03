import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { attachAwareness, createPeersSource } from '@fieldnotes/core';
import type {
  AttachAwarenessOptions,
  AwarenessFields,
  AwarenessHandle,
  Peer,
  PresenceChannel,
  ViewportSource,
} from '@fieldnotes/core';
import { useViewport } from './use-viewport';

const EMPTY_PEERS: readonly Peer[] = Object.freeze([]);
const DETACHED_SOURCE: ViewportSource<readonly Peer[]> = {
  subscribe: () => () => undefined,
  getSnapshot: () => EMPTY_PEERS,
};

export interface UsePresenceResult {
  readonly peers: readonly Peer[];
  /** Re-sends local presence, or does nothing while detached. */
  announce(): void;
  setFields(fields: AwarenessFields): void;
}

/**
 * Attaches awareness when the channel attaches. Options are read at attachment time; changing them alone does not reattach.
 */
export function usePresence(
  channel: PresenceChannel | null,
  options: AttachAwarenessOptions,
): UsePresenceResult {
  const viewport = useViewport();
  const optionsRef = useRef(options);
  const handleRef = useRef<AwarenessHandle | null>(null);
  const [handle, setHandle] = useState<AwarenessHandle | null>(null);
  optionsRef.current = options;

  useEffect(() => {
    if (!channel) return;
    const next = attachAwareness(viewport, channel, optionsRef.current);
    handleRef.current = next;
    setHandle(next);
    return () => {
      next.dispose();
      if (handleRef.current === next) handleRef.current = null;
      setHandle((current) => (current === next ? null : current));
    };
  }, [viewport, channel]);

  const source = useMemo(
    () => (handle ? createPeersSource(handle.roster) : DETACHED_SOURCE),
    [handle],
  );
  const peers = useSyncExternalStore(
    source.subscribe,
    source.getSnapshot,
    DETACHED_SOURCE.getSnapshot,
  );
  const announce = useCallback(() => handleRef.current?.announce(), []);
  const setFields = useCallback(
    (fields: AwarenessFields) => handleRef.current?.setFields(fields),
    [],
  );

  return useMemo(() => ({ peers, announce, setFields }), [peers, announce, setFields]);
}
