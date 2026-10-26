const ROWS = [
  { city: 'Nagpur', note: 'Maharashtra, India', facilities: '57', districts: '15', people: '2.94M', hl: true },
  { city: 'Raleigh', note: 'North Carolina, USA', facilities: '44', districts: '12', people: '454K' },
]

export default function Cities() {
  return (
    <section id="cities" className="section light">
      <div className="inner">
        <div className="sec-head reveal">
          <span className="eyebrow">Two cities</span>
          <h2>One engine, two real cities</h2>
        </div>

        <div className="formula-pill reveal">
          <span>Same dependency learner, same 200-member ensemble &mdash; only the geometry and hazards change</span>
        </div>

        <div className="table-wrap reveal" style={{ transitionDelay: '.05s' }}>
          <table className="pricing">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>City</th>
                <th style={{ textAlign: 'right' }}>Facilities</th>
                <th style={{ textAlign: 'right' }}>Districts</th>
                <th style={{ textAlign: 'right' }}>Modeled residents</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.city} className={r.hl ? 'hl' : undefined}>
                  <td style={{ fontWeight: 600 }}>
                    {r.city}
                    <span className="td-note">{r.note}</span>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{r.facilities}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{r.districts}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--accent)' }}>
                    {r.people}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="reveal" style={{ transitionDelay: '.1s' }}>
          <p className="honest">
            <strong>The honest version:</strong> it&apos;s the same dependency learner and
            the same forecast engine in both cities &mdash; only the facilities, street
            geometry and which hazards apply change per city. Seven scenarios run in
            either city with no retuning; a few, like Nagpur&apos;s monsoon reconstruction,
            are written for one city only.
          </p>
          <p className="pricing-disclaimer">
            Modeled population from OpenStreetMap street and building density, scaled to
            each city&apos;s published total. Full facility and district lists are in the
            project&apos;s own data catalogue.
          </p>
        </div>
      </div>
    </section>
  )
}
