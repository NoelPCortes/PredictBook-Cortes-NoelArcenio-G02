import { Link } from 'react-router-dom'
import TrafficCalendar from '../components/TrafficCalendar'

const features = [
  ['Flight search', 'Search by starting location, destination, and date. See the airline, departure and arrival times, and open seats.'],
  ['Traffic calendar', 'Expected airport crowd levels, Low, Medium, or High, for different airports and dates.'],
  ['Smart date suggestions', 'Checks crowd levels and open seats to suggest the best dates to fly, and explains why.'],
  ['Staff dashboard', 'Summary charts of upcoming crowd trends and busy travel days.'],
] as const
const steps = [
  ['Search your route', 'Enter where you are flying from, where you are going, and a date.'],
  ['Check the crowds', 'See which days are expected to be Low, Medium, or High at the airport.'],
  ['Pick a suggested date', 'Choose from dates with fewer crowds and open seats, with a short reason for each.'],
] as const

export default function LandingPage() {
  return <>
    <header className="site-header"><nav className="nav-inner" aria-label="Main navigation">
      <a className="brand" href="/"><span className="logo-mark" aria-hidden="true"><i /><i /><i /></span>PredictBook</a>
      <div className="nav-links"><a href="#features">Features</a><a href="#how-it-works">How it works</a><a href="#staff">For staff</a><Link className="button" to="/signin">Sign in</Link></div>
    </nav></header>
    <main className="container">
      <section className="hero" aria-labelledby="hero-title"><div className="hero-copy"><p className="eyebrow">BEST DATE TO TRAVEL</p><h1 id="hero-title">Fly on the calm days.</h1><p className="intro">Search flights, see expected airport crowd levels on a simple calendar, and get suggested dates with open seats.</p></div><TrafficCalendar /></section>
      <section id="features" className="features"><h2>Everything you need to pick a date</h2><div className="feature-grid">{features.map(([title, description], index) => <article className={`feature-card ${index === 3 ? 'staff-card' : ''}`} id={index === 3 ? 'staff' : undefined} key={title}><span className="feature-number">0{index + 1}</span><h3>{title}</h3><p>{description}</p></article>)}</div></section>
      <section id="how-it-works" className="how-it-works"><h2>How it works</h2><div className="steps">{steps.map(([title, description]) => <article key={title}><h3>{title}</h3><p>{description}</p></article>)}</div></section>
    </main>
    <footer className="site-footer"><span>PredictBook: Best Date To Travel</span><span>IT317 Project Management, CIT-U College of Computer Studies</span></footer>
  </>
}
