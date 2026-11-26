# Field Notes — Live Play example

A minimal, framework-free reference app wiring the full real-time-collab stack:
token-based join (D1), ownership edits (D2), DM secret hide/reveal (D3), and live cursors (presence).

## Run

Two processes:

```bash
pnpm --filter fieldnotes-live-play-example dev:server   # the relay on ws://localhost:8787
pnpm --filter fieldnotes-live-play-example dev:client   # the Vite dev server (open the printed URL)
```

Open the client URL in **two tabs** and pick the same room. Join one tab as **DM** and the other as
**Player 1** (a third tab can join as **Player 2**). Each choice sends one of the demo tokens in
`DEMO_TOKENS` (`src/policies.ts`) as a `Sec-WebSocket-Protocol` entry; the relay looks up the name and role
from that token. The URL carries only the room, and a `?role=` or `?name=` parameter is ignored.

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

`src/policies.ts` holds the app glue and `src/server.ts` passes it to `createSyncServer`. What each hook
protects:

| Option                    | Protects                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `allowedOrigins`          | Only pages on `http://localhost:5173` can open a socket                                                           |
| `authenticate`            | Name and role come from the server-side token table, never from the URL                                           |
| `authorize`               | Players edit only their own elements and cannot clear the room                                                    |
| `resolveAudience`         | The relay tags elements on the `dm-secret` layer and DM-only movement records `dm`; a client's own tag is ignored |
| `canRead`                 | `dm`-tagged elements never reach a player's socket                                                                |
| `resolvePresenceAudience` | The DM's measure, path and movement overlays stay DM-only; cursors reach everyone                                 |
| `canReadLayer`            | Players never receive the `dm-secret` layer definition                                                            |
| `authorizeLayer`          | Only the DM may create, edit or remove the `dm-secret` layer                                                      |
| `allowImageSrc`           | Only `data:image/` sources are stored, so no viewer's browser fetches a remote URL                                |

`src/main.ts` is the browser client. It syncs layer definitions, and the DM creates the secret layer with
the fixed id `dm-secret`. Its `makeResolveAudience` only guides local rendering. This example uses the SDK
as it ships, with no `@fieldnotes/*` changes. State is in memory and the tokens are fixed demo strings; a
real deployment adds a Redis backend and issues tokens from its own login, never shipping them to the browser.
