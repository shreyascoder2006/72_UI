# Figure sources

The four architecture and flow diagrams, drawn as HTML in the prototype's own
design tokens (`src/css/tokens.css`) so the figures and the product read as one
thing, then screenshotted at 2× with Playwright.

    cd tools/diagrams
    node snap.js d1 d2 d3 d4        # writes d1.png … d4.png at 3600 px wide

| File | Figure |
|---|---|
| `d1.html` | System architecture — what runs where |
| `d2.html` | Data flow — from a sensor in the street to a decision deadline |
| `d3.html` | User flow — three roles, one shared state |
| `d4.html` | Inside the engine — how one cascade is forecast and broken |

Fonts: Barlow and IBM Plex Mono, installed system-wide for the render. Without
them the layout holds but the typography falls back.

    # from the Google Fonts CSS API, then install to ~/.fonts and run fc-cache -f

Every constant, path and figure in the diagrams is taken from the code — the
engine's `M`, `K`, `DT`, `LAMBDA` and `ESS_FLOOR`, the per-kind observation
noise, the injected fault taxonomy in each city's `geo.faults`, and the T+37
cascade trace from `e.cascade(k)` on nagpur/monsoon2023. Change the code and
these need regenerating; nothing here reads the code automatically.

The rendered PNGs are not tracked (see `.gitignore`) — they are reproducible
from these sources. Delivered copies live in `diagrams/`.
