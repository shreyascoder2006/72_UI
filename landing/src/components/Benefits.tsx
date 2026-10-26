const CARDS = [
  {
    h: 'City EOC & ICCC operators',
    p: 'See every system’s stress in one place instead of five separate dashboards.',
    stat: 'One console, six systems',
  },
  {
    h: 'Utilities — water, power, telecom',
    p: 'See upstream stress before it reaches their own equipment, not after an outage.',
    stat: 'Explained, not just alarmed',
  },
  {
    h: 'Hospitals & 108/112 EMS',
    p: 'Get census and access warnings before the surge, not during it.',
    stat: '16–23h median lead',
  },
  {
    h: 'Citizens, via WhatsApp',
    p: 'Ask “am I safe?” and get an answer for their own location, in their own language.',
    stat: 'EN · HI · MR · ES',
  },
  {
    h: 'SDMA & NDMA planners',
    p: 'Compare interventions before committing crews, not after the fact.',
    stat: '7 actions, crew-budgeted',
    modelled: true,
  },
  {
    h: 'Researchers & auditors',
    p: 'Every forecast is replay-validated against the hidden ground truth, not just demoed.',
    stat: '10 scenario runs scored',
  },
]

export default function Benefits() {
  return (
    <section id="benefits" className="section dark">
      <div className="inner">
        <div className="sec-head reveal">
          <span className="eyebrow">Who it&apos;s for</span>
          <h2>Six roles, one forecast</h2>
        </div>
        <div className="grid g3">
          {CARDS.map((c, i) => (
            <div key={c.h} className="card-d reveal" style={{ transitionDelay: `${i * 0.05}s` }}>
              <h3>{c.h}</h3>
              <p>{c.p}</p>
              <p className="stat">
                {c.stat}
                {c.modelled && <span className="chip-modelled">Capability</span>}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
