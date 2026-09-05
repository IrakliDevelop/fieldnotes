# Architecture Decision Records

ADRs for the VTT extraction and extension system design. These decisions gate the migration plan in `MIGRATION_VTT_EXTRACTION.md`.

| ADR                                             | Title                                | Status      | Date       |
| ----------------------------------------------- | ------------------------------------ | ----------- | ---------- |
| [ADR-0001](0001-element-extensibility.md)       | Element Extensibility Model          | **Decided** | 2026-09-05 |
| [ADR-0002](0002-render-surface-model.md)        | Render Surface Model                 | **Decided** | 2026-09-05 |
| [ADR-0003](0003-sync-plugin-ownership.md)       | Sync/Server Plugin Ownership         | **Decided** | 2026-09-05 |
| [ADR-0004](0004-serialization-compatibility.md) | Serialization Compatibility Strategy | **Decided** | 2026-09-05 |
| [ADR-0005](0005-plugin-lifecycle.md)            | Plugin Lifecycle & Installation      | **Decided** | 2026-09-05 |
| [ADR-0006](0006-snapping-as-service.md)         | Snapping as Opt-In Service           | **Decided** | 2026-09-05 |

## Context

These ADRs were written in response to a Codex review of the initial migration plan (`MIGRATION_VTT_EXTRACTION.md`, `PLAN_VTT_EXTRACTION.md`). The review identified six P1 architectural gaps that must be resolved before any VTT code moves. Each ADR documents the decision, the alternatives considered, and the consequences for the migration.

## How to Use

- Each ADR is self-contained but cross-references related ADRs.
- The migration plan references ADRs by number (e.g., "see ADR-0001").
- ADRs can be superseded by new ADRs — the superseded ADR's status changes to "Superseded" with a pointer.
