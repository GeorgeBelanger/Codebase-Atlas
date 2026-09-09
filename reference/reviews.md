# Reviewing a pull request with Atlas

An atlas review is an offline HTML artifact with two scopes: **PR changes** and
**Whole codebase**. The changes scope shows affected components, with an optional
one-hop dependency context. Added components have green outlines, modified components
amber outlines, and removed components dashed red outlines. The sidebar lists the
status in text, changed files and line counts, and unmapped files.

## Generate a review

Create a JSON atlas describing the PR head, then run:

```bash
node scripts/review.js atlas-head.data.json \
  --repo /path/to/repo --base origin/main --head HEAD \
  --output atlas-review.data.json
python3 scripts/build.py atlas-review.data.json atlas-review.html
```

`--base` is the target branch or revision; `--head` is the PR head. Both revisions must
exist locally. The generator uses `git merge-base(base, head)..head`, excluding changes
that only landed on the target branch. It does not change checkouts or contact an API.
Use full history or fetch the necessary history before running it in CI.

Optionally add `--pr-url https://github.com/owner/repo/pull/123` for an **Open pull request
diff** link. The viewer currently supports GitHub PR links; the comparison itself works
on any local Git repository.

For added/removed components and changed declared connections, also supply
`--base-atlas atlas-base.data.json`. That atlas should describe the merge-base revision,
not a newer target branch checkout. Explicit source commits are checked against the
comparison revisions. Without a baseline atlas, Atlas reports file impact as modified
components; it does not infer architectural additions or removals from filenames.

## What is measured

File statuses and additions/deletions come from Git, including renames and binary files
(shown as binary rather than zero lines). Component ownership follows mapped file paths,
directory boundaries and evidence paths. A file may affect multiple components. Files
with no mapped owner remain visible in the review summary.

Changed-line evidence is a separate signal. The generator intersects zero-context Git
hunks with cited node and connection ranges: head citations use new-line ranges, while
baseline citations use old-line ranges. A side is checked only when its atlas declares
the matching source commit and is neither fictional nor marked dirty. Unversioned sides
are labeled not checked. Insertions with zero old lines and deletions with zero new lines
do not falsely match adjacent citations. Binary files have no line evidence matches.
An overlap flags a citation for review; it does not prove a behavioral change.

Removed components are historical overlays from the baseline atlas. They do not change
the head atlas's mapped metrics. Source links for those overlays use the merge-base
revision. Added/removed/modified connections are comparisons of the two authored graphs;
they are not automatically extracted call graphs. A changed file does not prove that a
specific architectural claim or dependency changed. The UI reminds reviewers to recheck
the relevant evidence against the diff.

Unversioned atlases remain usable, but a Git diff cannot verify their accuracy. The
generator preserves provenance rather than assigning a source commit it did not verify.

## Navigation

- **Automatic / Authored** switches between deterministic graph placement and saved
  positions. Connections route around unrelated block footprints in either mode.
- **System overview** collapses groups; click a group block or its sidebar heading to
  expand it. **All components** expands every group.
- **PR changes / Whole codebase** changes scope while retaining change highlights.
  Positions, connection routes and the camera stay stable when changing scope or
  toggling dependency context. Use Fit all to frame the current selection of blocks.
- **Dependency context** includes immediate neighbors of changed components.
- **Review summary** returns to the changed-file/component list.
- Following a hidden connection or starting a journey reveals the needed components.
  Journeys switch to the full graph so their steps remain complete.

## CI artifact

After checkout and atlas generation, run the two commands above with the PR's base and
head SHAs, then upload `atlas-review.html` as a workflow artifact. Use JSON for generated
or contributed datasets: legacy JavaScript datasets are executable trusted input.
No token, API key, hosted service, automatic comment, or deployment is required.

The bundled `examples/review-demo.data.json` is explicitly fictional. Build it to try the
controls without using a real PR.
