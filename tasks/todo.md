# Data improvements

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

The offline HTML output and optional emoji/AWS controls remain supported. Existing
JavaScript datasets remain a trusted-author compatibility format; JSON is preferred
for new datasets. The bookshop remains clearly labeled fictional.
