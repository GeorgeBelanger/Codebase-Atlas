# Data improvements

## Review precision and layout continuity

- [x] Preserve component positions, routes and camera across review scope changes.
- [x] Advance automatic layout top-left to bottom-right, including cyclic groups.
- [x] Remove canvas legend and instruction text.
- [x] Match changed lines to revision-bound node and connection citations.
- [x] Add orientation, evidence-boundary and browser continuity regressions.

- [x] Normalize file counts, mapped totals and block heights from one inventory.
- [x] Validate nested data, evidence, geometry and journey continuity; support JSON.
- [x] Show provenance, source links and confidence in the viewer.
- [x] Support named journeys and repeated visits.
- [x] Broaden deterministic repository reconnaissance and check freshness.
- [x] Add regression tests and CI; verify both themes and legacy data.
- [x] Commit and push the verified data implementation.

## Studio redesign

- [x] Light Studio theme and rounded, docked controls.
- [x] Explicit component kinds: service, database, queue, frontend.
- [x] Softer block rendering, reduced depth, and shared rounded connection paths.
- [x] Official AWS architecture SVG icons embedded for offline use.
- [x] Data tests and browser verification of rendering, icons and repeated journeys.

## Architecture exploration and PR reviews

- [x] Deterministic automatic layout and obstacle-aware connection routing.
- [x] Expandable system groups with preserved journeys and search.
- [x] Merge-base-to-head Git comparison, ownership mapping, and historical overlays.
- [x] PR changes / whole-codebase scopes, dependency context, and unmapped files.
- [x] Fictional review demo and documented CLI workflow.
- [x] Complete browser/CI verification and push (28 local tests; all-theme and PR browser suites passed).

The offline HTML output and optional emoji/AWS controls remain supported. Existing
JavaScript datasets remain a trusted-author compatibility format; JSON is preferred
for new datasets. The bookshop remains clearly labeled fictional.
