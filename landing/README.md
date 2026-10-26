# Horizon 72 — landing page

A one-scroll marketing page for the Horizon 72 twin: the problem, the two-engine
approach, an interactive scrollytelling walkthrough of the pipeline, the two cities,
the replay-validated numbers, and a roadmap. React 19 + Vite + Tailwind 4 + Framer
Motion, kept separate from the twin itself (`../src`), which is plain JS with no
build step.

Adapted from the landing page in
[shreyascoder2006/Sankalp_Base](https://github.com/shreyascoder2006/Sankalp_Base)
(`apps/landing`, package name `monsoon`) — the original was a freight-logistics
pitch for a different hackathon project; every section's copy and data has been
rewritten for Horizon 72, keeping the original's visual system, animations and
scroll-driven interaction.

## Run it

```bash
npm install
npm run dev
```

Opens on Vite's dev server (prints the port; defaults to 5173, pinned to 5180 when
launched from the main project's `.claude/launch.json`). The **Open the twin**
buttons link to `VITE_TWIN_URL`, which defaults to `http://localhost:8000` — the
twin's own dev server (`python ../tools/serve.py`). Set `VITE_TWIN_URL` in a
`.env.local` file to point elsewhere.

## Content rules

Same as the rest of the project: no fabricated numbers. Every stat in `Problem.tsx`
and `Impact.tsx` either cites a public source (government/IMD reporting on real
events) or is the twin's own replay-validated result from `README.md` at the
project root. The footer disclaimer and the `src-note` under the problem stats say
so explicitly.
