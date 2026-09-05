# Getting Started

## Prerequisites

- **Node.js** >= 18 (project uses v26.7.0 in development)
- **pnpm** 10.28.2 (specified in `packageManager` field)
- **Git** for version control

## Setup

```bash
# Clone the repository
git clone https://github.com/IrakliDevelop/fieldnotes.git
cd fieldnotes

# Install dependencies
pnpm install

# Run full verification (lint + test + build)
pnpm verify
```

## Project Structure

```
fieldnotes/
├── packages/
│   ├── core/           # @fieldnotes/core — framework-free canvas engine
│   ├── react/          # @fieldnotes/react — React bindings
│   ├── sync/           # @fieldnotes/sync — transport-neutral sync client
│   ├── sync-server/    # @fieldnotes/sync-server — WebSocket relay server
│   └── sync-redis/     # @fieldnotes/sync-redis — Redis persistence backend
├── demo/               # Vanilla JS playground
├── examples/
│   ├── react-app/      # React integration example
│   └── live-play/      # Collaboration reference app
├── website/            # Project website
└── docs/
    ├── agents/         # Agent handbook (architecture, workflow, review)
    └── wiki/           # This wiki
```

## Essential Commands

### Full Verification

```bash
pnpm verify
```

Runs: `agent:check` → `agent:format:check` → `lint` → `test` → `build`

### Per-Package Operations

```bash
# Run tests for a specific package
pnpm --filter @fieldnotes/core test

# Run a single test file
pnpm --filter @fieldnotes/core test -- src/canvas/camera.test.ts

# Build a specific package
pnpm --filter @fieldnotes/core build

# Run E2E tests (core only)
pnpm --filter @fieldnotes/core e2e
```

### Code Quality

```bash
# Lint all packages
pnpm lint

# Fix lint issues
pnpm lint:fix

# Format code
pnpm format

# Check formatting
pnpm format:check
```

### Development Server

```bash
# Start the demo app
pnpm dev
```

## First Steps for Agents

1. **Read `AGENTS.md`** — understand non-negotiable invariants
2. **Identify the owning package** — see [Architecture Overview](architecture.md)
3. **Find related tests** — tests are co-located with source files
4. **Check existing patterns** — search for similar implementations
5. **Run focused tests first** — iterate with narrow test commands
6. **Run full verification before handoff** — `pnpm verify`

## Key Files to Know

| File                                   | Purpose                                        |
| -------------------------------------- | ---------------------------------------------- |
| `packages/core/src/canvas/viewport.ts` | Composition root — coordinates all subsystems  |
| `packages/core/src/elements/types.ts`  | Element type definitions (discriminated union) |
| `packages/core/src/index.ts`           | Public API exports and VERSION constant        |
| `packages/core/src/test-setup.ts`      | Test environment setup (localStorage mock)     |
| `packages/sync/src/protocol.ts`        | Wire protocol for real-time sync               |
| `packages/sync-server/src/sync-hub.ts` | Authoritative relay logic                      |

## Version Information

Current package versions (as of September 2026):

| Package                 | Version |
| ----------------------- | ------- |
| @fieldnotes/core        | 0.68.0  |
| @fieldnotes/react       | 0.11.0  |
| @fieldnotes/sync        | 0.12.0  |
| @fieldnotes/sync-server | 0.14.0  |
| @fieldnotes/sync-redis  | 0.5.0   |

The `VERSION` constant in `packages/core/src/index.ts` must match `packages/core/package.json`.
