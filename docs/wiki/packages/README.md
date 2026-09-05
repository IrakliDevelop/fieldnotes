# Package Deep Dives

Detailed documentation for each package in the Field Notes monorepo.

## Packages

| Package                                   | Description                   | Documentation            |
| ----------------------------------------- | ----------------------------- | ------------------------ |
| [@fieldnotes/core](core.md)               | Framework-free canvas engine  | [Read →](core.md)        |
| [@fieldnotes/react](react.md)             | React bindings                | [Read →](react.md)       |
| [@fieldnotes/sync](sync.md)               | Transport-neutral sync client | [Read →](sync.md)        |
| [@fieldnotes/sync-server](sync-server.md) | WebSocket relay server        | [Read →](sync-server.md) |
| [@fieldnotes/sync-redis](sync-redis.md)   | Redis persistence backend     | [Read →](sync-redis.md)  |

## Package Relationships

```
@fieldnotes/react ──────┐
                        ├──→ @fieldnotes/core
@fieldnotes/sync ───────┘         │
       │                          │
       ▼                          │
@fieldnotes/sync-server ──────────┘
       │
       ▼
@fieldnotes/sync-redis
```

- **React** and **Sync** depend on **Core**
- **Sync Server** depends on **Sync**
- **Sync Redis** depends on **Sync** and implements **Sync Server** contracts

Dependencies flow one direction: wrappers and adapters depend toward contracts, never the reverse.
