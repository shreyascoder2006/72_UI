const STATS = [
  ['1,000+', 'deaths when Mumbai’s rail, roads, power and phones failed together, 26 Jul 2005', 'Govt. of Maharashtra flood inquiry, 2006'],
  ['500+', 'deaths when a reservoir release flooded Chennai, Dec 2015', 'Tamil Nadu govt. estimates, 2015'],
  ['106mm/4h', 'the rainfall Nagpur’s Ambazari Lake saw on 23 Sep 2023, before it overflowed into the city', 'IMD-reported figures'],
  ['200+', 'deaths when Texas’s grid failure stopped water treatment, Feb 2021', 'Texas state mortality review'],
] as const

export default function Problem() {
  return (
    <section id="problem" className="section dark">
      <div className="inner">
        <div className="sec-head reveal">
          <span className="eyebrow">The problem</span>
          <h2>One crisis looks like five</h2>
          <p className="sub">
            A flooded drain, a blocked junction, a hospital losing power — each control
            room sees only its own piece. The knock-on failure between them is where
            people actually get hurt, and nobody owns that view.
          </p>
        </div>

        <div className="grid g2">
          <div className="card-d story reveal" style={{ transitionDelay: '.05s' }}>
            <span className="tag">Ambazari Lake spillway &middot; Nagpur, 23 Sep 2023</span>
            <h3>One overflowing lake, forty stressed facilities</h3>
            <p>
              The spillway crosses HIGH RISK at 01:30. Forty minutes later the Nag River
              is rising at three road crossings the city&apos;s own control room has no
              reason to be watching yet.
            </p>
          </div>
          <div className="card-d story reveal" style={{ transitionDelay: '.15s' }}>
            <span className="tag">WakeMed Raleigh Campus &middot; modeled tropical rainfall</span>
            <h3>The hospital finds out last</h3>
            <p>
              In the simulated scenario, three creeks, two junctions and an EMS station
              absorb the stress first. By the time the hospital&apos;s own census climbs,
              the warning that mattered was already 19 hours old.
            </p>
          </div>
        </div>

        <p className="punchline reveal" style={{ transitionDelay: '.1s' }}>
          The flood, the traffic jam and the hospital surge were never separate problems.{' '}
          <em>Nobody had a way to see them as one.</em>
        </p>

        <div className="stats">
          {STATS.map(([n, l, s], i) => (
            <div key={n} className="stat-cell reveal" style={{ transitionDelay: `${i * 0.05}s` }}>
              <div className="n">{n}</div>
              <div className="l">{l}</div>
              <div className="s">{s}</div>
            </div>
          ))}
        </div>

        <p className="src-note reveal">
          Figures above are from public government and IMD reporting on real events.
          Everything else on this page that is modelled or simulated is labelled as such.
        </p>
      </div>
    </section>
  )
}
