# Handoff: Cascade Intelligence website (72_UI), remaining phases

Paste everything below the line into a new Claude Code session opened in a clone of the repo.

---

You are continuing a multi-phase redesign of **Cascade Intelligence**, a static website of urban
digital twins (Nagpur, Maharashtra and Raleigh, NC) with a crisis-cascade forecasting layer.
Phases 0–2 and the Response, Warnings and My area pages are done and pushed. Your job is to plan
and build what remains, one phase at a time, with my approval between phases.

## Repository and branch

- Primary repo: https://github.com/shreyascoder2006/72_UI
- Work only on branch `claude/serene-bardeen-sbf0c3`. Commit and push there. **Do not open a PR.**
- When this was written, the latest commit before this file was `4991e4f` ("Add My area, and
  finish the six-feature sidebar"). Run `git pull` first, because others may have pushed since.
- Reference repo (capabilities only, not its look): https://github.com/vizsh/72_hours_CASCADE at
  commit `9bc9058`. The owner has given permission to port its code. **Never edit the reference repo.**
- End every commit message with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MEKY5fwsch9J9aDAkCmCFR
  ```
  Use no model names anywhere else in commit messages.

## Rules I set (non-negotiable)

1. 72_UI is the primary product. Learn backend capabilities from the reference, **not** its UI.
   Do not import: the reference look and layouts, its generated "city of light" home canvas, or
   its command-palette styling. The *idea* of global search is kept.
2. **Nagpur is in scope for every phase**: its scenarios, UI, map, visuals and data, including
   telecom. Every new feature must work for both cities, and Nagpur is the default city.
3. Do not change simulation algorithms or risk calculations without my explicit approval.
   Two engine changes are deferred and need approval first: **E4** (buddy check / step test for
   sensor trust) and **E5** (severity-aware verification).
4. No hardcoded KPIs, fabricated results or mock backends. Every number on a page must come from
   the engine at the issue time. Label simulated data honestly: *modeled*, *reconstruction*,
   *illustrative*, *EXERCISE*.
5. No pages for their own sake and no single dashboard or KPI wall. Don't add a backend or
   framework unless it's needed. Don't remove working functionality without a reason. Preserve
   working state; no destructive git operations.
6. **Plan before coding and wait for my approval.** After building a phase, show me the result and
   **do not commit until I ask**.
7. Write code in the style of the surrounding code: vanilla JS on a `window.TWIN` namespace, with
   the comment density and idiom of `src/js/site/*.js` and `src/js/views/*.js`.

## What exists now (verify by reading the code)

- **Stack:** static site with no build step for development. MapLibre GL 4.7.1 with a custom
  WebGL2 building renderer (`src/js/map/buildings.js`), Three.js hero models
  (`src/js/map/heroes.js`), and a hash router.
- **Engine** (`src/js/engine/`):
  - `engine.js`: 200-member ensemble, particle filter, ARD dependency learning, forecasts,
    `cascade(k)`, alerts and replay validation.
  - `scenarios.js`: Raleigh scenarios tropical, flash, heat and blackout. Nagpur adds monsoon2023
    (reconstruction), chlorine and festival.
  - `interventions.js`: the planner, with decision deadlines and the "ghost-city" trajectory.
  - `analytics.js`: Cascade-R, the crisis registry and footprints.
  - `population.js`: the modeled residents.
  - `comms.js`: sitreps, CAP 1.2 alerts and cell-broadcast SMS.
- **Site** (`src/js/site/`):
  - `services.js`: one engine per city|scenario, planner and recommendation caches.
  - `store.js`: context in the hash: `#/<path>?city&s&t&m&a&c&area`.
  - `router.js`, `pages.js` (header, issue time, SVG city map) and `nav.js` (the six-feature
    sidebar).
- **Pages** (`src/js/views/`):
  - `overview.js` (`#/`, Situation)
  - `crises.js` (`#/crises`, `#/crises/:id`)
  - `twin.js` (`#/twin`, City twin)
  - `plan.js` (`#/plan`, Response)
  - `warnings.js` (`#/warnings`)
  - `area.js` (`#/area`, My area)
- **Data pipeline:**
  - `tools/build_data.py --city nagpur` and `tools/enrich_buildings.py --city nagpur`.
  - The specs are `tools/spec.py` (Raleigh) and `tools/spec_nagpur.py`.
  - Tiles are in `data/tiles`. `tools/build_dist.py` builds `dist/` (ignored by git) for a strict
    content-security policy.
- **README.md** documents every page, the link parameters, both cities, real vs modeled data and
  replay validation. `git log` explains each step. Read both first.

## How to run and test (Windows, Git Bash)

- Serve with `python -m http.server 8000 --bind 127.0.0.1` from the repo, then open
  http://127.0.0.1:8000/. On Windows this server sometimes refuses a script request and leaves the
  page on its loading screen; reload, or rerun the test.
- Before passing URLs containing `#/…`, set `MSYS_NO_PATHCONV=1`. Otherwise Git Bash rewrites them
  as Windows paths.
- If the repo sits in OneDrive, `git pull` can fail on a locked `.git/FETCH_HEAD`. Use
  `git fetch` then `git merge --ff-only origin/claude/serene-bardeen-sbf0c3`.
- Browser tests need Playwright (`npm i -D playwright`, or point it at system Chrome):
  - `node tools/test/routes.js <url>`: 31 checks.
  - `smoke.js`, `interactions.js`, `phone.js`, `heroes.js`, `perf.js` and `shot.js`. These open
    `#/twin?city=raleigh` when the URL has no hash.
- Node probes:
  - `engine_probe.js`, `analytics_probe.js [--city nagpur]` and `interventions_probe.js`
  - `comms_probe.js` and `plan_probe.js`
- **Engine regression guard:** `sh tools/test/regress.sh <dir>` writes the baselines, and
  `sh tools/test/regress.sh <dir> check` compares against them. Raleigh's engine output must stay
  byte-identical unless I approve an engine change.

## Done so far (all on the branch)

- **Phase 0** (`f413f1f`): honesty labels, the router and shared context, and the twin at
  `#/twin`.
- **Phase 1** (`e97d320`): ported analytics (Cascade-R, crisis registry) and one shared engine per
  scenario.
- **Phase 2** (`7713379`): Nagpur as a full city and the default; the Overview and Crises pages;
  crisis footprints on the twin; the shared population model; per-city dist bundles.
- **`4b6112b` to `4991e4f`:**
  - The permanent six-feature sidebar: Situation, Crises, City twin, Response and Warnings under
    Operations, and My area under Public.
  - Decision deadlines and the ghost-city trajectory in the planner.
  - Response (`#/plan`).
  - Warnings (`#/warnings`): sitrep, CAP alerts per language, SMS segment counts, all marked
    EXERCISE.
  - My area (`#/area`).
  - The comms and plan probes and `regress.sh`.

## What is left

These are not built, per the last commit:

- **Dependencies** page. The twin already has a dependency-graph drawer, so first decide whether a
  page adds anything.
- **Red team** page. It needs the sensor-trust engine change **E4**, which I have not approved.
- **Method** page. The twin already shows replay validation in a drawer.
- **E5** (severity-aware verification), also unapproved.
- The **global search** idea (not the reference's styling).
- Anything else in the reference (`9bc9058`) that 72_UI still lacks.

## Your first task

1. Read the README, `git log`, the code and the reference repo. List what is still missing, and
   mark each item as engine capability or UI only.
2. Propose the remaining phases. For each give its goal, pages or features, the engine products it
   uses, the Nagpur specifics, the tests, and any decision you need from me. Raise E4 and E5 as
   items that need approval; don't schedule them silently. Keep each phase reviewable on its own.
3. Wait for my approval, then build one phase at a time with this loop: build → test both cities
   (`routes.js`, smoke, phone, the probes, `regress.sh check`) → update the README → show me
   screenshots and results → commit only when I say.

Start with steps 1 and 2, and show me the proposed plan.
