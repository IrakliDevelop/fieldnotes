# Kickoff: RollKeeper Field Notes VTT v3 production soak

Use this prompt to begin the production-rollout gate after RollKeeper PR #310. It intentionally does
not authorize a deployment by itself. The executing operator or agent must receive explicit
authorization before changing hosted infrastructure, production traffic, feature flags, or data.

## Prompt

Work from `~/Projects` with access to both repositories:

- `~/Projects/RollKeeper`
- `~/Projects/fieldnotes`

Prepare and, only when explicitly authorized, execute the coordinated production rollout and soak of
RollKeeper's merged Field Notes VTT v3 adoption. This is the final gate before a separate task may
begin CanvasState v4 capability negotiation and legacy cleanup.

The confirmed code baseline is:

- Field Notes extraction is complete on v3. Verify the current `origin/master`; do not assume an old
  local checkout is current.
- Field Notes PRs #178 and #179 are merged.
- RollKeeper PR #310 is merged to `master` as `15cc322e56cb87a7808127a77c0f0a0a260b7a89`.
- The reviewed package set is `@fieldnotes/core` 0.81.1, `@fieldnotes/vtt` 0.7.1,
  `@fieldnotes/sync` 0.18.1, `@fieldnotes/sync-server` 0.17.1,
  `@fieldnotes/sync-redis` 0.8.1, and `@fieldnotes/react` 0.11.0.

Do not introduce CanvasState v4, extension-shaped wire elements, capability negotiation, legacy fog
removal, top-level fog removal, grid/template legacy removal, or the final core compatibility cleanup
during this task. Do not publish Field Notes packages or change Field Notes unless a discriminating
regression test proves a real upstream defect. Put any necessary upstream fix on a separate Field
Notes branch and PR.

Start with read-only discovery:

1. Inspect `git status --short`, current branch, `origin/master`, release/deployment configuration,
   and every applicable `AGENTS.md` and repository-local skill in both repositories. Preserve all
   unrelated and untracked files.
2. Read `MIGRATION_VTT_EXTRACTION.md`, ADR-0004, and
   `RollKeeper/docs/FIELDNOTES_VTT_V3_ADOPTION.md`. Verify PR #310 and post-merge CI rather than
   trusting status labels.
3. Inventory the currently deployed web, relay, Redis/backend, database, and feature-flag versions.
   Record immutable artifact or commit identifiers and the resolved Field Notes package versions.
4. Identify who can authorize each rollout step, where monitoring is observed, the production
   cohort, and the exact previous application/relay artifacts used for rollback. Stop if any of these
   are unknown; do not infer authority.
5. Establish pre-rollout baselines for authorization rejects, relay errors, Redis write/retry
   failures, reconnects, snapshot convergence, first-render privacy, and relevant latency/error
   measures. Define go/no-go thresholds before shifting traffic.

Before production traffic changes, produce a rollout record containing:

- Exact web, relay, infrastructure, Redis, database, and package versions.
- Confirmation that no irreversible schema or persistence migration is included.
- The previous known-good web and relay artifacts and a rehearsed coordinated rollback procedure.
- The test and smoke matrix, responsible operator, observation window, dashboards/log queries, and
  abort thresholds.
- Explicit deployment authorization. Without it, finish with a readiness report only.

When authorized, preserve this deployment order:

1. Verify or deploy plugin-capable server/Redis infrastructure while retaining v3 compatibility.
2. Deploy the RollKeeper relay integration and verify DM-only authorization, filtered snapshots,
   backend locality, buffering, and cross-instance fanout before deploying the client.
3. Deploy the RollKeeper web/client integration and verify that the resolved package set matches the
   reviewed versions.
4. Start with the smallest authorized cohort, run the acceptance matrix, then expand only when the
   predefined gates pass.
5. Soak for 2–4 weeks. Record UTC start/end times, cohort changes, incidents, rollbacks, package or
   artifact drift, and monitoring evidence.

The acceptance matrix must include:

- Pre-existing production-shaped v3 battlemaps, including legacy grid/template shapes and both
  top-level `fog` and `extensions.fog`.
- DM editing plus player and TV rendering, with proof there is no unmasked first frame.
- Proof that unauthorized clients receive no hidden bytes in initial/reconnect snapshots,
  corrections, live operations, logs, caches, or cross-instance fanout.
- At least two relay instances with Redis fanout, stale-writer rejection, reconnect, offline fog
  edits, snapshot convergence, and rollback protection.
- Buffered backend hydration, operation locality, flush/retry, TTL/eviction, concurrent writes, and
  failure-safe shutdown under deployed configuration.
- Image export, SVG export, minimap, fog tools, measure tools, shared rulers, grid/template rendering,
  player mode, TV mode, and DM behavior.
- Real browser pointer coverage for template aiming/resizing and grid snapping with mouse, touch, and
  stylus where production devices permit it. Each gesture must remain one undo step.
- A mixed old/new v3 client exercise during the controlled rollout where infrastructure supports it.

Fail closed. Any hidden-byte disclosure, unmasked frame, authorization bypass, persisted-state loss,
non-converging snapshot, or unsafe backend shutdown is an immediate stop and rollback condition.
Rollback the RollKeeper web and relay to the previous known-good release as a coordinated set; do not
partially roll back one side unless the pre-approved runbook demonstrates that combination is safe.
Because the adoption remains v3 and dual-writes fog, soak data must remain readable by the previous
release—verify this with a real rollback rehearsal rather than assuming it.

Deliver:

- A timestamped readiness and rollout evidence report with exact commands/checks and results.
- Deployment and rollback artifact identifiers, authorization record, cohort history, and soak
  monitoring evidence.
- Every failure, incident, skipped check, and environmental limitation.
- A clear go/no-go conclusion for ending the soak.
- If and only if the soak succeeds, an update to `MIGRATION_VTT_EXTRACTION.md` marking the production
  gate complete and a recommendation to create a separate v4 implementation plan. Do not implement
  v4 or remove legacy compatibility in this task.
