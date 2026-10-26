import { TWIN_URL } from '../config'

const LINKS = [
  ['Problem', '#problem'],
  ['Solution', '#solution'],
  ['How it works', '#how'],
  ['Cities', '#cities'],
  ['Proof', '#proof'],
] as const

export default function Navbar() {
  return (
    <div className="nav-wrap">
      <nav className="nav frosted">
        <span className="wordmark">Horizon 72</span>
        <div className="nav-links">
          {LINKS.map(([label, href]) => (
            <a key={href} href={href}>
              {label}
            </a>
          ))}
        </div>
        <a href={TWIN_URL} className="nav-cta">
          Open the twin
        </a>
      </nav>
    </div>
  )
}
