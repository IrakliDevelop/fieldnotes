# Architecture Decision Records

ADRs for Field Notes architecture decisions. ADR-0001 to ADR-0006 cover the VTT extraction and extension system and gate the migration plan in `MIGRATION_VTT_EXTRACTION.md`; later ADRs record subsequent decisions such as element versioning.

| ADR                                             | Title                                               | Status                                                                                                                                  | Date       |
| ----------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| [ADR-0001](0001-element-extensibility.md)       | Element Extensibility Model                         | **Accepted and implemented; legacy types removed from core in the v4 release**                                                          | 2026-09-05 |
| [ADR-0002](0002-render-surface-model.md)        | Render Surface Model                                | **Accepted and implemented; render-time fail-closed enforcement since core 0.90.0; overlay stratum and `afterLayer` since core 0.91.0** | 2026-09-05 |
| [ADR-0003](0003-sync-plugin-ownership.md)       | Sync/Server Plugin Ownership                        | **Accepted; v3 implemented**                                                                                                            | 2026-09-05 |
| [ADR-0004](0004-serialization-compatibility.md) | Serialization Compatibility Strategy                | **Accepted; v4 pending**                                                                                                                | 2026-09-05 |
| [ADR-0005](0005-plugin-lifecycle.md)            | Plugin Lifecycle & Installation                     | **Accepted and implemented**                                                                                                            | 2026-09-05 |
| [ADR-0006](0006-snapping-as-service.md)         | Snapping as Opt-In Service                          | **Accepted and implemented**                                                                                                            | 2026-09-05 |
| [ADR-0007](0007-action-registry.md)             | Action Registry                                     | **Accepted**                                                                                                                            | 2026-09-23 |
| [ADR-0008](0008-element-versioning.md)          | Element Versioning, Tombstones and Fractional Order | **Accepted; implemented in core 0.93.0 and sync 0.28.0**                                                                                | 2026-10-19 |
| [ADR-0009](0009-parent-child-clipping.md)       | Parent-child relationships and rectangular clipping | **Accepted; implementation pending**                                                                                                    | 2026-10-26 |

## Context

These ADRs were written in response to a Codex review of the initial migration plan (`MIGRATION_VTT_EXTRACTION.md`, `PLAN_VTT_EXTRACTION.md`). The review identified six P1 architectural gaps that had to be resolved before VTT code moved. Each ADR documents the decision, the alternatives considered, and the consequences for the migration. The v3 decisions are implemented; ADR-0004 retains the coordinated v4 transition as post-RollKeeper work.

## How to Use

- Each ADR is self-contained but cross-references related ADRs.
- The migration plan references ADRs by number (e.g., "see ADR-0001").
- ADRs can be superseded by new ADRs — the superseded ADR's status changes to "Superseded" with a pointer.
