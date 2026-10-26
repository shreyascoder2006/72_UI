const PHASES = [
  {
    tag: 'Phase 1',
    h: 'Nagpur pilot',
    p: 'One city’s ICCC: validate forecasts against lived experience, tune thresholds with real operators.',
    gate: 'Gate: operators trust the lead time enough to act on it.',
  },
  {
    tag: 'Phase 2',
    h: 'Open data pipeline',
    p: 'Replace hand-authored calibration with live SCADA, IMD and hospital feeds where cities will share them.',
    gate: 'Gate: one real sensor feed replaces one simulated one.',
  },
  {
    tag: 'Phase 3',
    h: 'Scale in Maharashtra',
    p: 'More ICCCs, through the same engine — only geometry, facilities and hazards change per city.',
    gate: 'Gate: a third city runs with no code change.',
  },
  {
    tag: 'Phase 4',
    h: 'National & standards-based',
    p: 'CAP 1.2 output plugs into NDMA SACHET; WhatsApp alerts reach citizens directly.',
    gate: 'Gate: one alert issued through a real gateway.',
  },
]

const TRUST = [
  'EXERCISE marking on every product',
  'Real OpenStreetMap geometry',
  'Replay-validated forecasts',
  'CAP 1.2, standards-based',
  'No fabricated figures',
]

export default function Roadmap() {
  return (
    <section id="pilot" className="section dark">
      <div className="inner">
        <div className="sec-head reveal">
          <span className="eyebrow">The path</span>
          <h2>One city first. Then copy what works.</h2>
          <p className="sub">Same engine, more cities &mdash; no retuning between them.</p>
        </div>
        <div className="grid g4">
          {PHASES.map((p, i) => (
            <div key={p.h} className="card-d reveal" style={{ transitionDelay: `${i * 0.06}s` }}>
              <span className="tag">{p.tag}</span>
              <h3 style={{ margin: '10px 0 0' }}>{p.h}</h3>
              <p>{p.p}</p>
              <p className="phase-g">{p.gate}</p>
            </div>
          ))}
        </div>
        <div className="trust-chips reveal" style={{ transitionDelay: '.15s' }}>
          {TRUST.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      </div>
    </section>
  )
}
