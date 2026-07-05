# Field Notes — Live Play example

A minimal, framework-free reference app wiring the full real-time-collab stack:
role-based join (D1), ownership edits (D2), DM secret hide/reveal (D3), and live cursors (presence).

## Run

Two processes:

```bash
pnpm --filter fieldnotes-live-play-example dev:server   # the relay on ws://localhost:8787
pnpm --filter fieldnotes-live-play-example dev:client   # the Vite dev server (open the printed URL)
```

Open the client URL in **two tabs**. Join one as **DM**, one as **Player** (use **unique names** — the name is
your identity). Pick the same room.

## Try it

- **Canvas tools** — the toolbar has the standard instrumentation (Select, Pan, Draw, Shape, Arrow, Note, Text,
  Eraser) plus **Undo / Redo**; everything you draw syncs live to the other tab.
- **Live cursors** — move the pointer in one tab; the other shows your labeled cursor.
- **Tokens** — click **Token** then click the canvas to drop your (owner-colored) token; **Select** to drag.
- **Ownership (D2)** — as the player, drag the DM's token: it **snaps back on release** (the relay denies the edit
  and its correction reverts it). Your own tokens move freely.
- **DM hide/reveal (D3)** — as the DM, select a token and click **Hide from players** — it vanishes from the
  player's tab; **Reveal** brings it back. The player never receives the hidden token's data.

## How it works

`src/policies.ts` is the whole "app glue": `authenticate` / `authorize` / `canRead` (server) + `resolveAudience`
(client). `src/server.ts` wires them into `createSyncServer`; `src/main.ts` is the browser client. This example
uses the SDK as-is — no `@fieldnotes/*` changes. It's a demo: in-memory state, query-string identity; a real
deployment adds a Redis backend and real token auth.
