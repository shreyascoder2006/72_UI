import { GITHUB_URL } from '../config'

const LINKS = [
  ['Problem', '#problem'],
  ['Solution', '#solution'],
  ['How it works', '#how'],
  ['Cities', '#cities'],
  ['Proof', '#proof'],
  ['Roadmap', '#pilot'],
] as const

export default function Footer() {
  return (
    <footer id="contact" className="section dark" style={{ padding: '120px 24px 40px' }}>
      <div className="inner">
        <div className="cta-block reveal">
          <h2>See the cascade before it happens.</h2>
          <p>
            Built for city emergency operations centres, utilities and hospitals who need
            to see a crisis coming, not just arriving.
          </p>
          <div className="cta-btns">
            <a href={GITHUB_URL} className="btn btn-white" target="_blank" rel="noopener">
              View the source
            </a>
            <a href="#how" className="btn btn-ghost">
              See how it works
            </a>
          </div>
        </div>

        <div className="footer-bar">
          <div>
            <span className="wordmark">Horizon 72</span>
            <p className="brand-sub">Urban digital twin &middot; Cascade Intelligence &middot; Nagpur &amp; Raleigh</p>
          </div>
          <div className="footer-links">
            {LINKS.map(([label, href]) => (
              <a key={href} href={href}>
                {label}
              </a>
            ))}
          </div>
        </div>

        <p className="disclaimer">
          Every hazard, sensor reading and outcome in the live twin is simulated for this
          prototype. The city itself &mdash; buildings, streets, rivers &mdash; is real
          OpenStreetMap data, and a historical scenario takes its timing and totals from
          reported figures for the real event.
        </p>
      </div>
    </footer>
  )
}
