# Code-review playbook

Review behavior and contracts before style. Read the diff, then inspect callers and tests outside it;
a locally plausible edit can violate a cross-package invariant.

## Review order

1. **Intent and scope:** requested behavior without unrelated changes.
2. **Correctness:** edge cases, cancellation, cleanup, ordering, error paths, races, reconnects.
3. **Contracts:** exports, persisted data, protocol compatibility, peers, versions, core boundaries.
4. **Security/privacy:** HTML, URLs, auth, authorization, and per-viewer filtering are trust boundaries.
   Forbidden bytes must not be sent, not merely hidden in the UI.
5. **Interaction:** mouse/touch/stylus parity, capture, pressure, multi-pointer takeover, focus, history.
6. **Rendering/performance:** per-frame allocation, cache invalidation, culling, DOM/canvas parity, DPR,
   export behavior, and unbounded listeners or timers.
7. **Tests:** require a regression test that fails without the fix, negative cases, and a DTS build.
8. **Maintainability:** established boundaries, focused files, strict types, no incidental API widening.

## Severity and output

- `P0`: data/security catastrophe or unusable release; blocks immediately.
- `P1`: likely correctness, compatibility, privacy, or major regression; must fix.
- `P2`: real narrower-path issue or maintainability issue likely to cause defects; should fix.
- `P3`: optional improvement; do not present preference as a defect.

List findings first by severity, with precise file/line, failure scenario, and why tests do not protect
it. If there are no findings, say so and name residual test or environment gaps.
