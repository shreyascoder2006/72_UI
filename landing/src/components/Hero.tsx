import { TWIN_URL } from '../config'

const BUILT_ON = ['OpenStreetMap', 'IMD', 'Open-Meteo GFS', 'Chronos-Bolt', 'CAP 1.2']

export default function Hero() {
  return (
    <header className="hero">
      {/* served from public/, so the page does not depend on a CDN copy */}
      <video src="/hero.mp4" autoPlay muted loop playsInline />
      <div className="ov1" />
      <div className="ov2" />
      <div className="ov3" />
      <div className="hero-content">
        <span className="hero-eyebrow">Urban digital twin · 72-hour crisis cascade forecasting</span>
        <h1>Weather any storm</h1>
        <p className="hero-sub">
          Horizon 72 is a digital twin of Nagpur and Raleigh that learns how drainage,
          roads, power and hospitals depend on each other — and forecasts how one hazard
          becomes a city-wide crisis, up to 72 hours out.
        </p>
        <div className="hero-ctas">
          <a href={TWIN_URL} className="btn btn-dark">
            Open the twin
          </a>
          <a href="#how" className="btn btn-light">
            See how it works
          </a>
        </div>
      </div>
      <div className="sponsors">
        <p className="label">Built on</p>
        <div className="sponsor-row">
          {BUILT_ON.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
      </div>
    </header>
  )
}
