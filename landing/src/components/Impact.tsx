const ROWS = [
  ['Median warning lead', 'scored across 10 city/scenario replay runs', '16–23h'],
  ['Detection rate, best case', 'Nagpur, tropical remnant rainfall replay', '96%'],
  ['False alarms, best case', 'Nagpur, monsoon cloudburst replay', '0%'],
  ['Brier skill vs. climatology', 'range across all scored runs', '+0.40–0.81'],
  ['Scenarios run clean', 'both cities, same engine, no retuning', '27'],
  ['Sensor faults caught', 'frozen gauge, offline camera, biased reading', '0 false flags'],
] as const

export default function Impact() {
  return (
    <section id="proof" className="section light">
      <div className="inner">
        <div className="sec-head reveal">
          <span className="eyebrow">Proof &mdash; what we measured</span>
          <h2>Replay-validated, not a demo</h2>
          <p className="sub">
            Historical mode replays all 72 hours. Every forecast uses only data up to its
            own timestamp, then is scored against what the hidden ground truth actually
            did.
          </p>
        </div>
        <div className="impact-list reveal" style={{ transitionDelay: '.05s' }}>
          {ROWS.map(([m, h, t]) => (
            <div className="impact-row" key={m}>
              <div>
                <div className="m">{m}</div>
                <div className="h">{h}</div>
              </div>
              <div className="t">{t}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
