# Synthetic authority browser fixture

This is a local acceptance harness for the actual `createSyncServer({ authority })` WebSocket
runtime. It bundles the package's deterministic `AuthorityFixtureDriver` into ignored `dist/`
output. That driver is test-only memory state, not a Redis adapter or durable production store.
The browser client implements only C1/C2 negotiation, complete checkpoint assembly and ordered
change application; it is not the production managed client planned for E. No login, browser
storage, credentials, production endpoint or RollKeeper application is involved.

From an installed workspace root:

```bash
pnpm --filter @fieldnotes/core build
pnpm --filter @fieldnotes/sync build
pnpm --filter @fieldnotes/sync-server build
pnpm --filter @fieldnotes/sync-server fixture:build
pnpm --filter @fieldnotes/sync-server fixture:smoke
pnpm --filter @fieldnotes/sync-server fixture:start
```

The server binds only `127.0.0.1:4178` and serves only the isolated
`http://sdk-d2b.localhost:4178` Host/Origin. Open that exact URL with the prescribed Codex
in-app Browser, using two tabs for DM and public peers. If local DNS does not resolve
`sdk-d2b.localhost` to loopback, configure a local loopback mapping before inspection.
The WebSocket identity names are synthetic URL values. HTTP control commands are restricted
to the same origin. The latest 35 client events and 20 of 80 server events remain visible,
with pending operation IDs, last durable receipt, applied cursor, extension preview, element
IDs and private-sentinel visibility in status. The viewport shows only confirmed checkpoint
and ordered-change elements. Pending drawings stay as identity-scoped in-memory drafts in
`retainedDrafts`; a receipt alone does not make a drawing visible or advance the applied
cursor. Switching identity, disconnecting or losing access clears the installed projection.
No logs or storage are written by the fixture.

For manual acceptance, connect DM and public tabs and let their complete checkpoints install.
DM sees `private-sentinel`; public has neither that ID nor its owner metadata. Create, move,
then delete a public shape with the buttons or draw with the core viewport shape tool. Both
tabs receive the committed change and the origin shows a receipt separately from its applied
cursor. Request a checkpoint and reconnect; each complete stream starts at revision zero and
includes the `synthetic` extension. The fixture applies a checkpoint only after C2 assembler
completion and applies live changes only at the next cursor.

The failure controls are deliberate and visible:

- **Lose next committed response** injects a throw after the test driver has durably accepted
  one operation. The origin closes with its original identity-scoped pending proposal still in
  memory and no local-only pixels. Reconnect as the same identity, wait for its checkpoint, then
  **Retry original ID**; the driver returns the original receipt without a second mutation.
- **Pause next commit/checkpoint** holds the next driver call. Use a public tab to start the
  operation, then **Revoke public access** and **Release commit/checkpoint** to see current
  authorization reject or close. **Restore public access** permits another connection.
- **Load near-limit private state** loads 19 synthetic offscreen private notes of 940 KB each
  through test driver commits, yielding an approximately 18 MiB complete DM checkpoint. Request
  a new DM checkpoint to observe paced chunks. The public projection remains small.
- Connect a **Stalled public** tab to hold one checkpoint chunk in the outbound guard. A DM
  or ordinary public tab can still commit and receive state. **Release stalled peer** settles
  that guard; the stalled peer may have already timed out and closed at the fixed frame deadline.
- **Legacy incapable** advertises old capabilities and must receive `upgrade-required`, close
  4406, and never enter the authority room.

For evidence, capture the exact Git head/build command, isolated origin, selected peers,
connection/receipt/applied-cursor status, relevant bounded client and server events, close
codes, and the active failure control. `fixture:smoke` is supplemental socket evidence; it
does not satisfy the required in-app manual Browser gate. Stop `fixture:start` with Ctrl-C
and close only the fixture tabs. The process discards its in-memory state on exit; generated
bundles live under ignored `packages/sync-server/dist/authority-browser` and are removed by
the normal package build clean step.
