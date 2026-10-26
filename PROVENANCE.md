# Where every number comes from

This document exists so that no figure in Cascade Intelligence has to be taken on
trust. For each number the interface shows, it states the exact definition, the file
and function that computes it, the rule or threshold that governs it, what backs that
choice, and where it stops being reliable.

It is written against the code, not from memory. Every constant quoted here appears
verbatim in the source at the path given.

---

## 1. The six rules the whole system obeys

These are invariants, not aspirations. Each is enforced somewhere specific, and each
is testable.

### Rule 1 — Nothing is displayed that was not computed

There is no figure anywhere in the product that was typed in by a person, read from a
fixture, or interpolated for effect. If the engine does not produce it, the interface
does not show it. The Response page carries a section saying so in the product itself,
not only here.

The practical consequence is the absence of things a stakeholder might expect: no
monetary cost or saving, no vehicle or pump counts, no travel times, no crew
locations, no "residents protected". Section 5 explains why each is missing.

### Rule 2 — Issue-time isolation

Every page is a pure function of `(city, scenario, issue time)`. A page rendered at
T+37 uses only evidence that had arrived by T+37, and a time later than the simulated
now is clamped back to it.

```
src/js/site/pages.js   load()  →  k = e.kOf(ctx.t != null ? Math.min(ctx.t, nowT) : nowT)
```

Scrubbing the clock backwards does not reveal a stored answer for that hour — it
rebuilds every product from the evidence available then. This is also the test for
future-data leakage: if the forecast at T+20 were contaminated by what happens at
T+40, moving the clock would not change it, and it does.

### Rule 3 — One state, so no two screens can disagree

There is exactly one engine instance per `city|scenario`, cached LRU 2, shared by
every page.

```
src/js/site/services.js   engine(city, scenario)  ·  planner(e)  ·  recommended(e, k, budget)
```

Situation, Crises, the twin, Response, Warnings and My area all read the same arrays.
A contradiction between two screens is therefore impossible by construction rather
than by discipline.

### Rule 4 — Measurement and inference are never conflated

Three quantities that look alike are kept in separate columns everywhere they appear:

| | What it is |
|---|---|
| **Feed** | what the sensor actually reported — may be stale, biased or absent |
| **Analysis** | what the model infers the true state to be, after assimilation |
| **Trust** | how far the model currently believes that stream, in [0.03, 0.99] |

A trust score of 42% is never rendered as a 42% physical reading. The Crises board
shows these as three columns for exactly this reason.

### Rule 5 — Uncertainty is carried, not asserted

No single-number forecast exists internally. Every risk is the weighted spread of 200
ensemble members, and probability is read from that spread: *"73% chance Ambazari
T-point goes critical"* means **146 of 200 members had it cross** — not a confidence
interval drawn around a point estimate.

### Rule 6 — Simulated data is labelled wherever it appears

Every page carries a `SIMULATION` badge and a provenance line naming the scenario and
its kind. The facilities, streets and rivers are real OpenStreetMap data; every sensor
reading, citizen report and outcome is generated. The one reconstruction in the set
(Nagpur, 23 September 2023) takes only rainfall timing and totals from reported
figures and simulates everything else.

---

## 2. The foundation: what "risk" means

Every facility carries one number in `[0, 1]` at every half-hour step, meaning **how
far this asset is from failing at its own job**. A drainage gauge at 0.8 is near
overtopping; a hospital at 0.8 is near diversion. The scale is normalised per asset by
its own capacity and threshold, set in `tools/spec.py` and `tools/spec_nagpur.py`.

### The four states

```
src/js/core.js   STATES
  NORMAL     0.00 – 0.35
  WATCH      0.35 – 0.55
  HIGH RISK  0.55 – 0.75      HIGH = 0.55
  CRITICAL   0.75 – 1.00      CRIT = 0.75
```

**Why 0.75.** It is the level at which an asset stops delivering its function rather
than merely being stressed — a road impassable to an ambulance, a substation tripping,
a hospital diverting. It is a modelling convention, chosen once and applied uniformly,
not a calibrated physical constant. It is quoted here so that anyone reading a
"CRITICAL" label knows precisely what was asserted.

**Why a single scale across asset classes.** Because the cascade crosses classes. A
threshold expressed in metres of river stage cannot be compared with one expressed in
bed occupancy, and the whole problem is the handoff between them.

### The grid

```
src/js/engine/engine.js
  DT    = 0.5          half-hour steps
  HOURS = 72           forecast horizon
  K     = 145          steps, T+0.0 … T+72.0
  M     = 200          ensemble members
```

---

## 3. Every metric, one by one

### 3.1 Cascade-R

**Shown on:** Crises (headline), sidebar chip.
**Computed in:** `src/js/engine/analytics.js` → `cascadeR(k, kView)`

**Definition.** Stress arriving at facilities through learned dependency links,
divided by stress arriving directly from the hazard, summed across the city and
broken out by system.

```
R = Σ net / Σ haz      where for each facility i:
    net = Σ over inbound edges of  weight × g(upstream risk)
    haz = the hazard forcing on i alone
```

**The rule.** At or above **1**, more stress is circulating through the network than
the hazard is applying directly: the cascade sustains itself and stopping the hazard
no longer stops it. Below 1, it is still a hazard problem.

**What backs it.** The reproduction number from epidemiology — the same question
("is this self-sustaining or externally driven?") applied to infrastructure stress
instead of infection. The threshold at 1 is not tuned; it falls out of the ratio's
definition.

**Where it is honest about itself.** For a *forecast* view (`kView > k`), edge weights
use the learned posterior only where the data supports it (`learned ≥ 0.5`); otherwise
it falls back to the evidence-weighted mean of the members' own weights — which is
what the forecast itself uses. It does not quietly assume a link it has not learned.

**Limit.** It is a city-wide aggregate. A severe local cascade inside a large healthy
city can sit below 1. The per-system breakdown beneath it exists for that reason.

### 3.2 Facility risk, and its band

**Shown on:** everywhere — the twin, inspectors, charts, tables.
**Computed in:** `engine.js` → `now[k·N+i]`, `nowSd[k·N+i]`

The analysis state: the weighted ensemble mean, corrected toward the observation by a
Kalman-style gain whose observation variance is inflated by distrust.

```
so   = SIGMA[kind] / max(0.05, trust)
gain = sd² / (sd² + so²)
x_a  = mean + gain · (observation − mean)
```

**The rule it encodes.** A sensor the model does not believe moves the estimate less.
A distrusted stream does not break the forecast; it stops steering it.

### 3.3 Sensor trust

**Shown on:** Crises evidence panel, twin inspector.
**Computed in:** `engine.js`, per facility per step.

```
res      = |observation − one-step-ahead prediction| / √(SIGMA² + priorSd²)
resid    = 0.85 · resid + 0.15 · res            EWMA
target   = exp(−max(0, resid − 1.6) / 1.1)
if flatline ≥ 4 steps:  target × 0.25
trust    = trust + (target − trust) · 0.25       clamped to [0.03, 0.99]
```

**Three things this does deliberately.**

1. The residual is **normalised by total predictive spread**, not by sensor noise
   alone. A sensor disagreeing with a forecast that is itself uncertain is not evidence
   the sensor has failed.
2. A **flatline detector** runs separately: a reading that does not move while the
   prediction does is the signature of a frozen gauge, and no residual test catches it
   (a stuck value can sit near the truth for hours).
3. Trust moves slowly (gain 0.25) so a single surprising reading does not condemn a
   stream.

**Consequence elsewhere.** A stream below 0.5 trust is forgotten three times faster
(`λ → 0.82` from 0.985), so a frozen gauge stops dominating the posterior.

**What it is tested against.** Each city's dataset injects faults on purpose:

```
geo.faults   nagpur
  DRN-NWH  stuck    T+18 → T+40   "Gauge reading frozen"
  TRF-JRS  dropout  T+28 → T+38   "Camera feed offline"
  WX-ITW   bias     +0.3 from T+30  "Gauge reading high, likely debris in funnel"
```

Plus planted false citizen reports, which the system must not act on.

### 3.4 Probability of crossing, and time to critical

**Shown on:** next-crossings strip, crisis registry, Response crossings panel.
**Computed in:** `engine.js` → `cascade(k)`

For each facility and each level, over all 200 members: the share of members in which
it crosses at all (`prob`), and the **weighted median** crossing time among those that
do (`t`). A facility is listed only if `prob ≥ 0.3`.

**Why the median and not the mean.** Crossing times are strongly right-skewed — a few
members take very long. The median is the hour by which half the plausible futures
have crossed, which is the quantity an operator can plan against.

**Read the two together.** `p = 0.50 at T+43.5` and `p = 1.00 at T+43.5` are very
different situations and the interface shows both numbers side by side.

### 3.5 The crisis registry

**Shown on:** Crises, Situation, Warnings.
**Computed in:** `analytics.js` → `crises(k)`

**Membership rule.** A facility enters the stressed set when it has reached HIGH RISK
and is still stressed, **or** is forecast to cross HIGH RISK within 24 h with
probability ≥ 0.5:

```
live = observed ? now[k·N+i] >= 0.35
                : prob >= 0.5 && (t − k·DT) <= 24
```

**Grouping rule.** Two stressed facilities join the same crisis when a **live learned
link** runs between them — not pruned, posterior mean ≥ 0.06, and carrying flow ≥ 0.02
— or when the forecast carries stress from one into the other. Grouping is union-find
over those edges.

**What this means for the count.** The number of crises is a property of the learned
graph at that issue time, not a fixed partition. The same city at a different hour can
show two crises instead of four because a link has started carrying stress.

### 3.6 Edge status: confirmed, candidate, pruned

**Shown on:** Crises dependency network.
**Computed in:** `engine.js` → `edgePosterior(k, e)`

```
learned = ev / (1 + ev)                 share of the posterior that comes from data
confirmed : mean ≥ 0.08 and mean/sd ≥ 2.5 and learned > 0.5
pruned    : mean < 0.05 and learned > 0.6
candidate : everything else
```

**Why this matters more than any other number here.** A configured dependency graph
has no concept of a pruned edge. The existence of pruned edges is the evidence that the
structure was inferred rather than written down.

**The control.** Each city's edge list contains **seven decoy links carrying a true
weight of zero** — 7 of 71 in Raleigh, 7 of 102 in Nagpur. They are named as plausibly
as the real ones, and they are given the same non-zero starting prior (0.3), so the
learner cannot tell them apart at T+0:

```
raleigh   DRN-WCS → HSP-WMR   "Casualty surge from Walnut Creek"        w = 0
          PWR-NHL → HSP-DRH   "Alternate feed to Duke Raleigh"          w = 0
nagpur    TEL-MNK → HSP-MAY   "Hospital coordination over Mankapur"     w = 0
          TRF-IND → HSP-MAY   "Access to Mayo via Kamptee Rd"           w = 0
```

Stress never actually flows along them. The learner is scored on whether it drives them
to `pruned` — which is a test a configured graph could not be subjected to at all.

### 3.7 Critical facility-hours

**Shown on:** Response (headline metric), the dataset.
**Computed in:** `interventions.js` → `evaluate()`

```
tierW[i]   = 4 − tier          (weather excluded, weight 0)
critHours += tierW[i] · DT     for every step where risk ≥ CRIT
```

Hours spent at or above CRITICAL, summed over facilities, **weighted by importance** so
a trauma centre counts for more than a culvert gauge.

**Why weight at all.** An unweighted count makes twenty flooded gauges look worse than
one diverting hospital, which inverts the thing that matters.

**Limit.** The tier is assigned in the city spec by hand. It is a judgement about what
matters, not a measurement, and a city adopting this would want to set it themselves.

### 3.8 Hospital & EMS critical hours, and P(a hospital goes critical)

Same loop, narrower set: `careHours` counts only hospital and EMS facilities, unweighted.
`hospCrit` is the probability, over members, that **any** hospital reaches CRITICAL.

**Why both.** Facility-hours measure how much and how long; the probability measures
whether it happens at all. A plan can cut hours substantially while barely moving the
probability, and an operator should see that.

### 3.9 Reduction percentage

```
reduction = 1 − withPlan.critHours / baseline.critHours
```

**The crucial property: it is a difference between two simulations, not a rating.** The
plan is re-simulated from the decision step forward on the 32 ensemble members whose
history best matches the evidence so far; the city is run twice, once doing nothing and
once with the plan, and the two are differenced.

An effectiveness rating assumes an action works the same in every event. Re-simulation
asks what it does to *this* event — which is why the same action scores differently in
the cloudburst and the dam release.

### 3.10 Side effects

```
worse = facilities where withPlan.peak − baseline.peak > 0.03
```

**The rule.** Any facility whose expected peak rises by more than **3 points** because
of the plan is reported, top five by magnitude.

**Why it exists.** A road closure that keeps one corridor dry loads the next one. If
the system only reported benefits it would be an advocacy tool. The threshold is low on
purpose: 3 points is below what an operator would notice by eye.

### 3.11 Cascade broken

```
cascadeBroken = baseline.hospCrit > 0.4 && withPlan.hospCrit < 0.3
```

A deliberately conservative claim: it is only asserted when the probability of *any*
hospital going critical falls from likely to unlikely. It is a label, and it is defined
here so nobody has to guess what it means.

### 3.12 The recommended plan

**Computed in:** `interventions.js` → `search(k, budget)`

Greedy by **marginal reduction in expected critical facility-hours per crew**:

```
repeat:
  for each affordable unchosen action:
     gain = (current critHours − critHours with it added) / action cost
  take the best if gain > 0.05, else stop
```

**Two honest properties.** Greedy is not optimal — it can miss a pair of actions that
only help together. And the `gain > 0.05` floor means the planner **stops rather than
spending crews on something negligible**, which is why some scenarios return a plan
costing less than the budget, and two return nothing worth doing at all.

### 3.13 The decision deadline — "act by"

**Shown on:** Response (the headline output).
**Computed in:** `interventions.js` → `deadline(k, ids, maxH = 24, stepH = 2)`

The same plan is re-evaluated with the crews starting 0, 2, 4 … 24 h later, **deciding
on the same information** — only the response is delayed, never the knowledge.

```
r0    = benefit if started now
actBy = the last start time that still keeps ≥ 80% of r0
half  = the first start time worth < 50% of r0
```

**Why 80%.** A round, defensible line for "materially as good as acting now". It is a
stated convention, not a derived optimum, and the whole decay curve is drawn beside it
so an operator can pick a different line by eye.

**The one caveat the page states itself.** The deadline runs on 16 members per start
time where the headline tiles use 32, so the two reductions differ by a point or two.
The Response page says this in the product.

### 3.14 Hours the plan buys on a crossing

**Shown on:** Response, forecast crossings panel.

```
tBase = first hour the do-nothing trajectory reaches CRIT
tPlan = first hour the with-plan trajectory reaches CRIT
bought = tPlan − tBase        reported only if > 0.4 h
"kept below CRITICAL"         only when tBase exists and tPlan does not
```

**Why both trajectories.** Reading the plan's trajectory alone credits the plan for
facilities whose expected risk never reached CRITICAL anyway. On Raleigh that was three
rows out of four before it was fixed. The probe `tools/test/response_probe.js`
re-derives this from the engine independently and fails if any "kept below CRITICAL"
mark is not one the baseline future actually needed.

### 3.15 CAP alert grading

**Computed in:** `comms.js` → `grade(c, tIssue)` — derived from the registry, never
written by hand.

```
severity   Extreme  if nCrit ≥ 3 or people > 250,000
           Severe   if nCrit ≥ 1 or next crossing prob ≥ 0.6
           Moderate otherwise
urgency    Immediate if (observed and maxR ≥ 0.75) or eta ≤ 6 h
           Expected  if eta ≤ 24 h or observed
           Future    otherwise
certainty  Observed if observed · Likely if prob ≥ 0.6 · Possible otherwise
```

The alert polygon **is** the crisis footprint object, so the area warned and the area
analysed cannot drift apart.

### 3.16 SMS segment counts

```
comms.js → segments(text)
GSM-7  : 1 segment ≤ 160 chars, then ⌈n / 153⌉
UCS-2  : 1 segment ≤ 70 chars,  then ⌈n / 67⌉
```

**What backs it.** GSM 03.38, the actual encoding the carrier bills on. Devanagari
forces UCS-2, so the same warning costs three segments in Hindi or Marathi and one in
English — and the half that gets truncated on a feature phone is the half that says
what to do.

### 3.17 Residents in a footprint

**Computed in:** `src/js/engine/population.js`

A modelled residential grid for the city, with each cell tied to its nearest exposed
facility within **1.5 km**, influence falling off with a 900 m decay. The crisis
registry counts the cells inside a crisis footprint; the twin's population massing
takes its colour from the same model, so the two pages cannot disagree.

**Honest status.** This is a **modelled distribution, not a census count of the people
actually inside the polygon at that hour.** It has no diurnal movement — the daytime
population of a business district and its night population are the same number here. It
feeds CAP severity grading, where it sets the Extreme threshold at 250,000. It is the
weakest number in the system and is labelled as modelled wherever it appears.

---

## 4. The mechanisms behind the numbers

### 4.1 Only excess stress propagates

```
engine.js   gThr(r, thr) = r > thr ? ((r − thr) / (1 − thr))^1.15 : 0
```

An asset operating inside its design limit passes **nothing** downstream. A substation
at 60% does not endanger a hospital; the same substation at 94% does. The exponent 1.15
makes propagation mildly convex — stress accelerates near failure.

### 4.2 Localised particle filter with forgetting

```
LAMBDA    = 0.985     ≈ 23 h of memory
ESS_FLOOR = 0.12      keep at least 12% of members effective
λ → 0.82              for any stream whose trust < 0.5
```

**Localisation.** Weights are per facility: being wrong about a pump in the north does
not discredit a member's view of a hospital in the south. Without it, one bad gauge
discredits otherwise-correct futures city-wide and the forecast collapses.

**Forgetting.** Without decay the filter locks onto the start of the event. With it,
the posterior tracks a situation that is itself changing — the "concept drift" the
problem statement asks for.

**Tempering.** If fewer than 12% of members carry real weight, the update is softened.
This is what prevents the ensemble collapsing onto one confident future.

### 4.3 Dependency learning

Sparse Bayesian learning with **automatic relevance determination**: zero-mean priors
with a per-edge precision re-estimated by EM, so an edge the data stops supporting
decays toward zero rather than sitting there as a configured constant.

### 4.4 Observation noise is not uniform

```
SIGMA   weather 0.06 · drainage 0.04 · pump 0.05 · traffic 0.07
        power 0.035 · telecom 0.04 · ems 0.035 · hospital 0.02
```

Administrative feeds (bed census, CAD, SCADA) are precise. Camera-derived traffic is
the noisiest thing in the system. Treating them as equally reliable would be the single
easiest way to get a cascade forecast wrong.

---

## 5. What is deliberately not computed

Each of these is absent because the model does not produce it, and inventing it would
make the output look more certain than it is.

| Not shown | Why |
|---|---|
| Monetary cost or saving | No cost model exists. A rupee figure would be a guess with two decimal places. |
| Vehicle, pump or crew counts | The model's only resource unit is an abstract "crew". It has no fleet inventory. |
| Travel time, crew locations | No routing engine, no AVL feed. |
| Residents protected | Requires an exposure-to-harm model the system does not have. |
| Per-intervention timelines | The planner evaluates outcomes, not deployment schedules. |
| Casualty or damage estimates | No vulnerability model. |

A crew is labelled in the product as "the model's only resource constraint — an
abstract unit of capacity, not a named team, vehicle or cost."

---

## 6. Provenance: real, simulated, precomputed

| Layer | Status | Source |
|---|---|---|
| Facilities, streets, rivers, building footprints | **Real** | OpenStreetMap, both cities |
| Ward population, catchments | **Real, static** | census / OSM, updated seasonally |
| Today's rainfall forecast (My area only) | **Real, live** | Open-Meteo GFS ensemble |
| Chronos-Bolt second opinion | **Real model, precomputed offline** | `amazon/chronos-bolt-small` |
| Every sensor reading, citizen report, outcome | **Simulated** | `scenarios.js`, `scenarios_natural.js` |
| Rainfall timing and totals, Nagpur 23 Sep 2023 only | **Reported figures** | IMD-reported, remainder simulated |

---

## 7. How the claims are tested

Assertions in this document are backed by executable checks, not by review.

| Check | What it establishes |
|---|---|
| `tools/test/regress.sh` | Six engine baselines byte-identical. Any UI or scenario work that moved a forecast fails here. |
| `tools/test/scenario_matrix.js` | All 31 city × scenario runs produce distinguishable dashboards; fails if any two match. |
| `tools/test/response_probe.js` | 20 checks, including that every "kept below CRITICAL" mark is one the baseline future needed — re-derived from the engine, not from the view. |
| `tools/test/board_probe.js` | 14 checks on the Crises board, including that timeline labels never overlap. |
| `tools/test/routes.js` | 25 checks on routing, shared context and issue-time isolation. |
| `tools/test/comms_probe.js` | CAP validity and SMS segment counts per language. |
| Replay mode | Re-runs the full 72 h with the future locked away; scores lead time, probability of detection, false-alarm ratio, calibration. |
| `second.js` vs Chronos-Bolt | A pretrained foundation model scored on identical issue times and facilities, as a control. |

---

## 8. Known limits, stated rather than discovered

1. **The ensemble is over-dispersed.** Its 80% band contains the truth 92–93% of the
   time. Too humble rather than overconfident — the safer failure, but a calibration
   error nonetheless.
2. **The simulated truth and the ensemble share a model family**, so structural model
   error is zero by construction. A real deployment would face model error this test
   cannot show. This is the most important caveat in the document.
3. **The dependency prior is centred near the truth.** A real edge starts with its
   prior upper bound at twice its true weight (`hi = 2·w`), so the learner begins in the
   right neighbourhood. Reality offers no such head start. The seven decoys per city are
   the partial answer to this — they start with the same prior and must be pruned on
   evidence alone — but the real edges are easier to learn here than they would be in
   the field.
4. **Raleigh's city model contains no telecom facilities**, so no Raleigh scenario can
   show a telecom failure. A gap in harvested data, not in the model.
5. **The intervention catalogue has nothing that materially helps a heat dome or a
   snowstorm** — both report a reduction near zero. Honest output, thin page.
6. **Memory ceiling** of roughly 200–300 facilities before the browser ensemble gets
   heavy.
7. **No live ingestion, no persistence, no audit trail, no multi-user state.** The
   modelling is real and validated; the data plumbing is not built.

---

## 9. One worked example, end to end

Nagpur, monsoon reconstruction, forecast issued at **T+37.0 h**.

| Step | Figure | Where it comes from |
|---|---|---|
| Hazard observed | >100 mm overnight on the Ambazari catchment | scenario driver, reconstruction timing |
| Drainage crosses | Ambazari spillway **T+42.5**, p = 1.00 | `cascade(k)` — median over 200 members |
| Next in chain | Nag River at Ambazari Rd **T+43.0**, p = 0.97 | learned edge, not a configured one |
| Roads | Jhansi Rani Square **T+43.5**, p = 0.97 | |
| EMS | 112 Control Room **T+43.0**, p = 0.92 | |
| Hospital | Care Hospital **T+44.5** | |
| **Lead time** | **7.5 h** | T+44.5 crossing, issued T+37.0 |
| Cascade-R | below 1 | still hazard-driven, not yet self-sustaining |
| Plan | 4 actions, 5 crews | greedy, marginal benefit per crew |
| Benefit | −16% critical facility-hours, −48% hospital & EMS hours | two simulations differenced, 32 members |
| **Deadline** | **start by T+47.0 to keep 80%**; worth < half by T+55.0 | plan re-run at later start times, same information |

Every asset in that chain is **inside its own threshold at T+37**. The drainage desk
sees a full lake, the discom sees a healthy yard, the hospital sees normal access. The
chain is only visible across all three — which is the entire argument for the system.

---

*Figures in this document are quoted from the source at the paths given. If the code
changes, this document is wrong until it is updated; it is not generated automatically.*
