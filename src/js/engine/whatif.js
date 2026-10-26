/* What-if knowledge graphs: how one event at one place could cascade through the city.

   A fixed knowledge base: for each kind of event, the effects it can set off across
   city systems, how they connect, when each tends to begin and how likely it is at each
   severity band. A request (place, event, magnitude) picks the band from the magnitude,
   keeps the effects that band reaches, scales their timing and likelihood, and attaches
   each effect to the real facilities nearest the place (from the city's OpenStreetMap
   data). The result is a graph of effects with times, likelihoods, causes and sites.

   This is structured scenario reasoning from templates, not a forecast: the 72-hour
   engine models its own scenarios (rain, heat, grid faults, chlorine, crowds) from
   simulated sensor streams; earthquakes and outbreaks are not in it. Band thresholds
   follow published scales where they exist (IMD rainfall and heat-wave categories,
   USGS magnitude classes); the others are this tool's own and say so. */
(function (root) {
  const C = root.TWIN.core;
  const BAND = ['Moderate', 'Severe', 'Very severe', 'Extreme'];
  const LIKELY = (p) => (p >= 0.85 ? 'almost certain' : p >= 0.65 ? 'likely' : p >= 0.4 ? 'possible' : 'unlikely');

  // Systems: label and colour used by the graph.
  const SYSTEMS = {
    hazard: { label: 'Hazard', col: '#79a7e3' }, water: { label: 'Drainage & water', col: '#4a95dc' },
    roads: { label: 'Roads & transport', col: '#3fb27f' }, power: { label: 'Power', col: '#b39af0' },
    telecom: { label: 'Telecom', col: '#5fc8d6' }, ems: { label: 'Ambulance & rescue', col: '#ee8a2a' },
    health: { label: 'Hospitals & health', col: '#e5484d' }, buildings: { label: 'Buildings', col: '#a2abb6' },
    education: { label: 'Schools', col: '#e2b93b' }, supply: { label: 'Food, fuel & medicine', col: '#c99a6a' },
    people: { label: 'People', col: '#e4e8ee' },
  };
  const STAGES = ['Trigger', 'First effects', 'Knock-on', 'Wider disruption', 'People & society'];

  // Node: id, label, sys, stage, p (likelihood at bands 0-3; 0 = not reached), t (onset,
  // hours after the event, at band 0; faster as severity grows), asset (real sites to
  // attach), desc, act (what helps). Edge: [from, to, how].
  const KB = {
    rain: {
      label: 'Heavy rainfall', unit: 'mm in 24 h', min: 10, max: 400, step: 5, def: 115,
      bands: [64.5, 115.6, 204.5], scale: 'IMD 24-hour rainfall categories: heavy 64.5–115.5 mm, very heavy 115.6–204.4 mm, extremely heavy 204.5 mm or more',
      bandNames: ['Moderate to heavy rain', 'Heavy rain', 'Very heavy rain', 'Extremely heavy rain'],
      nodes: [
        { id: 'rain', label: 'Rain over the area', sys: 'hazard', stage: 0, p: [1, 1, 1, 1], t: 0, desc: 'Rain falls faster than the ground can absorb it.' },
        { id: 'drains', label: 'Storm drains and channels overflow', sys: 'water', stage: 1, p: [0.35, 0.7, 0.9, 0.98], t: 1.5, asset: 'drainage', desc: 'Channels reach capacity; water backs up into streets.', act: 'Clear drain mouths and culverts before the peak; stage pumps.' },
        { id: 'lowflood', label: 'Low-lying streets and underpasses flood', sys: 'roads', stage: 2, p: [0.3, 0.65, 0.9, 0.97], t: 2.5, asset: 'traffic', desc: 'Underpasses and dips fill first and become impassable.', act: 'Close underpasses early; signpost detours.' },
        { id: 'river', label: 'River or lake overtops its banks', sys: 'water', stage: 1, p: [0, 0.4, 0.75, 0.95], t: 5, asset: 'drainage', desc: 'Upstream run-off arrives hours after the rain peak.', act: 'Watch spillway and river gauges; pre-position boats.' },
        { id: 'traffic', label: 'Gridlock on main corridors', sys: 'roads', stage: 2, p: [0.4, 0.7, 0.9, 0.95], t: 3, asset: 'traffic', desc: 'Flooded links push traffic onto fewer roads.', act: 'Stagger office closures; keep one corridor clear for ambulances.' },
        { id: 'substation', label: 'Substations trip or are switched off for safety', sys: 'power', stage: 2, p: [0, 0.3, 0.6, 0.85], t: 4, asset: 'power', desc: 'Water in yards and cable trenches forces shutdowns.', act: 'Barrier low substations; pre-arrange feeder switching.' },
        { id: 'blackout', label: 'Power cuts in affected wards', sys: 'power', stage: 3, p: [0, 0.25, 0.55, 0.8], t: 5, desc: 'Homes, pumps and signals lose supply.', act: 'Charge phones and medical devices ahead.' },
        { id: 'towers', label: 'Mobile sites run down batteries', sys: 'telecom', stage: 3, p: [0, 0.2, 0.5, 0.75], t: 8, asset: 'telecom', desc: 'Sites without grid power fail after their battery hold-up.', act: 'Fuel generators at key sites; publish SMS-only updates.' },
        { id: 'ems', label: 'Ambulances slowed or rerouted', sys: 'ems', stage: 3, p: [0.3, 0.6, 0.85, 0.95], t: 3.5, asset: 'ems', desc: 'Response times grow as routes flood and jam.', act: 'Pre-stage ambulances on the dry side of crossings.' },
        { id: 'hospital', label: 'Hospital emergency departments under pressure', sys: 'health', stage: 3, p: [0.15, 0.45, 0.75, 0.9], t: 6, asset: 'hospital', desc: 'Injuries and delayed transfers arrive together; some staff cannot reach work.', act: 'Activate surge plans; check generator fuel.' },
        { id: 'schools', label: 'Schools close or are cut off', sys: 'education', stage: 4, p: [0.2, 0.55, 0.85, 0.95], t: 6, asset: 'school', desc: 'Access roads flood; some schools become shelters.', act: 'Announce closures early; open designated schools as shelters.' },
        { id: 'water', label: 'Drinking water contaminated', sys: 'water', stage: 4, p: [0, 0.2, 0.45, 0.7], t: 24, desc: 'Sewage mixes with supply lines in flooded areas.', act: 'Advise boiling water; chlorinate supply.' },
        { id: 'disease', label: 'Water-borne illness rises', sys: 'health', stage: 4, p: [0, 0.15, 0.35, 0.6], t: 72, desc: 'Diarrhoeal and vector-borne cases follow days later.', act: 'Stock ORS; run fogging and surveillance.' },
        { id: 'displaced', label: 'Families displaced to shelters', sys: 'people', stage: 4, p: [0, 0.3, 0.65, 0.9], t: 6, desc: 'Ground-floor homes flood in low wards.', act: 'Open shelters with food, water and medical cover.' },
      ],
      edges: [['rain', 'drains', 'run-off exceeds drain capacity'], ['drains', 'lowflood', 'backed-up water spills onto roads'], ['rain', 'river', 'catchment run-off'], ['river', 'lowflood', 'overbank flow'],
        ['lowflood', 'traffic', 'links close'], ['drains', 'substation', 'water in yards and trenches'], ['river', 'substation', 'floodplain substations'], ['substation', 'blackout', 'feeders lose supply'],
        ['blackout', 'towers', 'grid power lost'], ['traffic', 'ems', 'slower routes'], ['lowflood', 'ems', 'crossings impassable'], ['ems', 'hospital', 'late and clustered arrivals'],
        ['blackout', 'hospital', 'on generator power'], ['lowflood', 'schools', 'access cut'], ['lowflood', 'displaced', 'homes flooded'], ['river', 'displaced', 'riverside homes flooded'],
        ['drains', 'water', 'sewage enters supply'], ['water', 'disease', 'contaminated water'], ['displaced', 'disease', 'crowded shelters'], ['towers', 'ems', 'calls fail to connect']],
    },
    quake: {
      label: 'Earthquake', unit: 'magnitude (Richter / moment)', min: 3, max: 8.5, step: 0.1, def: 6.2,
      bands: [5, 6, 7], scale: 'USGS magnitude classes: light 4–4.9, moderate 5–5.9, strong 6–6.9, major 7 or more',
      bandNames: ['Light earthquake', 'Moderate earthquake', 'Strong earthquake', 'Major earthquake'],
      nodes: [
        { id: 'shake', label: 'Ground shaking', sys: 'hazard', stage: 0, p: [1, 1, 1, 1], t: 0, desc: 'Strongest near the epicentre and on soft soils.' },
        { id: 'damage', label: 'Older and unreinforced buildings damaged', sys: 'buildings', stage: 1, p: [0.2, 0.55, 0.85, 0.97], t: 0, desc: 'Masonry and soft-storey buildings crack or collapse.', act: 'Rapid visual screening; keep people out of damaged buildings.' },
        { id: 'trapped', label: 'People trapped in collapsed structures', sys: 'people', stage: 2, p: [0, 0.25, 0.6, 0.9], t: 0.2, desc: 'Search and rescue is time-critical in the first 72 h.', act: 'Deploy USAR teams; map collapses from calls and reports.' },
        { id: 'power', label: 'Substations and lines trip', sys: 'power', stage: 1, p: [0.15, 0.45, 0.8, 0.95], t: 0, asset: 'power', desc: 'Protection systems trip; equipment can be damaged.', act: 'Isolate damaged feeders; restore hospitals first.' },
        { id: 'gas', label: 'Gas leaks and fires', sys: 'buildings', stage: 2, p: [0, 0.2, 0.5, 0.8], t: 0.5, desc: 'Broken pipes and wiring start fires.', act: 'Shut off gas at the main; fire crews to dense areas.' },
        { id: 'roads', label: 'Roads blocked by debris; bridges closed for checks', sys: 'roads', stage: 2, p: [0.1, 0.4, 0.75, 0.95], t: 0.5, asset: 'traffic', desc: 'Debris and inspections cut routes.', act: 'Clear priority corridors to hospitals first.' },
        { id: 'telecom', label: 'Mobile networks congested or down', sys: 'telecom', stage: 2, p: [0.4, 0.7, 0.9, 0.95], t: 0.1, asset: 'telecom', desc: 'Call volume spikes; some sites lose power.', act: 'Ask people to text, not call; restore backbone sites.' },
        { id: 'ems', label: 'Ambulance demand exceeds capacity', sys: 'ems', stage: 3, p: [0.1, 0.45, 0.8, 0.97], t: 0.5, asset: 'ems', desc: 'Many injuries at once on blocked roads.', act: 'Set up casualty collection points; triage on site.' },
        { id: 'hospital', label: 'Hospitals flooded with injured; some damaged', sys: 'health', stage: 3, p: [0.1, 0.4, 0.8, 0.95], t: 1, asset: 'hospital', desc: 'Trauma surge while buildings are checked for safety.', act: 'Activate mass-casualty plans; field hospitals if wards are unsafe.' },
        { id: 'water', label: 'Water mains break', sys: 'water', stage: 2, p: [0.05, 0.3, 0.65, 0.9], t: 0.5, desc: 'Pipes fracture; pressure drops; firefighting water falls.', act: 'Isolate breaks; tanker supply to hospitals and shelters.' },
        { id: 'schools', label: 'Schools closed for structural checks', sys: 'education', stage: 4, p: [0.3, 0.7, 0.95, 1], t: 2, asset: 'school', desc: 'Buildings must be inspected before reopening.', act: 'Prioritise school inspections; use safe ones as shelters.' },
        { id: 'aftershock', label: 'Aftershocks hamper rescue and repair', sys: 'hazard', stage: 2, p: [0.3, 0.5, 0.7, 0.85], t: 1, desc: 'Further damage to weakened structures.', act: 'Keep people out of damaged buildings.' },
        { id: 'displaced', label: 'People sleep outdoors or in shelters', sys: 'people', stage: 4, p: [0.1, 0.4, 0.8, 0.95], t: 3, desc: 'Fear of aftershocks and unsafe homes.', act: 'Open shelters in open grounds; provide water and sanitation.' },
        { id: 'supply', label: 'Food, fuel and medicine supply disrupted', sys: 'supply', stage: 4, p: [0, 0.2, 0.55, 0.85], t: 12, asset: 'pharmacy', desc: 'Roads, power and shops are affected.', act: 'Set up distribution points; secure medicine stocks.' },
      ],
      edges: [['shake', 'damage', 'structural failure'], ['damage', 'trapped', 'collapse'], ['shake', 'power', 'equipment trips'], ['damage', 'gas', 'broken pipes and wiring'], ['damage', 'roads', 'debris'],
        ['shake', 'telecom', 'call surge'], ['power', 'telecom', 'sites lose power'], ['trapped', 'ems', 'rescue and transport demand'], ['roads', 'ems', 'blocked routes'], ['ems', 'hospital', 'mass casualties'],
        ['power', 'hospital', 'on generators'], ['shake', 'water', 'pipe fractures'], ['water', 'gas', 'less firefighting water'], ['damage', 'schools', 'inspections'], ['shake', 'aftershock', 'sequence continues'],
        ['aftershock', 'damage', 'further damage'], ['damage', 'displaced', 'unsafe homes'], ['roads', 'supply', 'deliveries stop'], ['power', 'supply', 'shops and pumps without power'], ['telecom', 'ems', 'calls fail']],
    },
    outbreak: {
      label: 'Infectious outbreak in a hospital', unit: 'confirmed cases (e.g. pneumonic plague)', min: 1, max: 500, step: 1, def: 12,
      bands: [5, 20, 100], scale: 'This tool’s own bands: a cluster under 5 cases, 5–19 an outbreak, 20–99 a large outbreak, 100 or more an epidemic',
      bandNames: ['Case cluster', 'Hospital outbreak', 'Large outbreak', 'Epidemic'],
      nodes: [
        { id: 'cases', label: 'Confirmed cases in the hospital', sys: 'hazard', stage: 0, p: [1, 1, 1, 1], t: 0, asset: 'hospital', desc: 'Cases identified among patients or staff.' },
        { id: 'isolation', label: 'Wards isolated; admissions restricted', sys: 'health', stage: 1, p: [0.8, 0.95, 1, 1], t: 2, asset: 'hospital', desc: 'Infection control closes beds and theatres.', act: 'Cohort patients; enforce PPE and contact tracing.' },
        { id: 'staff', label: 'Staff quarantined or fall ill', sys: 'health', stage: 1, p: [0.3, 0.6, 0.85, 0.95], t: 24, desc: 'Exposed staff are removed from rotas.', act: 'Prophylaxis for contacts; call in reserve staff.' },
        { id: 'diversion', label: 'Ambulances diverted to other hospitals', sys: 'ems', stage: 2, p: [0.4, 0.75, 0.95, 1], t: 4, asset: 'ems', desc: 'The affected hospital stops taking emergencies.', act: 'Publish diversion plan to dispatch.' },
        { id: 'neighbours', label: 'Neighbouring hospitals overloaded', sys: 'health', stage: 3, p: [0.2, 0.5, 0.8, 0.95], t: 12, asset: 'hospital2', desc: 'Diverted patients fill other emergency departments.', act: 'Share bed status city-wide; open overflow wards.' },
        { id: 'community', label: 'Spread to visitors and the community', sys: 'people', stage: 3, p: [0.1, 0.35, 0.7, 0.95], t: 48, desc: 'Visitors and discharged patients carry infection out.', act: 'Trace visitors; restrict visiting.' },
        { id: 'tracing', label: 'Contact tracing and lab capacity stretched', sys: 'health', stage: 2, p: [0.3, 0.7, 0.95, 1], t: 12, desc: 'Each case needs tracing, testing and prophylaxis.', act: 'Bring in surveillance teams; prioritise high-risk contacts.' },
        { id: 'meds', label: 'Antibiotics and PPE demand spikes', sys: 'supply', stage: 2, p: [0.2, 0.55, 0.85, 0.97], t: 24, asset: 'pharmacy', desc: 'Prophylaxis for contacts drains stocks.', act: 'Draw on state stockpiles early.' },
        { id: 'panic', label: 'Public anxiety; people avoid hospitals', sys: 'people', stage: 4, p: [0.3, 0.6, 0.85, 0.95], t: 24, desc: 'Routine care is delayed; rumours spread.', act: 'Clear public messaging on symptoms and where to go.' },
        { id: 'schools', label: 'Schools near cases close', sys: 'education', stage: 4, p: [0, 0.2, 0.6, 0.9], t: 72, asset: 'school', desc: 'Closures limit spread among children.', act: 'Decide closures on community cases, not fear.' },
        { id: 'restrict', label: 'Movement restrictions in affected wards', sys: 'roads', stage: 4, p: [0, 0.05, 0.35, 0.8], t: 96, asset: 'traffic', desc: 'Containment zones limit travel.', act: 'Keep supply and medical corridors open.' },
        { id: 'economy', label: 'Markets and work disrupted', sys: 'supply', stage: 4, p: [0, 0.1, 0.4, 0.8], t: 96, desc: 'Absence and restrictions hit livelihoods.', act: 'Food support for daily-wage workers.' },
      ],
      edges: [['cases', 'isolation', 'infection control'], ['cases', 'staff', 'exposure'], ['isolation', 'diversion', 'emergency intake stops'], ['staff', 'diversion', 'too few staff'], ['diversion', 'neighbours', 'redirected patients'],
        ['cases', 'tracing', 'contacts to trace'], ['tracing', 'meds', 'prophylaxis demand'], ['cases', 'community', 'visitors and discharges'], ['community', 'tracing', 'more contacts'], ['community', 'panic', 'news of cases'],
        ['panic', 'neighbours', 'worried well'], ['community', 'schools', 'cases among families'], ['community', 'restrict', 'containment'], ['restrict', 'economy', 'movement limited']],
    },
    heat: {
      label: 'Heat wave', unit: '°C maximum temperature', min: 35, max: 52, step: 0.5, def: 47,
      bands: [45, 47, 49], scale: 'IMD heat-wave criteria for the plains: heat wave at 45 °C or more, severe heat wave at 47 °C or more (49 °C is this tool’s extreme band)',
      bandNames: ['Hot day', 'Heat wave', 'Severe heat wave', 'Extreme heat'],
      nodes: [
        { id: 'heat', label: 'Extreme daytime heat, warm nights', sys: 'hazard', stage: 0, p: [1, 1, 1, 1], t: 0, desc: 'Little relief overnight in dense areas.' },
        { id: 'demand', label: 'Electricity demand peaks', sys: 'power', stage: 1, p: [0.6, 0.85, 0.95, 1], t: 4, asset: 'power', desc: 'Cooling load pushes transformers to their limits.', act: 'Stagger loads; pre-cool hospitals.' },
        { id: 'outage', label: 'Transformer failures and load-shedding', sys: 'power', stage: 2, p: [0.1, 0.35, 0.65, 0.85], t: 10, desc: 'Overloaded equipment fails in the evening peak.', act: 'Rotate shedding away from hospitals and water pumps.' },
        { id: 'illness', label: 'Heat stroke and dehydration cases rise', sys: 'health', stage: 1, p: [0.3, 0.65, 0.9, 0.98], t: 6, asset: 'hospital', desc: 'Outdoor workers, the elderly and children first.', act: 'Cool rooms in hospitals; ORS at clinics.' },
        { id: 'ems', label: 'Ambulance calls surge', sys: 'ems', stage: 2, p: [0.2, 0.5, 0.8, 0.95], t: 8, asset: 'ems', desc: 'Collapses and heat illness calls.', act: 'Add day-time ambulance shifts.' },
        { id: 'water', label: 'Water demand outstrips supply', sys: 'water', stage: 2, p: [0.3, 0.6, 0.85, 0.95], t: 12, desc: 'Pumps also stop in power cuts.', act: 'Tanker schedules for deficit wards.' },
        { id: 'telecom', label: 'Mobile sites fail in heat and power cuts', sys: 'telecom', stage: 3, p: [0, 0.15, 0.4, 0.65], t: 14, asset: 'telecom', desc: 'Cooling and batteries degrade.', act: 'Generator checks at backbone sites.' },
        { id: 'schools', label: 'School hours cut or schools closed', sys: 'education', stage: 3, p: [0.2, 0.6, 0.9, 1], t: 12, asset: 'school', desc: 'To protect children in the afternoon heat.', act: 'Morning-only timetables.' },
        { id: 'work', label: 'Outdoor work and markets stop at midday', sys: 'supply', stage: 4, p: [0.2, 0.5, 0.8, 0.95], t: 6, desc: 'Loss of income for daily-wage workers.', act: 'Shift working hours; shaded rest points.' },
        { id: 'deaths', label: 'Excess deaths among vulnerable people', sys: 'people', stage: 4, p: [0, 0.15, 0.4, 0.7], t: 48, desc: 'Often counted only later.', act: 'Check on elderly people living alone.' },
      ],
      edges: [['heat', 'demand', 'cooling load'], ['demand', 'outage', 'overloaded equipment'], ['heat', 'illness', 'heat stress'], ['illness', 'ems', 'calls'], ['ems', 'illness', 'delays worsen outcomes'],
        ['heat', 'water', 'higher demand'], ['outage', 'water', 'pumps stop'], ['outage', 'telecom', 'sites lose power'], ['heat', 'telecom', 'equipment overheats'], ['heat', 'schools', 'child safety'],
        ['heat', 'work', 'unsafe to work'], ['outage', 'illness', 'no fans or cooling'], ['illness', 'deaths', 'untreated heat stroke']],
    },
    chemical: {
      label: 'Toxic gas release (e.g. chlorine)', unit: 'tonnes released', min: 0.01, max: 50, step: 0.01, def: 2,
      bands: [0.1, 1, 10], scale: 'This tool’s own bands by quantity released: under 0.1 t, 0.1–1 t, 1–10 t, 10 t or more',
      bandNames: ['Small leak', 'Significant release', 'Major release', 'Catastrophic release'],
      nodes: [
        { id: 'release', label: 'Gas released at the site', sys: 'hazard', stage: 0, p: [1, 1, 1, 1], t: 0, desc: 'A plume drifts downwind and settles in low areas.' },
        { id: 'exposure', label: 'People downwind exposed', sys: 'people', stage: 1, p: [0.4, 0.75, 0.95, 1], t: 0.3, desc: 'Coughing, eye and lung irritation; severe cases near the source.', act: 'Shelter in place upwind; close windows.' },
        { id: 'roads', label: 'Roads closed around the plume', sys: 'roads', stage: 1, p: [0.5, 0.85, 1, 1], t: 0.5, asset: 'traffic', desc: 'Cordons divert traffic onto other routes.', act: 'Set the cordon from wind direction, not distance alone.' },
        { id: 'evac', label: 'Evacuation of nearby homes', sys: 'people', stage: 2, p: [0.1, 0.4, 0.8, 0.95], t: 1, desc: 'Traffic from the evacuation loads nearby roads.', act: 'Evacuate across the wind, not downwind.' },
        { id: 'ems', label: 'Ambulances needed in a hazardous zone', sys: 'ems', stage: 2, p: [0.3, 0.65, 0.9, 1], t: 0.5, asset: 'ems', desc: 'Crews need protective equipment.', act: 'Decontamination point at the cordon.' },
        { id: 'hospital', label: 'Breathing complaints at nearest hospitals', sys: 'health', stage: 3, p: [0.3, 0.65, 0.9, 1], t: 1, asset: 'hospital', desc: 'Walk-in patients arrive before ambulances.', act: 'Decontaminate before entry; oxygen and nebulisers ready.' },
        { id: 'water', label: 'Water treatment disrupted', sys: 'water', stage: 3, p: [0.05, 0.2, 0.45, 0.7], t: 2, desc: 'If the source is a treatment plant, supply may pause.', act: 'Tanker supply for hospitals.' },
        { id: 'schools', label: 'Schools in the plume area shelter or close', sys: 'education', stage: 3, p: [0.2, 0.5, 0.85, 1], t: 0.5, asset: 'school', desc: 'Children kept indoors with windows shut.', act: 'Alert schools by phone first.' },
        { id: 'panic', label: 'Rumours and self-evacuation', sys: 'people', stage: 4, p: [0.2, 0.45, 0.75, 0.9], t: 1, desc: 'Unplanned movement jams roads.', act: 'One clear message with the wind direction.' },
      ],
      edges: [['release', 'exposure', 'plume drifts'], ['release', 'roads', 'cordon'], ['exposure', 'evac', 'protect residents'], ['exposure', 'ems', 'casualties'], ['roads', 'ems', 'detours'],
        ['ems', 'hospital', 'transports'], ['exposure', 'hospital', 'walk-in patients'], ['release', 'water', 'plant operations stop'], ['exposure', 'schools', 'children at risk'], ['evac', 'panic', 'visible movement'], ['panic', 'roads', 'self-evacuation traffic']],
    },
    grid: {
      label: 'Power grid failure', unit: '% of the city’s substations lost', min: 2, max: 100, step: 1, def: 40,
      bands: [10, 30, 60], scale: 'This tool’s own bands by share of substations out: under 10%, 10–29%, 30–59%, 60% or more',
      bandNames: ['Local outage', 'Wide outage', 'Major blackout', 'City-wide blackout'],
      nodes: [
        { id: 'fault', label: 'Substations lose supply', sys: 'hazard', stage: 0, p: [1, 1, 1, 1], t: 0, asset: 'power', desc: 'A transmission fault or overload drops part of the grid.' },
        { id: 'signals', label: 'Traffic signals go dark', sys: 'roads', stage: 1, p: [0.6, 0.85, 1, 1], t: 0, asset: 'traffic', desc: 'Junctions become unmanaged; jams build quickly.', act: 'Traffic police at key junctions.' },
        { id: 'towers', label: 'Mobile sites switch to batteries, then fail', sys: 'telecom', stage: 2, p: [0.2, 0.5, 0.8, 0.95], t: 4, asset: 'telecom', desc: 'Most sites hold for a few hours.', act: 'Fuel generators at sites serving hospitals.' },
        { id: 'pumps', label: 'Water and drainage pumps stop', sys: 'water', stage: 2, p: [0.3, 0.6, 0.9, 1], t: 1, asset: 'drainage', desc: 'Supply pressure falls; sumps fill.', act: 'Generators to pumping stations.' },
        { id: 'hospital', label: 'Hospitals on generators; fuel becomes critical', sys: 'health', stage: 2, p: [0.2, 0.5, 0.85, 1], t: 1, asset: 'hospital', desc: 'Diesel stocks set the clock for critical care.', act: 'Fuel deliveries to hospitals first.' },
        { id: 'ems', label: 'Emergency calls fail to connect', sys: 'ems', stage: 3, p: [0, 0.25, 0.6, 0.85], t: 5, asset: 'ems', desc: 'Telecom outages break the 108/112 chain.', act: 'Fixed points where people can report emergencies.' },
        { id: 'traffic', label: 'Gridlock across the city', sys: 'roads', stage: 2, p: [0.2, 0.5, 0.85, 0.95], t: 1, desc: 'Dark signals and evening peak combine.', act: 'Keep one ambulance corridor.' },
        { id: 'cold', label: 'Cold chains fail (vaccines, food)', sys: 'supply', stage: 3, p: [0, 0.2, 0.55, 0.85], t: 8, asset: 'pharmacy', desc: 'Refrigerated stock warms up.', act: 'Move vaccines to sites with backup power.' },
        { id: 'home', label: 'People on home medical devices at risk', sys: 'people', stage: 4, p: [0.1, 0.35, 0.7, 0.9], t: 6, desc: 'Oxygen concentrators and dialysis stop.', act: 'Registry of home-oxygen users; charging points.' },
        { id: 'schools', label: 'Schools and offices close', sys: 'education', stage: 4, p: [0, 0.25, 0.6, 0.9], t: 12, asset: 'school', desc: 'No lights, water or fans.', act: 'Announce closures the evening before.' },
      ],
      edges: [['fault', 'signals', 'no supply'], ['fault', 'towers', 'grid power lost'], ['fault', 'pumps', 'no supply'], ['fault', 'hospital', 'switch to generators'], ['signals', 'traffic', 'unmanaged junctions'],
        ['towers', 'ems', 'calls fail'], ['traffic', 'ems', 'slow response'], ['traffic', 'hospital', 'fuel deliveries delayed'], ['fault', 'cold', 'refrigeration stops'], ['fault', 'home', 'devices stop'], ['pumps', 'schools', 'no water'], ['fault', 'schools', 'no power']],
    },
    crowd: {
      label: 'Crowd surge at a large gathering', unit: 'people at the gathering', min: 1000, max: 2000000, step: 1000, def: 300000,
      bands: [50000, 200000, 500000], scale: 'This tool’s own bands by crowd size: under 50,000, 50,000–199,999, 200,000–499,999, 500,000 or more',
      bandNames: ['Large gathering', 'Very large gathering', 'Mass gathering', 'Extreme mass gathering'],
      nodes: [
        { id: 'crowd', label: 'Crowd density builds at bottlenecks', sys: 'hazard', stage: 0, p: [1, 1, 1, 1], t: 0, desc: 'Gates, bridges and ghats concentrate people.' },
        { id: 'crush', label: 'Crush or stampede at a choke point', sys: 'people', stage: 1, p: [0.05, 0.15, 0.3, 0.45], t: 1, desc: 'Densities above about 5 people per square metre become dangerous.', act: 'One-way flows; hold crowds back at entry.' },
        { id: 'roads', label: 'Approach roads jammed', sys: 'roads', stage: 1, p: [0.6, 0.85, 0.97, 1], t: 0.5, asset: 'traffic', desc: 'Processions and parking block access.', act: 'Divert traffic early; park far out.' },
        { id: 'telecom', label: 'Mobile network saturated', sys: 'telecom', stage: 1, p: [0.3, 0.6, 0.85, 0.95], t: 0.5, asset: 'telecom', desc: 'Too many users in one cell.', act: 'Temporary cell sites; PA systems.' },
        { id: 'ems', label: 'Ambulances cannot reach casualties', sys: 'ems', stage: 2, p: [0.3, 0.6, 0.85, 0.95], t: 1, asset: 'ems', desc: 'Routes inside the crowd are blocked.', act: 'Stage ambulances and first-aid posts inside the area.' },
        { id: 'hospital', label: 'Mass-casualty arrivals at hospitals', sys: 'health', stage: 3, p: [0.05, 0.2, 0.4, 0.55], t: 2, asset: 'hospital', desc: 'If a crush happens, many casualties arrive together.', act: 'Hospitals on standby for the event window.' },
        { id: 'lost', label: 'Lost children and separated families', sys: 'people', stage: 3, p: [0.4, 0.7, 0.9, 0.97], t: 2, desc: 'Phones do not work when the network is saturated.', act: 'Help desks and meeting points.' },
        { id: 'panic', label: 'Rumour-driven panic', sys: 'people', stage: 2, p: [0.05, 0.15, 0.3, 0.45], t: 1, desc: 'A false alarm can trigger a rush.', act: 'Trusted announcements over PA.' },
      ],
      edges: [['crowd', 'crush', 'dangerous density'], ['crowd', 'roads', 'arrivals and processions'], ['crowd', 'telecom', 'many users'], ['roads', 'ems', 'blocked access'], ['crush', 'ems', 'casualties'],
        ['crush', 'hospital', 'mass casualties'], ['ems', 'hospital', 'delayed transports'], ['telecom', 'lost', 'cannot call'], ['panic', 'crush', 'sudden rush'], ['telecom', 'panic', 'no reliable information']],
    },
  };

  const bandOf = (kb, mag) => kb.bands.reduce((b, thr) => (mag >= thr ? b + 1 : b), 0);

  // Real sites near the place, by kind, from the city data (and OpenStreetMap places).
  function sitesNear(geo, P, kind, opts = {}) {
    const F = geo.facilities;
    const pick = (list) => list.map((s) => ({ ...s, d: C.haversine(P, s.lngLat) })).sort((a, b) => a.d - b.d);
    if (kind === 'school' || kind === 'pharmacy') {
      const pois = ((root.TWIN_PLACES && root.TWIN_PLACES[geo.id]) || { pois: [] }).pois;
      return pick(pois.filter((p) => p[0] === kind || (kind === 'school' && p[0] === 'college')).map((p) => ({ name: p[1], lngLat: [p[2], p[3]], kind }))).slice(0, 3);
    }
    const test = {
      drainage: (f) => f.type === 'drainage', traffic: (f) => f.type === 'traffic', power: (f) => f.type === 'power', telecom: (f) => f.type === 'telecom',
      ems: (f) => f.type === 'hospital' && f.subtype === 'EMS station', hospital: (f) => f.type === 'hospital' && f.subtype !== 'EMS station', hospital2: (f) => f.type === 'hospital' && f.subtype !== 'EMS station',
    }[kind];
    if (!test) return [];
    let list = pick(F.filter(test).map((f) => ({ name: f.name, id: f.id, lngLat: f.lngLat, kind })));
    if (kind === 'hospital' && opts.fac && test(opts.fac)) list = [{ name: opts.fac.name, id: opts.fac.id, lngLat: opts.fac.lngLat, kind, d: 0 }].concat(list.filter((s) => s.id !== opts.fac.id));
    if (kind === 'hospital2') list = list.filter((s) => !opts.fac || s.id !== opts.fac.id);
    return list.slice(0, kind === 'hospital' || kind === 'hospital2' ? 2 : 3);
  }

  // place: { name, lngLat, fac (facility object, optional) }
  function generate(geo, place, calamity, magnitude) {
    const kb = KB[calamity];
    if (!kb) throw new Error('Unknown event type ' + calamity);
    const mag = C.clamp(+magnitude, kb.min, kb.max);
    const b = bandOf(kb, mag);
    // Within a band, likelihood grows a little with magnitude; timing quickens with severity.
    const lo = b === 0 ? kb.min : kb.bands[b - 1], hi = b < kb.bands.length ? kb.bands[b] : kb.max;
    const within = hi > lo ? C.clamp((mag - lo) / (hi - lo), 0, 1) : 0.5;
    const nodes = kb.nodes.filter((n) => n.p[b] > 0).map((n) => {
      const pNext = b < 3 ? n.p[b + 1] : n.p[b];
      const p = C.clamp(n.p[b] + (pNext - n.p[b]) * within * 0.5, 0, 1);
      const t0 = +(n.t * (1 - 0.15 * b)).toFixed(1);
      const sites = n.asset ? sitesNear(geo, place.lngLat, n.asset, { fac: place.fac }) : [];
      return { id: n.id, label: n.label, sys: n.sys, stage: n.stage, p, likely: LIKELY(p), t: t0, desc: n.desc, act: n.act || null, sites };
    });
    const ids = new Set(nodes.map((n) => n.id));
    const edges = kb.edges.filter(([a, c]) => ids.has(a) && ids.has(c)).map(([from, to, how]) => ({ from, to, how }));
    // Order of appearance: by stage, then onset.
    nodes.sort((x, y) => x.stage - y.stage || x.t - y.t);
    const systems = [...new Set(nodes.map((n) => n.sys))];
    return {
      calamity, label: kb.label, unit: kb.unit, magnitude: mag, band: b, bandName: kb.bandNames[b], severity: BAND[b], scale: kb.scale,
      place, nodes, edges, systems, last: Math.max(...nodes.map((n) => n.t)),
      skipped: kb.nodes.filter((n) => n.p[b] === 0).map((n) => n.label),
    };
  }

  root.TWIN.whatif = { KB, SYSTEMS, STAGES, BAND, generate, bandOf, LIKELY };
})(typeof window !== 'undefined' ? window : globalThis);
