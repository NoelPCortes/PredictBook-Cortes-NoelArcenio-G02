import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import LandingPage from '../src/pages/LandingPage'

function renderLandingPage() {
  return renderToStaticMarkup(<MemoryRouter initialEntries={['/']}><LandingPage /></MemoryRouter>)
}

describe('PredictBook landing page', () => {
  it('renders the main heading', () => {
    expect(renderLandingPage()).toMatch(/<h1[^>]*>Fly on the calm days\.<\/h1>/)
  })
  it('renders four feature cards', () => {
    expect(renderLandingPage().match(/<article class="feature-card/g)).toHaveLength(4)
  })
  it('renders exactly 30 calendar days', () => {
    const markup = renderLandingPage()
    expect(markup.match(/class="calendar-day /g)).toHaveLength(30)
    for (let day = 1; day <= 30; day += 1) {
      expect(markup).toContain(`<span>${day}</span><span class="sr-only">`)
    }
    expect(markup.match(/aria-label="Suggested date"/g)).toHaveLength(3)
  })
  it('links Sign in to /signin', () => {
    expect(renderLandingPage()).toMatch(/<a[^>]*href="\/signin"[^>]*>Sign in<\/a>/)
  })
  it('does not render the non-functional flight search form', () => {
    expect(renderLandingPage()).not.toContain('<form')
  })
})
