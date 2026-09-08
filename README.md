# Codebase Atlas

A [Claude Code](https://claude.com/claude-code) skill that turns a repository into an
interactive isometric map: one block per real part of the system, lines for the paths data
actually takes, and a play button that walks the one journey that matters — a request, a
build, a nightly job, an order.

Built for the person who has to understand a system without reading it: a product manager,
a new joiner, a founder explaining their own stack to somebody else.

Screenshots of the bundled example — a fictional bookshop, from search box to doorstep —
are in [`screenshots/`](screenshots), one per theme. Start with
[`theme-foundry-default.png`](screenshots/theme-foundry-default.png).

## What makes it different from a diagram

- **Height is information.** A taller block holds more code. The tallest block is the one
  you would warn a new engineer about first.
- **Every block answers two product questions**, not just "what is this": *why it matters*
  and *what a user sees if it breaks*.
- **The journey animates.** Twelve to sixteen steps, grouped into chapters, with a numbered
  trail left behind, so the path is legible after it finishes.
- **One self-contained HTML file.** No build step, no dependencies, no network calls.

## Install

```bash
git clone https://github.com/lucaburlando/Codebase-Atlas.git ~/.claude/skills/codebase-atlas
```

Then, in any repository:

```
/codebase-atlas
```

It also triggers on requests like "map this codebase", "visualise the architecture", or
"explain this repo to a non-engineer".

## How it works

The model does **not** write a renderer. `assets/engine.html` already contains the canvas
engine, the interactions and the responsive shell. The model writes one data file:

```js
const G     = { … }   // lanes: floor tag, full name, colour
const N     = [ … ]   // blocks: grid position, height, files, stack
const COPY  = { … }   // per block: label, one-liner, why it matters, if it breaks
const E     = [ … ]   // edges: real call and data paths
const STEPS = [ … ]   // the journey, one caption per step
const META  = { … }   // title, stats, chapters, opening panel
```

For new atlases, save the same fields as `atlas.data.json` with `schemaVersion: 2`.
JSON is safe to parse and is the format used by the bundled example; legacy JavaScript is
kept only for compatibility with existing trusted datasets.

Then:

```bash
node   scripts/validate.js  atlas.data.json             # free correctness check
python3 scripts/build.py    atlas.data.json atlas.html theme.css
       scripts/shoot.sh     atlas.html                  # 3 viewports, kills its own server
```

Pass `--repo path/to/repository` to `validate.js` or `build.py` when the data includes
real file evidence. The repository must be clean and at the declared commit; the command
measures mapped files, expands directory references, checks evidence ranges, and records a
fresh inventory. Fictional or inferred data can be built without a repository.

`validate.js` catches the mistakes that are invisible in code and expensive to find in a
screenshot: blocks whose footprints overlap, edges pointing at blocks that do not exist,
journey steps naming an edge that was never declared, missing copy, labels too long to fit.

## Exploring an atlas

The default **Studio** theme uses a light canvas, soft isometric blocks and rounded
connections, with a docked journey bar. Set a block's `kind` to `service`, `database`,
`queue` or `frontend` for rounded blocks, cylinders, stacks or window tiles. Omitted
kinds keep the service shape. Heights retain the measured ordering with reduced screen
depth; exact file and line counts remain in the details panel.

- **Icons off / on** shows optional emoji beside block labels. Add `icon:'⚙️'`
  to a node to assign one; the bookshop example includes icons for all its blocks.
  Icons start off on every load, and atlases without them retain the original look.
  Small roofs fall back to text. Emoji use the system font and work offline.
- **AWS off / on** shows optional official AWS architecture icons. Add `aws:'lambda'`,
  `aws:'s3'`, `aws:'rds'`, `aws:'sqs'` or another supported service identifier.
  The original SVG artwork is bundled in the HTML and works offline. Source and
  attribution are in `assets/aws/README.md`. Keep the field only where the source
  data confirms the AWS service; the atlas does not infer a vendor from a generic
  block name.

- Search by block name, description, lane, source path or technology. Matches stay
  bright on the map; select a result (or press Enter) to center it. Clear restores
  the full list. Following a connection outside the results clears the filter.
- Hide the block list or detail panel for more map space. **Fit all** changes only
  the camera; **Focus neighbors** fits the selected block and its connections.
- Walk with **Previous / Next**, jump to a chapter, or scrub to a specific step.
  Playback offers 2, 4 or 6 seconds per step and preserves progress when paused.
  **Restart journey** returns to the first step without starting playback.
- Static arrows show connection direction. Hover or click an exposed line to read
  its source, destination, relationship kind, confidence and evidence; the current journey
  connection is labeled too. Named journeys appear in a selector, and repeated visits keep
  their visit numbers after playback.
- Space plays/pauses and arrow keys walk the journey when focus is outside a
  control. Inputs, buttons and the pace selector retain their normal key behavior.

## Themes

Three are bundled. Studio is the built-in default; pass a theme file to use another one,
or write your own — a theme is ten lines.

```bash
python3 scripts/build.py atlas.data.js atlas.html themes/drafting.css
```

| Theme | Look | Fits | Screenshot |
|---|---|---|---|
| **Studio** *(default)* | cool paper, soft shading, indigo accent | architecture exploration | Build the bundled example without a theme argument |
| **Foundry** | oxidised brass on warm black, vermilion accent | pipelines, content systems, anything with a voice | [`screenshots/theme-foundry-default.png`](screenshots/theme-foundry-default.png) |
| **Drafting** | ink on paper, graphite lines, deep teal accent — the light one | documents, compilers, anything precise | [`screenshots/theme-drafting-light.png`](screenshots/theme-drafting-light.png) |

The canvas reads the same CSS tokens as the page, so the drawing follows the theme instead
of staying in the default palette.

## Writing your own

```css
:root{
  --ground:#0B1015; --plate:#111920; --rule:#1E2A33;
  --brass:#5E7C8C;  --parch:#DCE4EA; --stone:#7C8B96;
  --coral:#FF6A2B;  /* the one accent: live, selected, now */
  --serif:'Avenir Next',system-ui,sans-serif;
  --mono:ui-monospace,Menlo,monospace;
}
```

Roles, not names: `--brass` draws the lines, `--coral` is the accent that means *now*,
`--parch` is body text. Only override what you want to change.

## Layout

```
SKILL.md                    workflow and token rules
assets/engine.html          the renderer
scripts/recon.sh            bounded reconnaissance, one call
scripts/validate.js         correctness check
scripts/build.py            engine + data + theme -> one file
scripts/shoot.sh            headless screenshots, no installs
reference/                  schema · copy · layout · theme · traps
themes/                     two ready-made looks
examples/order-flow.*       a complete worked example
screenshots/                one per theme
```

## Honest limitations

- **The map is hand-authored.** It is true on the day it is made and will drift as the code
  changes. It is a teaching object, not generated documentation.
- **The example is fictional.** Northgate is invented, so no real system is disclosed. For a
  real repository every line count must come from `wc -l` and every path must exist.
- **Screenshots need a Chromium that is already installed.** The skill never installs one;
  if there is none, it says so and skips the visual check.

## Licence

MIT. See [LICENSE](LICENSE).
