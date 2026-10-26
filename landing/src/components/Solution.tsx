export default function Solution() {
  return (
    <section id="solution" className="section light">
      <div className="inner">
        <div className="sec-head reveal">
          <span className="eyebrow">The solution</span>
          <h2>One engine. Two outputs.</h2>
          <p className="sub">
            No structure is handed to the engine and no fleet of new sensors is needed.
            It learns the city&apos;s own dependency graph from the data already flowing,
            then turns that into a warning before the facility goes critical.
          </p>
        </div>

        <div className="grid g2">
          <div className="card-l reveal" style={{ transitionDelay: '.05s' }}>
            <span className="dir-pill">See it</span>
            <h3>Engine A &mdash; Learn the dependency graph</h3>
            <p className="body">
              A sparse Bayesian regression watches how readings move together, online,
              with no topology given. 173 candidate links are tested; each is confirmed,
              pruned, or left as a candidate on the evidence alone.
            </p>
            <p className="fix">
              Fixes blind spots &mdash; a flooded creek&apos;s effect on a hospital becomes
              visible, not assumed.
            </p>
          </div>
          <div className="card-l reveal" style={{ transitionDelay: '.15s' }}>
            <span className="dir-pill">Act on it</span>
            <h3>Engine B &mdash; Forecast and warn</h3>
            <p className="body">
              A 200-member ensemble forecasts every facility 72 hours ahead. The same
              forecast issues a CAP 1.2 alert, a segment-checked SMS, and a WhatsApp
              reply to &ldquo;am I safe?&rdquo; in the resident&apos;s own language.
            </p>
            <p className="fix">
              Fixes late warnings &mdash; alerts go out 16&ndash;23 hours before, not after.
            </p>
          </div>
        </div>

        <div className="wins reveal" style={{ transitionDelay: '.15s' }}>
          <span>Earlier warnings</span>
          <span>Local-language alerts</span>
          <span>Explainable, not a black box</span>
          <span>Replay-validated, not a demo</span>
        </div>
      </div>
    </section>
  )
}
