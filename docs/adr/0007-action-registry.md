# ADR-0007: Action Registry

- **Status:** Accepted
- **Deciders:** Project maintainer
- **Date:** 2026-09-23
- **Supersedes:** —
- **Related:** [ADR-0005](0005-plugin-lifecycle.md) (plugin lifecycle)

## Context

`KeyboardHandler.runAction` is a closed `switch` over 28 literal non-tool action ids plus a
dynamic `tool:` fallback.
`ShortcutMap` hard-codes `DEFAULT_BINDINGS` and `ALLOW_SHIFT` maps alongside the switch.
`Viewport.openContextMenu` hard-codes at most 12 command items. Plugins cannot register commands,
add keyboard shortcuts, or place items in the context menu. There are zero action
references from `@fieldnotes/react` or `@fieldnotes/vtt`.

Adding a new action today requires edits in at least three locations (the switch, the
bindings map, and the context menu builder), with no compile-time guarantee that they
stay in sync. The upcoming command palette (roadmap 3.2), shortcuts-help dialog, and
`@fieldnotes/ui` toolbar all need a single enumerable source of truth for available
actions and their metadata.

## Decision

A central **action registry** is the single source of truth for every named, labelled,
predicate-guarded action in `@fieldnotes/core`. It replaces the `runAction` switch, the
hard-coded default bindings, and the hard-coded context menu items.

### ActionDefinition fields

Each action is described by an `ActionDefinition` (spec section 4):

| Field            | Type                                                             | Description                                                                          |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `id`             | `string`                                                         | Namespaced, unique, e.g. `edit.undo`, `tool.pencil`, `my-plugin.frobnicate`.         |
| `label`          | `string \| (ctx: ActionContext) => string`                       | Human-readable label; may be dynamic (e.g. `arrange.toggle-lock` shows Lock/Unlock). |
| `keywords`       | `readonly string[]` (optional)                                   | Short synonyms for palette search (e.g. `edit.delete`: `remove`, `trash`).           |
| `icon`           | `string` (optional)                                              | Identifier only (e.g. `undo`); UI layers map it to a glyph. Core never renders it.   |
| `shortcut`       | `readonly string[]` (optional)                                   | Default bindings in `ShortcutMap` syntax. User rebinding overrides these.            |
| `allowShift`     | `boolean` (optional, default `false`)                            | Match with or without Shift held (e.g. nudge actions).                               |
| `menu`           | `ActionMenuPlacement` (optional)                                 | Present when the action appears in the context menu (`group` + `order`).             |
| `enabled`        | `(ctx: ActionContext) => boolean` (optional)                     | Default: always enabled. Disabled actions are hidden from the menu and ignored.      |
| `preventDefault` | `boolean` (optional, default `true`)                             | Call `preventDefault` on the triggering keyboard event.                              |
| `perform`        | `(ctx: ActionContext, inv: ActionInvocation) => void \| boolean` | The action body. Return `false` to report "nothing happened".                        |

### Namespaced ids with legacy alias table

Action ids use a `namespace.name` convention. Legacy flat ids (from the former switch
statement) are accepted through an alias table for two minor releases, with removal
scheduled for 0.88.0 (spec section 3).

| Legacy id                                                           | Canonical id                                                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `undo` `redo` `cut` `copy` `paste` `duplicate` `delete`             | `edit.undo` `edit.redo` `edit.cut` `edit.copy` `edit.paste` `edit.duplicate` `edit.delete`       |
| `select-all` `deselect` `cycle-selection` `cycle-selection-reverse` | `select.all` `select.none` `select.cycle` `select.cycle-reverse`                                 |
| `z-front` `z-forward` `z-backward` `z-back`                         | `arrange.bring-to-front` `arrange.bring-forward` `arrange.send-backward` `arrange.send-to-back`  |
| `group` `ungroup` `toggle-lock` `rotate-cw` `rotate-ccw`            | `arrange.group` `arrange.ungroup` `arrange.toggle-lock` `arrange.rotate-cw` `arrange.rotate-ccw` |
| `nudge-left` `nudge-right` `nudge-up` `nudge-down`                  | `arrange.nudge-left` `arrange.nudge-right` `arrange.nudge-up` `arrange.nudge-down`               |
| `zoom-in` `zoom-out` `zoom-reset` `zoom-fit`                        | `view.zoom-in` `view.zoom-out` `view.zoom-reset` `view.zoom-to-fit`                              |
| `tool:<name>`                                                       | `tool.<name>`                                                                                    |

`resolveActionId(id)` maps legacy ids to canonical and returns unknown ids unchanged.
It is applied in `ActionsApi.run/get/isEnabled`, `ShortcutsApi.rebind/disable/reset`,
and in `ViewportOptions.shortcuts.bindings`. `getBindings()` returns canonical ids only. New
definitions passed to `ActionsApi.register` and `PluginConfigureContext.registerAction` must use
canonical ids: recognized legacy aliases are rejected with their canonical replacement. This does
not remove legacy lookup or input compatibility.
No console warning is emitted; the CHANGELOG carries the migration table and the removal
schedule.

### Menu placement metadata and group order

Actions that appear in the context menu carry an `ActionMenuPlacement` with a `group`
string and a numeric `order` within the group. Built-in group order is `clipboard`,
`arrange`, `transform`, `lock`; plugin groups appear after built-ins in first-seen order.
Separator entries are inserted between groups. The context menu is built by collecting
`actions.list().filter(a => a.menu && actions.isEnabled(a.id))`, grouping, sorting, and
emitting `ContextMenuItem` entries with `{ separator: true }` between groups.

### Tool actions

Tool actions are auto-registered as `tool.<name>` when a tool registers with the
`ToolManager`. `createToolAction` produces an `ActionDefinition` with the tool's default
shortcut, an `enabled` predicate that checks tool availability, and a `perform` that
switches to that tool.

### Plugin action registration

`PluginConfigureContext.registerAction(definition)` registers an action through the
registry. The unregister function is tracked with the plugin's other configure disposers,
so failed `configure`, optional-plugin rollback, and `dispose` all remove it
automatically (spec section 7; see also [ADR-0005](0005-plugin-lifecycle.md)).

### Public and internal surfaces

`ActionRegistry` is an internal class (like `ShortcutMap`). The public API is
`ActionsApi`, exposed as `viewport.actions`. `Viewport.runAction(id)` is kept as a
convenience alias that delegates to `this.actions.run(id, { source: 'api' })`.

### Wiring summary

`Viewport` constructs the `ActionRegistry` before `InputHandler`. `KeyboardHandler`
creates a `ShortcutMap`, attaches it as the registry's shortcut sink, and registers
the 28 built-in (non-tool) actions. The `runAction` switch is deleted. Key dispatch
flows through `shortcutMap.match(e)` into `registry.run(id, ...)`. `ShortcutMap` loses
its hard-coded `DEFAULT_BINDINGS` and `ALLOW_SHIFT`; defaults are injected per-action
via `setDefault(action, bindings, allowShift)` and respected only when the user has not
overridden that action.

## Alternatives considered

### Thin lookup table beside the switch

Keep the `runAction` switch and add a metadata table next to it. This avoids the
refactor but leaves three parallel data structures (switch, bindings map, menu builder)
that must be kept manually in sync. It does not support plugin-registered actions and
still requires switch edits for every new action. Rejected because it does not solve
the enumeration or extensibility goals.

### Command bus

Route actions through an event bus (`dispatch('edit.undo')`) with middleware. This adds
indirection without clear benefit for a synchronous, single-viewport system. The
registry pattern gives the same extensibility with direct function calls, predictable
ordering, and simpler debugging. Rejected because the added abstraction is not justified
by the current use cases.

## Consequences

### Positive

- **Single source of truth.** The command palette, shortcuts-help dialog, `@fieldnotes/ui`
  toolbar, and context menu all read `actions.list()` instead of maintaining parallel
  data structures.
- **Plugin extensibility.** Plugins can register actions with keyboard shortcuts and
  context menu placement through `PluginConfigureContext.registerAction`.
- **Compile-time completeness.** Adding an action is a single `ActionDefinition` object;
  no switch case or binding map entry can be forgotten.
- **Backward compatibility.** The alias table preserves existing shortcut configurations
  and API calls for two minor releases with a documented migration path.

### Neutral

- Separators are added between context menu groups. Visual appearance changes but item
  order and content are preserved.
- The Paste visibility rule is unchanged: `edit.paste` uses its `enabled` predicate to
  check clipboard availability, matching today's behavior.

### Negative

- **Intentional pre-1.0 public-output break.** `getBindings()` returns namespaced canonical keys,
  not legacy flat keys. Aliases remain accepted for `ViewportOptions.shortcuts.bindings`,
  shortcut `rebind`/`disable`/`reset`, and action `get`/`run`/`isEnabled`, but do not preserve
  legacy keys in returned maps. Consumers that persist or compare binding keys must migrate them
  (for example, `undo` to `edit.undo` and `tool:pencil` to `tool.pencil`).
- The refactor touches `KeyboardHandler`, `ShortcutMap`, `InputHandler`, `Viewport`,
  context menu rendering, and the plugin configure context. All existing keyboard and
  context menu Playwright tests must pass.
- The alias table adds a small runtime cost to every `run`/`get`/`isEnabled` call for
  two minor releases. This is negligible for synchronous string lookups.
