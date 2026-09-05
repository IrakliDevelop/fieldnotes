# Development Guide

This document covers how to add features, write tests, and follow project conventions.

## Adding a New Feature

### 1. Identify the Owning Package

| Feature type                               | Package                   |
| ------------------------------------------ | ------------------------- |
| Canvas rendering, elements, tools, history | `@fieldnotes/core`        |
| React hooks, components, context           | `@fieldnotes/react`       |
| Sync protocol, client logic                | `@fieldnotes/sync`        |
| Server relay, auth, authorization          | `@fieldnotes/sync-server` |
| Redis persistence                          | `@fieldnotes/sync-redis`  |

### 2. Find Related Code

```bash
# Search for similar implementations
rg "createNote" packages/core/src/
rg "NoteElement" packages/core/src/

# Find the test file (co-located)
ls packages/core/src/elements/note-editor.test.ts
```

### 3. Write or Identify a Test

Tests are **co-located** with source files:

```
packages/core/src/elements/
├── note-editor.ts
├── note-editor.test.ts    ← test lives here
├── element-factory.ts
└── element-factory.test.ts
```

**Test structure:**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('NoteEditor', () => {
  let editor: NoteEditor;

  beforeEach(() => {
    editor = new NoteEditor(/* deps */);
  });

  it('updates text on commit', () => {
    editor.startEditing(elementId);
    editor.commit('new text');
    expect(store.getById(elementId)?.text).toBe('new text');
  });
});
```

**Run focused tests during development:**

```bash
pnpm --filter @fieldnotes/core test -- src/elements/note-editor.test.ts
```

### 4. Implement the Feature

**Follow existing patterns:**

- Use type-only imports: `import type { CanvasElement } from './types'`
- Avoid `any` — use proper types or `unknown`
- No non-null assertions (`!`) — use optional chaining or guards
- Keep methods small and focused
- Add JSDoc only for non-obvious "why" (not "what")

**Example: Adding a new element type**

1. Define the type in `packages/core/src/elements/types.ts`:

```typescript
export interface MyElement extends BaseElement {
  type: 'my-element';
  // ... properties
}

// Add to CanvasElement union
export type CanvasElement =
  | StrokeElement
  | NoteElement
  // ...
  | MyElement; // ← add here
```

2. Add factory function in `element-factory.ts`:

```typescript
export function createMyElement(opts: MyElementOptions): MyElement {
  return {
    id: crypto.randomUUID(),
    type: 'my-element',
    position: opts.position,
    zIndex: opts.zIndex ?? 0,
    locked: false,
    layerId: opts.layerId ?? 'default',
    // ...
  };
}
```

3. Add rendering in `element-renderer.ts`
4. Add bounds calculation in `element-bounds.ts`
5. Update serializer in `state-serializer.ts` if needed
6. Add to sync protocol allowlist in `packages/sync/src/protocol.ts`
7. Export from `packages/core/src/index.ts`

### 5. Update Public API

If the feature is public, export it from the package's `src/index.ts`:

```typescript
// packages/core/src/index.ts
export { MyElement } from './elements/my-element';
export type { MyElementOptions } from './elements/my-element';
```

**For core:** Also update `VERSION` in `index.ts` and the assertion in `index.test.ts`.

### 6. Run Verification

```bash
# Focused test
pnpm --filter @fieldnotes/core test -- src/path/to/file.test.ts

# Package tests + build
pnpm --filter @fieldnotes/core test
pnpm --filter @fieldnotes/core build

# Full verification
pnpm verify
```

**Build catches TypeScript errors that tests miss** (declaration files, type exports).

## Testing Conventions

### Test Framework

- **Vitest 4.1** — test runner and assertion library
- **jsdom** — DOM environment for core tests
- **Playwright** — E2E tests for browser behavior

### Test Setup

`packages/core/src/test-setup.ts` provides:

- `localStorage` mock (Node.js 22+ compatibility)
- `document.execCommand` / `queryCommandState` stubs

**Important:** Tests use `vi.spyOn(Storage.prototype, 'setItem')` to mock storage errors. The test-setup ensures this works.

### Test Patterns

**Co-located tests:**

```
src/elements/
├── note-editor.ts
└── note-editor.test.ts
```

**Test structure:**

```typescript
describe('ClassName', () => {
  // Setup
  let instance: ClassName;
  beforeEach(() => {
    instance = new ClassName(/* deps */);
  });

  // Teardown
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Tests
  it('does X when Y', () => {
    // Arrange
    const input = createInput();

    // Act
    const result = instance.method(input);

    // Assert
    expect(result).toBe(expected);
  });

  it('handles edge case Z', () => {
    // ...
  });
});
```

**Mocking:**

```typescript
// Spy on method
const spy = vi.spyOn(obj, 'method');
expect(spy).toHaveBeenCalled();

// Mock implementation
vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
  throw new DOMException('quota', 'QuotaExceededError');
});

// Fake timers
vi.useFakeTimers();
vi.advanceTimersByTime(1000);
vi.useRealTimers();
```

**Async tests:**

```typescript
it('handles async operation', async () => {
  const promise = instance.asyncMethod();
  await vi.advanceTimersByTimeAsync(1000);
  await expect(promise).resolves.toBe(expected);
});
```

### Coverage

Coverage thresholds (in `vitest.config.ts`):

- Lines: 90%
- Branches: 85%
- Functions: 90%

**Run coverage:**

```bash
pnpm --filter @fieldnotes/core test:coverage
```

## Code Style

### Formatting

**Prettier** config (`.prettierrc`):

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

**Format code:**

```bash
pnpm format
```

### Linting

**ESLint** config (`eslint.config.mjs`):

- `@typescript-eslint/strict` — strict type checking
- `@typescript-eslint/consistent-type-imports` — use `import type`
- `@typescript-eslint/no-non-null-assertion` — no `!` operator
- `@typescript-eslint/no-unused-vars` — unused vars error (prefix with `_` to ignore)

**Lint code:**

```bash
pnpm lint
pnpm lint:fix  # auto-fix
```

### TypeScript

**Strict mode enabled** in `tsconfig.base.json`:

- `noUncheckedIndexedAccess` — indexed access returns `T | undefined`
- `noUnusedLocals` — unused locals error
- `noUnusedParameters` — unused params error

**Type-only imports:**

```typescript
// ✓ Correct
import type { CanvasElement } from './types';

// ✗ Wrong
import { CanvasElement } from './types';
```

**No `any`:**

```typescript
// ✓ Correct
function process(data: unknown): void {
  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    // ...
  }
}

// ✗ Wrong
function process(data: any): void {
  // ...
}
```

**No non-null assertions:**

```typescript
// ✓ Correct
const value = obj.prop ?? defaultValue;
const item = array[0];
if (item) {
  // use item
}

// ✗ Wrong
const value = obj.prop!;
const item = array[0]!;
```

## Git Conventions

### Branch Naming

- `feat/description` — new features
- `fix/description` — bug fixes
- `refactor/description` — refactoring
- `docs/description` — documentation
- `test/description` — test additions

### Commit Messages

**Format:** Conventional commits style

```
<type>(<scope>): <description>

[optional body]
```

**Types:**

- `feat` — new feature
- `fix` — bug fix
- `refactor` — code refactoring
- `test` — adding tests
- `docs` — documentation
- `chore` — maintenance

**Examples:**

```
feat(core): add fog of war rendering
fix(sync): handle reconnection race condition
refactor(core): extract camera transform logic
test(core): add coverage for note editor
docs: update architecture wiki
```

**Scope:** Package name (`core`, `sync`, `react`, etc.) or omitted for cross-cutting changes.

### Pull Requests

**Title:** Same format as commit messages

**Body:**

- What changed and why
- Testing done
- Screenshots (if visual)
- Breaking changes (if any)

## Releases

### Version Bumps

**Every shippable PR gets a version bump** (except instruction-only changes).

**Patch release:** Fixes, refactors (no public API changes)
**Minor release:** New public API

**For core:**

1. Update `packages/core/package.json` version
2. Update `VERSION` in `packages/core/src/index.ts`
3. Update assertion in `packages/core/src/index.test.ts`
4. Update `CHANGELOG.md`

**For wrappers:** Raise peer dependency floors if they require newer core API.

### CHANGELOG

Format follows [Keep a Changelog](https://keepachangelog.com/):

```markdown
## [0.68.0] — 2026-09-05

### Added

- `Viewport.setFogStyle(options)` — runtime fog style setter

### Fixed

- Fog convergence race condition

### Changed

- Procedural fog styling is now opt-in
```

## Verification Matrix

| Change class           | Required minimum                                                  |
| ---------------------- | ----------------------------------------------------------------- |
| Docs/agent tooling     | `pnpm agent:check`, `pnpm agent:format:check`                     |
| One package internals  | focused test, package test/build, lint, format check              |
| Core public API/model  | core tests/build, export assertions, affected wrapper/sync builds |
| Rendering/input/export | core tests/build, relevant Playwright test                        |
| Sync protocol/client   | sync tests/build plus server tests/build                          |
| Server/auth/filtering  | server tests/build plus shared sync tests                         |
| React binding          | react tests/build plus core build and React example build         |
| Cross-cutting/release  | `pnpm verify`, then relevant e2e/integration environments         |

## Common Tasks

### Adding a New Tool

1. Create `packages/core/src/tools/my-tool.ts`
2. Implement `Tool` interface
3. Register in `ToolManager` (or let users register)
4. Add to `ToolName` union in `tools/types.ts`
5. Export from `packages/core/src/index.ts`
6. Add tests

### Adding a New Element Type

See "Adding a New Feature" section above.

### Adding a New Hook (React)

1. Create `packages/react/src/hooks/use-my-hook.ts`
2. Use `useViewport()` to access viewport
3. Subscribe to relevant events
4. Return reactive state
5. Export from `hooks/index.ts`
6. Add tests

### Adding a New Sync Op

1. Add to `SyncOp` union in `packages/sync/src/protocol.ts`
2. Add validation function (`isValidMyOp`)
3. Handle in `SyncClient.applyOp()`
4. Handle in `SyncHub.routeOp()`
5. Add tests for client and server

## Debugging Tips

### Enable Verbose Logging

```typescript
// In browser console
localStorage.setItem('fieldnotes-debug', 'true');
```

### Inspect Element Store

```typescript
const viewport = /* get viewport reference */;
console.log(viewport.store.getAll());
console.log(viewport.store.getById('element-id'));
```

### Check Render Performance

```typescript
viewport.renderLoop.getStats(); // returns RenderStatsSnapshot
```

### Test Sync Locally

Use `BroadcastChannelTransport` for same-browser testing:

```typescript
const client1 = new SyncClient({
  transport: new BroadcastChannelTransport({ channel: 'test-room' }),
  // ...
});

const client2 = new SyncClient({
  transport: new BroadcastChannelTransport({ channel: 'test-room' }),
  // ...
});
```
