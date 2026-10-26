import {
  Activity,
  ArrowDown,
  CheckCircle2,
  Database,
  Landmark,
  MapPin,
  PieChart,
  Radio,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useRef } from 'react'

const WAVE = [40, 70, 40, 100, 60, 90, 40, 60, 30, 80, 50, 40, 70, 90, 50]

/** Piecewise-linear ramp: opacity keyframes against scroll progress. */
function ramp(p: number, xs: number[], ys: number[]) {
  if (p <= xs[0]) return ys[0]
  for (let i = 0; i < xs.length - 1; i++) {
    if (p >= xs[i] && p <= xs[i + 1]) {
      const t = (p - xs[i]) / (xs[i + 1] - xs[i])
      return ys[i] + t * (ys[i + 1] - ys[i])
    }
  }
  return ys[ys.length - 1]
}

const PHASES = [
  { xs: [0, 0.25, 0.35], ys: [1, 1, 0] },
  { xs: [0.25, 0.35, 0.6, 0.7], ys: [0, 1, 1, 0] },
  { xs: [0.6, 0.7, 1], ys: [0, 1, 1] },
]

export default function Journey() {
  const gridRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const pulseRef = useRef<HTMLDivElement>(null)
  const phaseRefs = [
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
  ]

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)')

    const onScroll = () => {
      const grid = gridRef.current
      if (!grid) return
      const r = grid.getBoundingClientRect()
      const p = Math.max(0, Math.min(1, (window.innerHeight / 2 - r.top) / r.height))

      if (fillRef.current) fillRef.current.style.transform = `scaleY(${p})`
      if (pulseRef.current) pulseRef.current.style.top = `calc(${(p * 100).toFixed(2)}% - 20px)`

      // Below 1024px the phases stack and are always visible, so leave them alone.
      if (!desktop.matches) return
      PHASES.forEach(({ xs, ys }, i) => {
        const el = phaseRefs[i].current
        if (!el) return
        const v = ramp(p, xs, ys)
        el.style.opacity = String(v)
        el.style.visibility = v <= 0.01 ? 'hidden' : 'visible'
      })
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    onScroll()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section id="how" className="journey-sec">
      <div className="jov1" />
      <div className="jov2" />

      <div className="j-head">
        <div className="sec-head reveal" style={{ padding: '0 24px' }}>
          <span className="eyebrow">How it works</span>
          <h2>Follow one crisis, start to warning.</h2>
          <p className="sub">
            A stressed sensor becomes an explained cascade, a scored forecast and an
            issued warning &mdash; all from the same pipeline. Keep scrolling to watch it
            happen.
          </p>
        </div>
      </div>

      <div className="journey">
        <div className="journey-grid" ref={gridRef}>
          <div className="left-col">
            <div className="timeline">
              <div className="track">
                <div className="fill" ref={fillRef} />
              </div>
              <div className="truck" ref={pulseRef}>
                <Activity size={20} />
              </div>
            </div>

            <div className="step-wrap">
              <div className="step-card frosted reveal-x">
                <div className="step-head">
                  <div className="icon-box">
                    <Radio size={24} color="var(--emerald-700)" />
                  </div>
                  <div>
                    <div className="kicker" style={{ color: 'var(--emerald-700)' }}>
                      Sensor assimilation
                    </div>
                    <h2>Trust every reading.</h2>
                  </div>
                </div>
                <p className="body">
                  Rain gauges, SCADA feeds and camera counts stream in every 30 minutes.
                  A particle filter scores each one by its own residuals &mdash; a frozen
                  gauge or an offline camera loses influence automatically, no one has to
                  notice.
                </p>
                <div className="stat-strip glass-in">
                  <ShieldCheck size={20} color="var(--emerald-600)" />
                  <span>Planted faults caught, zero false flags.</span>
                </div>
              </div>
            </div>

            <div className="step-wrap">
              <div className="step-card frosted reveal-x">
                <div className="step-head">
                  <div className="icon-box">
                    <MapPin size={24} color="var(--blue-700)" />
                  </div>
                  <div>
                    <div className="kicker" style={{ color: 'var(--blue-700)' }}>
                      Dependency graph
                    </div>
                    <h2>Trace the cascade.</h2>
                  </div>
                </div>
                <p className="body">
                  The engine isn&apos;t told which facilities depend on each other &mdash;
                  it learns it, online, from how the readings move together. A stressed
                  creek lights up the junction and the hospital downstream before either
                  would say so on its own.
                </p>
                <div className="stat-strip glass-in">
                  <Database size={20} color="var(--blue-600)" />
                  <span>173 candidate links tracked, no topology given.</span>
                </div>
              </div>
            </div>

            <div className="step-wrap">
              <div className="step-card frosted reveal-x">
                <div className="step-head">
                  <div className="icon-box">
                    <Landmark size={24} color="var(--purple-700)" />
                  </div>
                  <div>
                    <div className="kicker" style={{ color: 'var(--purple-700)' }}>
                      The output
                    </div>
                    <h2>Warn before it lands.</h2>
                  </div>
                </div>
                <p className="body">
                  A CAP 1.2 alert, a segment-checked SMS in the resident&apos;s own
                  language, and a WhatsApp reply to &ldquo;am I safe?&rdquo; &mdash; all
                  generated from the same forecast, issued with hours still on the clock.
                </p>
                <div className="stat-strip glass-in">
                  <CheckCircle2 size={20} color="var(--purple-600)" />
                  <span>16&ndash;23h median lead, replay-validated.</span>
                </div>
              </div>
            </div>
          </div>

          <div className="right-col">
            <div className="sticky-wrap">
              <div className="canvas frosted">
                <div className="dots" />

                <div className="phase" ref={phaseRefs[0]} style={{ zIndex: 10 }}>
                  <div className="phase-inner">
                    <div className="audio-bubble glass-in">
                      <div className="audio-row">
                        <div className="mic-circle">
                          <Radio size={20} />
                        </div>
                        <div className="wave">
                          {WAVE.map((h, i) => (
                            <i
                              key={i}
                              style={
                                { '--h': `${h}%`, '--d': `${i * 0.08}s` } as React.CSSProperties
                              }
                            />
                          ))}
                        </div>
                        <span className="dur">71%</span>
                      </div>
                      <p className="quote">
                        LAK-ABZ &middot; Ambazari Lake spillway &mdash; level rising, 71%
                        of capacity
                      </p>
                    </div>
                  </div>
                </div>

                <div
                  className="phase"
                  ref={phaseRefs[1]}
                  style={{ zIndex: 11, opacity: 0, visibility: 'hidden' }}
                >
                  <div className="phase-inner">
                    <div className="radar-zone">
                      <div className="radar">
                        {[0, 1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className="ring"
                            style={{ '--d': `${i}s` } as React.CSSProperties}
                          />
                        ))}
                        <div className="pin">
                          <MapPin size={32} />
                          <div className="tag">AMBAZARI, NAGPUR</div>
                        </div>
                      </div>
                    </div>
                    <div className="geo-card glass-in">
                      <div className="accent-bar" />
                      <div className="geo-row">
                        <span className="t">CR-NAG-5627 &middot; Urban flood</span>
                        <span className="chip chip-blue">CASCADE DETECTED</span>
                      </div>
                      <div className="status">
                        <div className="dot" />
                        Status: 40 facilities stressed and climbing
                      </div>
                    </div>
                    <div className="cand glass-in">
                      <div>
                        <div className="name">Jhansi Rani Square</div>
                        <div className="meta">Forecast CRITICAL &middot; next in the chain</div>
                      </div>
                      <span className="chip chip-blue">91%</span>
                    </div>
                  </div>
                </div>

                <div
                  className="phase"
                  ref={phaseRefs[2]}
                  style={{ zIndex: 12, opacity: 0, visibility: 'hidden' }}
                >
                  <div className="phase-inner">
                    <div className="p3-head">
                      <div className="who">
                        <div className="icon-box">
                          <Landmark size={24} color="var(--purple-700)" />
                        </div>
                        <div>
                          <div className="name">City EOC</div>
                          <div className="stream">Live situation report</div>
                        </div>
                      </div>
                      <span className="chip-api">CAP 1.2 ISSUED</span>
                    </div>
                    <div className="score-box glass-in">
                      <div className="score-circle">
                        <div>
                          <div className="n">91</div>
                          <div className="l">
                            Forecast
                            <br />
                            confidence
                          </div>
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>
                          Forecast confidence score
                        </div>
                        <div style={{ fontSize: 12, color: '#4b5563', marginTop: 2 }}>
                          Ensemble agreement on the next CRITICAL crossing.
                        </div>
                      </div>
                    </div>
                    <div className="money-grid">
                      <div className="money-card mc-red glass-in">
                        <div className="lbl">
                          <ArrowDown size={16} /> Without warning
                        </div>
                        <div className="val">T+42.5h</div>
                      </div>
                      <div className="money-card mc-green glass-in">
                        <div className="lbl">
                          <CheckCircle2 size={16} /> With Horizon 72
                        </div>
                        <div className="val">T+20.0h</div>
                      </div>
                    </div>
                    <div className="emi glass-in">
                      <div className="emi-head">
                        <div className="t">
                          <PieChart size={16} /> Forecast confidence
                        </div>
                        <span className="chip">High confidence</span>
                      </div>
                      <div className="emi-track">
                        <div className="emi-fill" style={{ width: '91%' }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
