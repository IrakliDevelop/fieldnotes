# Managed authority client browser fixture

This isolated acceptance fixture runs the public `createManagedAuthorityConnection` against a real
loopback `createSyncServer({ authority })` socket. The authority driver is the deterministic,
in-memory D2b test fixture: its durability lasts only for this process. It uses no account, cookie,
browser storage, Redis, production endpoint, or application-specific data.

From the installed workspace root:

```bash
pnpm --filter @fieldnotes/core build
pnpm --filter @fieldnotes/sync build
pnpm --filter @fieldnotes/sync-server build
pnpm --filter @fieldnotes/sync-server authority-client:build
pnpm --filter @fieldnotes/sync-server authority-client:smoke
pnpm --filter @fieldnotes/sync-server authority-client:start
```

The default is loopback-only port `4179`; an explicit bounded port can be selected with
`AUTHORITY_CLIENT_FIXTURE_PORT=4180`. Open the exact isolated origin
`http://sdk-e.localhost:4179` (or the selected port). If local name resolution does not map
`sdk-e.localhost` to loopback, add only that loopback mapping. Stop with Ctrl-C. State is discarded
and no log/storage artifact is written. Generated bundles remain under ignored
`packages/sync-server/dist/authority-client-browser` and normal package builds clean them.

The status panel exposes `data-status`, `data-generation`, draft/pending/rejected/uncertain/accepted
operation counts, core projection invariant, console state, failure-control state, corrupt-checkpoint
state/count, and Reset result for automation. Proposal failure buttons select a local mode; the exact
Submit, Retry, or Reapply transaction then moves through
`selected → quiescing → arming → ready → handed-off → settling → idle`. The transport remains closed
while arm/status evidence is ambiguous. Submit and Reapply create the exact operation offline, then
explicitly retry that retained ID/wire only after a transport outside the captured pre-arm set reports
a later open episode and the current manager is live; stale `live` from a socket whose normal `1000`
close event is delayed is never reconnection evidence. Retry must return exact `sent` evidence before
the transaction becomes `handed-off`. Open/live timeout or retry refusal re-holds transport admission
and performs bounded same-ID clear/status reconciliation with a fresh five-second cleanup deadline;
merely creating the draft cannot consume server ownership. The status payload exposes the monotonic
transport open episode plus exact registration/waiter counts for leak checks. `reconciling` and
`error` are visible blocked states, and the same control button retries exact cleanup. While either
state, blocked Reset, an inert manager, or a held transport persists, every other work/local-state
control stays fenced. The canonical panel shows
elements, layer records and tombstones, cursor/CAS, and the typed synthetic extension.
Projection into the real
`@fieldnotes/core` viewport uses `origin: remote`; the displayed history count must remain unchanged.
Only the SDK-owned canonical document is an atomic boundary. No claim is made that an arbitrary
presentation callback or store update is atomic.

Fixture-initiated gate and manual disconnects use normal WebSocket close code `1000`, which the
managed authority client treats as recoverable; server protocol close codes are unchanged.

Manual matrix (required independently of automated smoke):

1. **Initial install/edit:** wait for `live`, create and submit an element and extension draft, then
   observe separate accepted IDs, canonical application, extension state, and core projection with
   `projectionHistory: PASS`.
2. **Barrier plus later edit:** submit one edit, capture the barrier, create/submit a visibly
   different ID, wait for acknowledgements, and request the checkpoint. The barrier membership/cut
   excludes the later operation even if the checkpoint contains its canonical effect.
3. **Disconnect/uncertain exact retry:** choose **Lose next durable response**, submit, and observe
   the bound control transaction through `arming`, `ready`, `handed-off`, and `settling`. The server
   consumes it only for the displayed operation ID. Observe the retained uncertain ID after
   reconnect. Do **not** select a failure mode again. Use **Retry exact ID/wire** once; the authority
   returns the replayed durable receipt, the same operation becomes accepted, and the canonical effect
   remains exactly one. Deliberately selecting **Lose next durable response** again before Retry arms a
   new loss transaction and therefore leaves that exact retry uncertain again.
4. **Rejection and generation replacement:** choose **Definitely reject next operation**, submit,
   which likewise waits for the acknowledged `ready` state, then **Replace generation**. The old
   proposal remains visible and is never automatically replayed. Use **Reapply as new ID** only after
   reading its duplicate-effect warning, or **Explicitly discard**. Overlapping failure-control or
   Submit clicks are refused so one acknowledged control governs exactly one admitted proposal.
5. **Corrupt state keeps the confirmed document:** use **Corrupt next checkpoint hash** or **Fail next
   checkpoint extension**. The server-side extension failure first stops the old manager, arms a
   lifecycle-unique recovery episode, and tags only its fresh loopback connection through synthetic
   auth context. An earlier or ordinary checkpoint cannot consume it. After exact consumption, the
   next recovery is untagged and valid. Hash corruption remains transport-local and is consumed once
   at `checkpoint-begin`. The prior canonical document and viewport remain while status recovers;
   invalid state is never installed or reported live.

Toggle and inspect both light and dark themes, responsive narrow layout, focus outlines, the core
history marker, and browser console. Any `INVARIANT` or `Fixture error` console entry is a failure.
Use **Reset fixture** between scenarios. Reset has a lifecycle-unique ID and an authoritative expected
generation. A Reset clicked while an ordinary action is awaiting work is visibly queued and begins in
the next microtask only after that action's epoch-checked continuation completes. Further Reset clicks
are refused while one is queued. It then fences every action, releases any barrier, unsubscribes/stops the old
manager/transport, and clears retained presentation state. The server serially invalidates any
failure owner, replaces/seeds once, and records a replay-safe result. A lost acknowledgement is
reconciled by exact Reset ID; stale, expired, partial, or unknown results require one confirmed
`generation-status` before a new preconditioned Reset attempt. Only exact `completed` evidence creates
one fresh subscribed manager. Until then the old stopped manager remains inert for status display and
all work stays fenced. Old callbacks cannot cross the lifecycle epoch. Repeated Reset does not retain
barrier pins, listeners, transports, retry timers, or server one-shot state. Both `window.error` and
`unhandledrejection` mark the automation-readable console state as `error`.
Reset cancels and removes an active transport-episode waiter immediately, while its authoritative
server mutation remains serialized behind the active action; the canceled continuation cannot retry
through either the stopped manager or the fresh manager created after Reset.

An active different Reset ID reports `reset-busy`/`reset-mismatch`, and reusing the same ID with a
different expected generation reports `identity-mismatch`. These identity conflicts stay fenced and
never trigger automatic new-ID recovery; after the conflicting transaction settles, recovery requires
another explicit Reset. Failure settlement shares one absolute five-second transaction deadline
across its status requests rather than granting every poll a fresh timeout.
An explicit click on the same failure mode while ownership is `reconciling` creates one fresh bounded
five-second cleanup attempt for the existing control ID; it never arms a new owner. A timeout stays
fenced and permits another explicit cleanup attempt or Reset.

The loopback-only `/control` protocol uses printable bounded IDs, generation-fenced failure arms,
exact status/clear commands, a 32-entry failure tombstone bound, a 16-entry Reset ledger, and a
16-entry generation-replacement ledger. Generation replacement is itself ID-addressed and
generation-preconditioned. It shares the server mutation lane with failure arm and Reset. The lane
retains at most one server-owned exact Reset waiter behind replacement, even when both HTTP clients
time out; a duplicate exact waiter joins, while a different identity is refused. Test-only
dropped acknowledgements mutate first and destroy the response so automation can prove reconciliation.
Each reservation carries a monotonic owner epoch, so even a completion older than the tombstone bound
is recognized as Reset-stale without retaining an unbounded invalidation set. A late durable proposal
returns its underlying committed result; a late checkpoint lease is released exactly once and rejected.
The client validates each response as an exact fixed-schema discriminated object, including key set,
polarity, kind/code, echoed IDs/targets/modes, and generations; partial, contradictory, or extra-field
responses never prove safety. No fixture control changes the authority wire or a published package
entry point.

`authority-client:smoke` is supplemental automation for build/start/socket/manager behavior. It is
not a substitute for the coordinator-owned in-app Browser manual acceptance matrix.
