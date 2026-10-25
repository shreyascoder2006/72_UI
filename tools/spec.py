"""Authored knowledge base for the Raleigh twin: monitored facilities and candidate dependencies.

Locations are real. Facility points are either OpenStreetMap features (hospitals,
substations, EMS stations, the Lake Boone pumping station) or are computed by
build_data.py as the exact crossing of a named creek and a named road in the
OpenMapTiles data, which is where stream gauges and culverts actually sit.

Operating figures (base load, capacity thresholds, sensor IDs) are modeled for the
simulation; they are not utility or hospital records.
"""

# Twin extent and start of the 72 h window (local time, EDT).
EXTENT = [-78.745, 35.728, -78.548, 35.915]
CENTER = [-78.6382, 35.8040]
T0_ISO = "2026-10-24T00:00:00-04:00"

# A facility "at" is one of:
#   ("osm", lat, lon)                 – a point taken from the OSM pull
#   ("cross", creek, road, near_lat, near_lon) – nearest creek x road crossing to the hint
#   ("road", road_a, road_b, near_lat, near_lon) – nearest road x road crossing to the hint
#   ("pt", lat, lon)                  – a modeled sensor site (weather gauges)
#
# stem: height in px of the marker's ground stem, used to separate neighbours that sit
# within a few hundred metres of each other.

FACILITIES = [
    # ── Drainage: stream gauges at real creek crossings ─────────────────────────
    dict(id="DRN-CTG", type="drainage", subtype="Stream gauge", name="Crabtree Creek at Glenwood Ave",
         district="Crabtree Valley", at=("cross", "Crabtree Creek", "Glenwood Avenue", 35.838, -78.674),
         sensor="HYD-2101", tier=1, stem=46, creek="Crabtree Creek",
         p=dict(base=0.10, cap=72, scale=17, tau=20, wx="WX-CVY")),
    dict(id="DRN-CTL", type="drainage", subtype="Stream gauge", name="Crabtree Creek at Lassiter Mill Rd",
         district="Lassiter Mill", at=("cross", "Crabtree Creek", "Lassiter Mill Road", 35.826, -78.649),
         sensor="HYD-2104", tier=2, stem=34, creek="Crabtree Creek",
         p=dict(base=0.08, cap=80, scale=18, tau=22, wx="WX-NHL")),
    dict(id="DRN-CTC", type="drainage", subtype="Stream gauge", name="Crabtree Creek at Capital Blvd",
         district="Highwoods", at=("cross", "Crabtree Creek", "Capital Boulevard", 35.811, -78.611),
         sensor="HYD-2109", tier=1, stem=34, creek="Crabtree Creek",
         p=dict(base=0.10, cap=86, scale=19, tau=24, wx="WX-NHL")),
    dict(id="DRN-PHU", type="drainage", subtype="Culvert gauge", name="Pigeon House Branch at Capital Blvd",
         district="Mordecai", at=("cross", "Pigeon House Branch", "Capital Boulevard", 35.7974, -78.6397),
         sensor="HYD-2215", tier=1, stem=40, creek="Pigeon House Branch",
         p=dict(base=0.12, cap=50, scale=11, tau=7, wx="WX-DTN")),
    dict(id="DRN-PHC", type="drainage", subtype="Culvert gauge", name="Pigeon House Branch at Atlantic Ave",
         district="Capital Blvd corridor", at=("cross", "Pigeon House Branch", "Capital Boulevard", 35.8049, -78.6173),
         sensor="HYD-2218", tier=2, stem=34, creek="Pigeon House Branch",
         p=dict(base=0.10, cap=56, scale=12, tau=9, wx="WX-DTN")),
    dict(id="DRN-RBW", type="drainage", subtype="Stream gauge", name="Rocky Branch at Western Blvd",
         district="NC State / Pullen Park", at=("cross", "Rocky Branch", "Western Boulevard", 35.7748, -78.6566),
         sensor="HYD-2302", tier=2, stem=34, creek="Rocky Branch",
         p=dict(base=0.09, cap=58, scale=13, tau=8, wx="WX-NCS")),
    dict(id="DRN-WCS", type="drainage", subtype="Stream gauge", name="Walnut Creek at S Saunders St",
         district="Caraleigh", at=("cross", "Walnut Creek", "South Saunders Street", 35.7542, -78.6489),
         sensor="HYD-2405", tier=2, stem=34, creek="Walnut Creek",
         p=dict(base=0.08, cap=74, scale=16, tau=18, wx="WX-WCW")),
    dict(id="DRN-MCC", type="drainage", subtype="Stream gauge", name="Marsh Creek at Capital Blvd",
         district="Brentwood", at=("cross", "Marsh Creek", "Capital Boulevard", 35.8197, -78.5939),
         sensor="HYD-2511", tier=3, stem=34, creek="Marsh Creek",
         p=dict(base=0.07, cap=68, scale=15, tau=12, wx="WX-NHL")),
    dict(id="DRN-HCI", type="drainage", subtype="Stream gauge", name="House Creek at I-440",
         district="Meredith / Wade Ave", at=("cross", "House Creek", "I-440", 35.8085, -78.6940),
         sensor="HYD-2607", tier=2, stem=34, creek="House Creek",
         p=dict(base=0.08, cap=60, scale=13, tau=10, wx="WX-CVY")),
    dict(id="DRN-BCG", type="drainage", subtype="Stream gauge", name="Beaverdam Creek at Glenwood Ave",
         district="Glenwood / Lake Boone", at=("cross", "Beaverdam Creek", "Glenwood Avenue", 35.8166, -78.6607),
         sensor="HYD-2702", tier=3, stem=34, creek="Beaverdam Creek",
         p=dict(base=0.07, cap=62, scale=14, tau=10, wx="WX-CVY")),
    dict(id="PMP-LBT", type="drainage", subtype="Pumping station", name="Lake Boone Pumping Station",
         district="Lake Boone / Rex", at=("osm", 35.80154, -78.70697),
         sensor="PMP-0418", tier=2, stem=34,
         p=dict(base=0.14, cap=62, scale=15, tau=6, wx="WX-CVY")),

    # ── Traffic: control points at real intersections and interchanges ──────────
    dict(id="TRF-GLN", type="traffic", subtype="Interchange", name="I-440 at Glenwood Ave",
         district="Crabtree Valley", at=("road", "I-440", "Glenwood Avenue", 35.835, -78.669),
         sensor="CAM-3168", tier=1, stem=72, p=dict(base=0.22)),
    dict(id="TRF-CWF", type="traffic", subtype="Signalized junction", name="Capital Blvd at Wake Forest Rd",
         district="Mordecai", at=("road", "Capital Boulevard", "Wake Forest Road", 35.8015, -78.6249),
         sensor="CAM-3091", tier=1, stem=60, p=dict(base=0.26)),
    dict(id="TRF-CPC", type="traffic", subtype="Signalized junction", name="Capital Blvd at Peace St",
         district="Seaboard / Glenwood South", at=("road", "Capital Boulevard", "West Peace Street", 35.7885, -78.6430),
         sensor="CAM-3092", tier=2, stem=34, p=dict(base=0.24)),
    dict(id="TRF-CBL", type="traffic", subtype="Interchange", name="I-440 at Capital Blvd",
         district="Highwoods", at=("road", "I-440", "Capital Boulevard", 35.8148, -78.6055),
         sensor="CAM-3093", tier=1, stem=62, p=dict(base=0.25)),
    dict(id="TRF-SFK", type="traffic", subtype="Interchange", name="I-440 at Six Forks Rd",
         district="North Hills", at=("road", "I-440", "Six Forks Road", 35.8345, -78.6387),
         sensor="CAM-3094", tier=2, stem=34, p=dict(base=0.27)),
    dict(id="TRF-WFR", type="traffic", subtype="Interchange", name="I-440 at Wake Forest Rd",
         district="Duke Raleigh", at=("road", "I-440", "Wake Forest Road", 35.8253, -78.6215),
         sensor="CAM-3095", tier=1, stem=34, p=dict(base=0.24)),
    dict(id="TRF-NBA", type="traffic", subtype="Interchange", name="I-440 at New Bern Ave",
         district="Longview", at=("road", "I-440", "New Bern Avenue", 35.7943, -78.5826),
         sensor="CAM-3096", tier=1, stem=34, p=dict(base=0.23)),
    dict(id="TRF-LBT", type="traffic", subtype="Interchange", name="I-440 at Lake Boone Trail",
         district="Lake Boone / Rex", at=("road", "I-440", "Lake Boone Trail", 35.8155, -78.6908),
         sensor="CAM-3097", tier=2, stem=58, p=dict(base=0.21)),
    dict(id="TRF-FMS", type="traffic", subtype="Signalized junction", name="Fayetteville St at Martin St",
         district="Downtown", at=("road", "Fayetteville Street", "West Martin Street", 35.7769, -78.6393),
         sensor="CAM-3098", tier=2, stem=34, p=dict(base=0.20)),
    dict(id="TRF-WOB", type="traffic", subtype="Signalized junction", name="Wade Ave at Oberlin Rd",
         district="Cameron Village", at=("road", "Wade Avenue", "Oberlin Road", 35.7999, -78.6602),
         sensor="CAM-3099", tier=3, stem=34, p=dict(base=0.19)),
    dict(id="TRF-WAF", type="traffic", subtype="Signalized junction", name="Western Blvd at Avent Ferry Rd",
         district="NC State", at=("road", "Western Boulevard", "Avent Ferry Road", 35.7807, -78.6755),
         sensor="CAM-3100", tier=3, stem=34, p=dict(base=0.18)),
    dict(id="TRF-I40", type="traffic", subtype="Interchange", name="I-40 at Lake Wheeler Rd",
         district="Dix Park / Lake Wheeler", at=("road", "I-40", "Lake Wheeler Road", 35.7572, -78.6654),
         sensor="CAM-3101", tier=3, stem=34, p=dict(base=0.22)),

    # ── Power: OSM substations (voltages from OSM) ──────────────────────────────
    dict(id="PWR-CRB", type="power", subtype="Distribution substation", name="Crabtree Substation",
         district="Crabtree / Blue Ridge", at=("osm", 35.82904, -78.69419), voltage="230 kV",
         sensor="SCADA-CR1", tier=1, stem=34, p=dict(base=0.30)),
    dict(id="PWR-MRD", type="power", subtype="Transmission substation", name="Wade Ave Transmission Substation",
         district="Meredith", at=("osm", 35.79092, -78.68246), voltage="230/115 kV",
         sensor="SCADA-WA2", tier=1, stem=34, p=dict(base=0.32)),
    dict(id="PWR-PCE", type="power", subtype="Distribution substation", name="Peace St Substation",
         district="Seaboard", at=("osm", 35.79112, -78.63890), voltage="115 kV",
         sensor="SCADA-PS3", tier=1, stem=56, p=dict(base=0.30)),
    dict(id="PWR-DTN", type="power", subtype="Distribution substation", name="Warehouse District Substation",
         district="Warehouse District", at=("osm", 35.77355, -78.64489), voltage="115 kV",
         sensor="SCADA-WD4", tier=2, stem=34, p=dict(base=0.33)),
    dict(id="PWR-WMR", type="power", subtype="Distribution substation", name="WakeMed Campus Substation",
         district="Longview", at=("osm", 35.78185, -78.58687), voltage="—",
         sensor="SCADA-WM5", tier=1, stem=30, p=dict(base=0.31)),
    dict(id="PWR-DRH", type="power", subtype="Distribution substation", name="Wake Forest Rd Substation",
         district="Duke Raleigh", at=("osm", 35.82715, -78.60848), voltage="115 kV",
         sensor="SCADA-WF6", tier=2, stem=34, p=dict(base=0.29)),
    dict(id="PWR-NHL", type="power", subtype="Distribution substation", name="North Hills Substation",
         district="North Hills", at=("osm", 35.83536, -78.65071), voltage="115 kV",
         sensor="SCADA-NH7", tier=3, stem=34, p=dict(base=0.28)),
    dict(id="PWR-EST", type="power", subtype="Transmission substation", name="East Raleigh Transmission Substation",
         district="East Raleigh", at=("osm", 35.78055, -78.55444), voltage="230 kV",
         sensor="SCADA-ER8", tier=2, stem=34, p=dict(base=0.30)),
    dict(id="PWR-NCS", type="power", subtype="Distribution substation", name="Centennial Substation",
         district="NC State", at=("osm", 35.77554, -78.67833), voltage="230 kV",
         sensor="SCADA-CC9", tier=3, stem=34, p=dict(base=0.27)),

    # ── Hospitals and emergency medical services (OSM) ──────────────────────────
    dict(id="HSP-WMR", type="hospital", subtype="Level I trauma center", name="WakeMed Raleigh Campus",
         district="Longview", address="3000 New Bern Ave", at=("osm", 35.78261, -78.58824), beds=628,
         sensor="HIS-WMR", tier=1, stem=78, p=dict(base=0.30)),
    dict(id="HSP-DRH", type="hospital", subtype="Acute care hospital", name="Duke Raleigh Hospital",
         district="Duke Raleigh", address="3400 Wake Forest Rd", at=("osm", 35.82860, -78.61795), beds=186,
         sensor="HIS-DRH", tier=1, stem=48, p=dict(base=0.27)),
    dict(id="HSP-REX", type="hospital", subtype="Acute care hospital", name="UNC Rex Hospital",
         district="Lake Boone / Rex", address="4420 Lake Boone Trail", at=("pt", 35.81700, -78.70350), beds=665,
         beds_modeled=True, sensor="HIS-REX", tier=1, stem=40, p=dict(base=0.28)),
    dict(id="HSP-WMN", type="hospital", subtype="Community hospital", name="WakeMed North Hospital",
         district="North Raleigh", address="10000 Falls of Neuse Rd", at=("osm", 35.90914, -78.59770), beds=61,
         sensor="HIS-WMN", tier=3, stem=34, p=dict(base=0.22)),
    dict(id="EMS-02", type="hospital", subtype="EMS station", name="Wake County EMS Station 2",
         district="Noble Rd", address="Noble Rd", at=("osm", 35.80928, -78.63517),
         sensor="CAD-E02", tier=2, stem=34, p=dict(base=0.24)),
    dict(id="EMS-07", type="hospital", subtype="EMS station", name="Wake County EMS Station 7",
         district="Kidd Rd", address="Kidd Rd", at=("osm", 35.77801, -78.58659),
         sensor="CAD-E07", tier=2, stem=50, p=dict(base=0.26)),
    dict(id="EMS-SF", type="hospital", subtype="EMS station", name="Wake County EMS, Six Forks Rd",
         district="North Hills", address="Six Forks Rd", at=("osm", 35.85374, -78.64278),
         sensor="CAD-E14", tier=3, stem=34, p=dict(base=0.22)),

    # ── Weather: modeled gauge network ──────────────────────────────────────────
    dict(id="WX-CVY", type="weather", subtype="Rain gauge", name="Rain Gauge, Crabtree Valley",
         district="Crabtree Valley", at=("pt", 35.8462, -78.6930), sensor="WX-1107", tier=2, stem=34, p=dict(base=0.0)),
    dict(id="WX-NHL", type="weather", subtype="Rain gauge", name="Rain Gauge, North Hills",
         district="North Hills", at=("pt", 35.8530, -78.6230), sensor="WX-1112", tier=2, stem=34, p=dict(base=0.0)),
    dict(id="WX-DTN", type="weather", subtype="Weather station", name="Weather Station, Nash Square",
         district="Downtown", at=("pt", 35.7795, -78.6440), sensor="WX-1101", tier=1, stem=56, p=dict(base=0.0)),
    dict(id="WX-NCS", type="weather", subtype="Rain gauge", name="Rain Gauge, Centennial Campus",
         district="NC State", at=("pt", 35.7712, -78.6745), sensor="WX-1120", tier=3, stem=50, p=dict(base=0.0)),
    dict(id="WX-WCW", type="weather", subtype="Rain gauge", name="Rain Gauge, Walnut Creek Wetland Park",
         district="Walnut Creek", at=("pt", 35.7563, -78.6249), sensor="WX-1125", tier=3, stem=34, p=dict(base=0.0)),
]

# Candidate dependencies: (from, to, nominal weight, lag hours, mechanism, kind)
# kind decides how the link is drawn: road = routed on the street graph,
# creek = routed down the waterway graph, feed = straight line (power, exposure).
# A nominal weight of 0 marks a link engineers flagged as possible but that the
# ground-truth storm does not exercise; the filter should learn to prune it.
EDGES = [
    # drainage -> drainage (downstream)
    ("DRN-PHU", "DRN-PHC", 0.35, 0.5, "Culvert surcharge travels downstream", "creek"),
    ("DRN-PHC", "DRN-CTC", 0.25, 1.0, "Pigeon House Branch joins Crabtree Creek", "creek"),
    ("DRN-CTG", "DRN-CTL", 0.40, 2.0, "Flood wave routing down Crabtree Creek", "creek"),
    ("DRN-CTL", "DRN-CTC", 0.40, 2.0, "Flood wave routing down Crabtree Creek", "creek"),
    ("DRN-HCI", "DRN-CTG", 0.25, 1.5, "House Creek joins Crabtree Creek", "creek"),
    ("DRN-BCG", "DRN-CTL", 0.20, 1.5, "Beaverdam Creek joins Crabtree Creek", "creek"),
    ("PMP-LBT", "DRN-HCI", 0.30, 1.0, "Pump shortfall backs water into House Creek", "feed"),
    # drainage -> traffic (road inundation)
    ("DRN-CTG", "TRF-GLN", 0.55, 1.0, "Glenwood Ave and Beltline ramps inundated", "road"),
    ("DRN-PHU", "TRF-CPC", 0.50, 0.5, "Capital Blvd underpass ponding", "road"),
    ("DRN-PHC", "TRF-CWF", 0.60, 0.5, "Capital Blvd lanes closed at culvert", "road"),
    ("DRN-CTC", "TRF-CBL", 0.45, 1.0, "Capital Blvd bridge approach flooded", "road"),
    ("DRN-RBW", "TRF-WAF", 0.35, 0.5, "Western Blvd lane closures", "road"),
    ("DRN-WCS", "TRF-I40", 0.30, 1.0, "Saunders St closure diverts to I-40", "road"),
    ("DRN-HCI", "TRF-LBT", 0.40, 1.0, "Lake Boone Trail ramps ponding", "road"),
    ("DRN-BCG", "TRF-WOB", 0.25, 1.0, "Glenwood closure diverts to Wade Ave", "road"),
    ("DRN-CTL", "TRF-SFK", 0.30, 1.5, "Lassiter Mill closure diverts to Six Forks", "road"),
    ("DRN-MCC", "TRF-CBL", 0.25, 1.0, "Capital Blvd north lanes ponding", "road"),
    # traffic -> traffic (diversion, spillback)
    ("TRF-CWF", "TRF-WFR", 0.35, 1.0, "Capital Blvd detour loads Wake Forest Rd", "road"),
    ("TRF-CWF", "TRF-CPC", 0.25, 0.5, "Queue spillback toward downtown", "road"),
    ("TRF-GLN", "TRF-LBT", 0.30, 1.0, "Beltline queue propagates west", "road"),
    ("TRF-GLN", "TRF-SFK", 0.30, 1.5, "Beltline queue propagates east", "road"),
    ("TRF-SFK", "TRF-WFR", 0.30, 1.0, "Beltline queue propagates east", "road"),
    ("TRF-WFR", "TRF-CBL", 0.30, 1.0, "Beltline queue propagates east", "road"),
    ("TRF-CBL", "TRF-NBA", 0.30, 1.5, "Beltline queue propagates south", "road"),
    ("TRF-CPC", "TRF-FMS", 0.30, 0.5, "Downtown grid saturation", "road"),
    ("TRF-WOB", "TRF-FMS", 0.15, 1.0, "Wade Ave diversion into downtown", "road"),
    # traffic -> EMS (response delay)
    ("TRF-CWF", "EMS-02", 0.50, 0.5, "Station 2 response routes blocked", "road"),
    ("TRF-WFR", "EMS-02", 0.30, 0.5, "Station 2 response routes slowed", "road"),
    ("TRF-NBA", "EMS-07", 0.45, 0.5, "Station 7 response routes slowed", "road"),
    ("TRF-SFK", "EMS-SF", 0.45, 0.5, "Six Forks unit response slowed", "road"),
    ("TRF-GLN", "EMS-SF", 0.20, 1.0, "Six Forks unit diverted to Crabtree", "road"),
    # EMS / traffic -> hospital
    ("EMS-02", "HSP-DRH", 0.35, 1.0, "Ambulance arrivals delayed and bunched", "road"),
    ("EMS-07", "HSP-WMR", 0.32, 1.0, "Ambulance arrivals delayed and bunched", "road"),
    ("EMS-SF", "HSP-DRH", 0.20, 1.0, "Ambulance arrivals delayed", "road"),
    ("EMS-02", "HSP-WMR", 0.25, 1.5, "Trauma transfers to Level I center", "road"),
    ("TRF-LBT", "HSP-REX", 0.45, 1.0, "Hospital access via Lake Boone degraded", "road"),
    ("TRF-NBA", "HSP-WMR", 0.30, 1.0, "Hospital access via New Bern degraded", "road"),
    ("TRF-WFR", "HSP-DRH", 0.30, 1.0, "Hospital access via Wake Forest Rd degraded", "road"),
    ("DRN-CTG", "HSP-REX", 0.25, 4.0, "Casualty surge from Crabtree Valley flooding", "road"),
    ("DRN-PHC", "HSP-WMR", 0.20, 4.0, "Casualty surge from Capital Blvd flooding", "road"),
    # drainage -> power (flood exposure)
    ("DRN-PHU", "PWR-PCE", 0.60, 1.0, "Substation yard in Pigeon House floodplain", "feed"),
    ("DRN-CTG", "PWR-CRB", 0.45, 2.0, "Crabtree floodplain reaches feeder vaults", "feed"),
    ("DRN-RBW", "PWR-NCS", 0.30, 1.5, "Rocky Branch reaches cable trench", "feed"),
    ("DRN-CTC", "PWR-DRH", 0.30, 2.0, "Crabtree floodplain reaches feeder vaults", "feed"),
    ("DRN-MCC", "PWR-DRH", 0.20, 2.0, "Marsh Creek reaches feeder vaults", "feed"),
    # power -> power (load transfer)
    ("PWR-MRD", "PWR-NCS", 0.30, 0.5, "Transmission contingency", "feed"),
    ("PWR-MRD", "PWR-CRB", 0.30, 0.5, "Transmission contingency", "feed"),
    ("PWR-PCE", "PWR-DTN", 0.35, 0.5, "Load transferred to downtown feeders", "feed"),
    ("PWR-DTN", "PWR-PCE", 0.20, 0.5, "Load transferred back to Peace St", "feed"),
    ("PWR-EST", "PWR-WMR", 0.40, 0.5, "Transmission contingency", "feed"),
    ("PWR-CRB", "PWR-NHL", 0.25, 1.0, "Load transferred to North Hills", "feed"),
    # power -> dependents
    ("PWR-WMR", "HSP-WMR", 0.35, 0.5, "Hospital on generator, load shedding", "feed"),
    ("PWR-DRH", "HSP-DRH", 0.32, 0.5, "Hospital on generator, load shedding", "feed"),
    ("PWR-CRB", "HSP-REX", 0.30, 0.5, "Hospital on generator, load shedding", "feed"),
    ("PWR-NHL", "EMS-SF", 0.20, 0.5, "Station on backup power", "feed"),
    ("PWR-CRB", "PMP-LBT", 0.45, 0.5, "Pumps lose primary feed", "feed"),
    ("PWR-PCE", "TRF-CPC", 0.30, 0.5, "Signals dark on Capital Blvd", "feed"),
    ("PWR-DTN", "TRF-FMS", 0.35, 0.5, "Signals dark downtown", "feed"),
    # hospital feedback loops
    ("HSP-WMR", "HSP-DRH", 0.22, 1.0, "Diversion to Duke Raleigh", "road"),
    ("HSP-DRH", "HSP-WMR", 0.18, 1.0, "Diversion to WakeMed", "road"),
    ("HSP-REX", "HSP-WMR", 0.20, 1.5, "Trauma transfers to WakeMed", "road"),
    ("HSP-DRH", "HSP-WMN", 0.30, 1.0, "Diversion north to WakeMed North", "road"),
    ("HSP-WMR", "EMS-07", 0.28, 0.5, "Ambulance offload delays hold units", "road"),
    ("HSP-DRH", "EMS-02", 0.24, 0.5, "Ambulance offload delays hold units", "road"),
    # flagged as possible, not exercised by the ground-truth storm
    ("DRN-WCS", "HSP-WMR", 0.0, 3.0, "Casualty surge from Walnut Creek", "road"),
    ("TRF-WAF", "HSP-REX", 0.0, 1.0, "Access via Western Blvd", "road"),
    ("PWR-NCS", "TRF-WAF", 0.0, 0.5, "Signals dark on Western Blvd", "feed"),
    ("DRN-RBW", "TRF-FMS", 0.0, 1.0, "Rocky Branch closure diverts downtown", "road"),
    ("TRF-I40", "EMS-07", 0.0, 1.0, "Station 7 routed via I-40", "road"),
    ("PWR-NHL", "HSP-DRH", 0.0, 0.5, "Alternate feed to Duke Raleigh", "feed"),
    ("DRN-BCG", "PWR-MRD", 0.0, 1.0, "Beaverdam Creek reaches transmission yard", "feed"),
]

# District labels drawn on the map (real neighbourhood centroids).
DISTRICTS = [
    ("DOWNTOWN", 35.7780, -78.6395),
    ("GLENWOOD SOUTH", 35.7870, -78.6475),
    ("FIVE POINTS", 35.8065, -78.6465),
    ("NC STATE", 35.7855, -78.6720),
    ("CAMERON VILLAGE", 35.7920, -78.6590),
    ("NORTH HILLS", 35.8385, -78.6430),
    ("CRABTREE VALLEY", 35.8405, -78.6800),
    ("MIDTOWN", 35.8240, -78.6300),
    ("OAKWOOD", 35.7890, -78.6300),
    ("SOUTHEAST RALEIGH", 35.7620, -78.6050),
    ("DIX PARK", 35.7680, -78.6580),
    ("BRENTWOOD", 35.8190, -78.5860),
]

# Named corridors that make up the monitored road network for the traffic layer.
CORRIDOR_CLASSES = {"motorway", "trunk", "primary", "secondary"}

CITY = "Raleigh"
REGION = "North Carolina"
TZ = "America/New_York"
TZ_LABEL = "EDT"
OVERVIEW = dict(center=[-78.6440, 35.7990], zoom=13.05, pitch=58, bearing=-20)

# Sensor faults and planted reports for this city (applied to the observation stream only).
FAULTS = [
    dict(id="DRN-CTL", kind="stuck", **{"from": 18}, to=40, note="Gauge reading frozen"),
    dict(id="TRF-WOB", kind="dropout", **{"from": 28}, to=38, note="Camera feed offline"),
    dict(id="WX-NCS", kind="bias", **{"from": 30}, to=72, value=0.3, note="Gauge reading high, likely debris in funnel"),
]
FALSE_REPORTS = [
    dict(t=16.5, near="TRF-FMS", text="Street flooding, cars stalled at Fayetteville St & Martin St"),
    dict(t=12.5, near="PWR-MRD", text="Explosion at the Wade Ave substation, west Raleigh without power"),
]
