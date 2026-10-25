# Raleigh Digital Twin · Cascade Intelligence

An urban digital twin of Raleigh, North Carolina, with a crisis-cascade layer that predicts how a
storm propagates through drainage, roads, power, emergency response and hospitals up to 72 hours
ahead. The city model is real: OpenStreetMap buildings, streets, creeks and facilities rendered
in 3D. The cascade intelligence is one analytical layer on top of it, the way production CIM and
digital-twin platforms are structured.

![City overview at T+34.5 h](docs/overview.png)

| Facility inspector | Inferred dependency graph |
| --- | --- |
| ![Inspector](docs/inspector.png) | ![Dependency graph](docs/dependency-graph.png) |

## Run it

```bash
python3 -m http.server 8000      # from the repository root
# open http://localhost:8000
```

Any static file server works. Opening `index.html` straight from disk (`file://`) also works, but
browsers block local `fetch` there, so the map falls back to live OpenFreeMap tiles.

`python3 tools/build_dist.py` produces `dist/index.html`, a single page with all CSS and JavaScript
inlined, plus `dist/data/bundles/`: the tiles and glyphs packed as base64 JSON for hosts that only
serve text and web media types. It runs under a strict Content-Security-Policy (`connect-src
'self'`, scripts only from cdnjs) and is what the published artifact is built from.

### Renderer: Mapbox GL JS or MapLibre GL JS

The map code is written against the Mapbox GL JS API (`Map`, `Marker`, `fill-extrusion`, `flyTo`,
`addSource`/`addLayer`, canvas sources).

- **Mapbox GL JS v3:** set `mapboxToken` in `config.js` to a Mapbox public token. The twin then
  loads Mapbox GL JS v3, restyles `dark-v11` and extrudes buildings from Mapbox Streets. This path
  could not be tested here because no token was available. If the token is rejected, the app falls
  back to MapLibre automatically.
- **MapLibre GL JS 4.7 (default):** the open-source continuation of Mapbox GL JS with the same
  API. It renders the OpenStreetMap vector tiles shipped in `data/tiles` through a `twin://`
  protocol, so the twin works offline and inside sandboxed frames that block third-party requests.

## What is real and what is modeled

| Real (OpenStreetMap, ODbL) | Modeled for the simulation |
| --- | --- |
| Buildings with heights, streets, creeks, ponds, parks: 170 vector tiles, z10–14 | Storm scenarios and the hidden "ground truth" run |
| Hospitals (WakeMed Raleigh, 628 beds; Duke Raleigh, 186; WakeMed North, 61; UNC Rex) | Risk indices, capacities, sensor IDs and readings |
| 31 Duke Energy substations with OSM voltages; their Voronoi service areas | Dependency weights in the ground-truth run |
| Wake County EMS stations, the Lake Boone pumping station | Injected sensor faults and false citizen reports |
| Gauges at exact creek × road crossings (e.g. Crabtree Creek at Glenwood Ave) | UNC Rex bed count (not tagged in OSM) |
| Every dependency route: Dijkstra on the real street graph or down the real waterway graph | Rain gauge sites |

## How the intelligence layer meets the brief

| Requirement | Implementation |
| --- | --- |
| **Multi-horizon forecasting** | 200-member ensemble. Each facility gets P(critical) and a fan chart at +1/6/12/24/48 h, plus time-to-critical with p10–p90. Forecasts are perturbation forecasts anchored to the current analysis. |
| **Dependency discovery** | No structure is given. 71 candidate links (7 deliberately spurious) are learned online by sparse Bayesian regression (ARD) on the sensor streams, then confirmed, pruned or left as awaiting evidence. By T+72 h on the tropical storm: 32 confirmed, 12 pruned. A separate raw-stream screen (lagged correlation, weather partialled out by distributed-lag regression) checks the structure at system level. |
| **Cascade prediction** | Lagged propagation with feedback loops: hospital → EMS → hospital, diversion between hospitals, load transfer between substations. The timeline, cascade strip and graph show the stage-by-stage sequence, observed and forecast, numbered in propagation order. |
| **Online learning under drift** | A localized particle filter with forgetting (about a 23 h memory) and adaptive tempering keeps the effective sample size at or above 12%. Recursive estimators update every 30 minutes without retraining. "Trigger cascade" replays the streams from T+0 so you can watch this happen. |
| **Uncertainty and adversity** | Sensor trust comes from spread-normalized residuals and flatline detection. Suspect channels are quarantined, meaning their past evidence is forgotten quickly. In the tropical run the frozen gauge, offline camera and biased rain gauge are flagged with no false flags. Planted false citizen reports score 12–16% corroboration; genuine ones score 84–96%. |
| **Causal explainability** | Every risk value decomposes into baseline, hazard and each upstream link (posterior weight ± sd, lag, mechanism, upstream sensor reading and trust). The strongest chain back to the hazard is shown, e.g. Rainfall → Pigeon House Branch → Capital Blvd → EMS Station 2 → WakeMed. |
| **Constrained counterfactuals** | 7 actions with crew costs and side effects (an evacuation loads I-440; a detour loads Wake Forest Rd). They are re-simulated from the decision time on the most probable members, and a greedy planner chooses within the budget. At T+34.5 h with 5 crews it picks pumps, EMS staging and an early Capital Blvd closure: −13% critical facility-hours, −30% hospital/EMS critical hours. |
| **Generalization** | Three scenarios with different hazards and cascade shapes run through the same engine without retuning: tropical rainfall, a convective flash flood, and a heat wave with a derecho. The learned structure changes with them. |
| **Temporal validation** | Historical mode replays the window. Every forecast uses only data up to its time stamp and is scored against the hidden truth. |

Replay validation (24 h warning rule: P(critical within 24 h) ≥ 60%):

| Scenario | Brier | Skill vs climatology | Detection | False alarms | Median lead |
| --- | --- | --- | --- | --- | --- |
| Tropical remnant rainfall | 0.076 | +0.59 | 82% | 25% | 19.0 h |
| Convective flash flood | 0.070 | +0.63 | 77% | 5% | 16.5 h |
| Heat wave and grid stress | 0.019 | +0.81 | 77% | 0% | 23.0 h |

These numbers come from a synthetic ground truth generated by the same family of models. They
show that the pipeline works end to end and is honestly isolated from future data. They are not
evidence of real-world skill.

## Layout

```
index.html, config.js      page shell and runtime configuration
src/css/                   tokens, layout, panels, map chrome
src/js/core.js             risk vocabulary, seeded RNG, geo helpers
src/js/engine/             scenarios, ensemble + assimilation + learning, interventions
src/js/map/                basemap style, layers, hex markers, radar, renderer bootstrap
src/js/ui/                 sidebar, inspector, timeline, drawers, sensor feed, app orchestrator
src/js/data/geodata.js     generated: facilities, routes, networks (from OSM)
data/tiles, data/fonts     baked OpenMapTiles vector tiles and label glyphs
tools/                     data pipeline (MVT decoder, spec, builders) and tests
```

### Data pipeline

```bash
python3 tools/fetch_tiles.py data/tiles   # OpenFreeMap tiles for the extent (already committed)
python3 tools/build_data.py               # decode tiles → src/js/data/geodata.js
```

`tools/spec.py` is the authored knowledge base: which facilities are monitored and which links
engineers consider possible. `tools/mvt.py` is a dependency-free vector-tile decoder.
`build_data.py` places gauges at exact creek × road crossings, routes links on the street and
waterway graphs, chunks the corridor and drainage networks, and computes the substation service
areas.

### Tests

```bash
node tools/test/engine_probe.js tropical          # engine timeline, learning, validation
node tools/test/interventions_probe.js            # counterfactual planner
node tools/test/smoke.js http://localhost:8000/ out/   # headless browser run (Playwright)
python3 tools/test/csp_server.py 8766             # serve dist/ under a strict CSP
```

## Attribution

Map data © OpenStreetMap contributors (ODbL) · tiles © OpenMapTiles, served by OpenFreeMap ·
rendering by MapLibre GL JS (BSD-3).
