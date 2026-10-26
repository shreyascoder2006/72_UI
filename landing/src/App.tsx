import Benefits from './components/Benefits'
import Cities from './components/Cities'
import Footer from './components/Footer'
import Hero from './components/Hero'
import Impact from './components/Impact'
import Journey from './components/Journey'
import Navbar from './components/Navbar'
import Problem from './components/Problem'
import Roadmap from './components/Roadmap'
import Solution from './components/Solution'
import { useReveal } from './useReveal'
import './index.css'

export default function App() {
  useReveal()
  return (
    <>
      <Navbar />
      <Hero />
      <Problem />
      <Solution />
      <Journey />
      <Cities />
      <Benefits />
      <Impact />
      <Roadmap />
      <Footer />
    </>
  )
}
