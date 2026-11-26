// @vitest-environment jsdom
import { act } from 'react'
import { readFileSync } from 'node:fs'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearRecentRoutes, saveRecentRoute } from '../src/api/recentRoutes'
import { clearSession, setProfile } from '../src/api/authState'
import { loadAirports, loadAirlines } from '../src/api/lookups'
import { loadFlights, loadForecasts, loadRouteDates } from '../src/api/traffic'
import RoleRoute from '../src/components/RoleRoute'
import TrafficCalendarPage from '../src/features/calendar/TrafficCalendarPage'
import type { Forecast } from '../src/types/traffic'
import { loadDateExplanation, loadDateRecommendations } from '../src/features/calendar/api'
import type { DateExplanation, DateRecommendations } from '../src/features/calendar/types'

const calendarCss=readFileSync('src/components/AirportCalendar.css','utf8').replace("@import './RecordManagement.css';",'')
const selectCss=readFileSync('src/components/SearchableSelect.css','utf8')
const globalCss=readFileSync('src/index.css','utf8')
const fieldCss=readFileSync('src/components/RecordManagement.css','utf8')

vi.mock('../src/api/lookups', () => ({ loadAirports: vi.fn(), loadAirlines: vi.fn() }))
vi.mock('../src/api/traffic', () => ({ loadFlights: vi.fn(), loadForecasts: vi.fn(), loadRouteDates: vi.fn() }))
vi.mock('../src/features/calendar/api', () => ({ loadDateExplanation: vi.fn(), loadDateRecommendations: vi.fn() }))
const recommendations: DateRecommendations = {
  route: null,
  selected: { date: '2026-01-14', has_data: true, crowd_score: 80, crowd_level: 'high' },
  selected_status: { state: 'bookable', message: '' },
  recommendations: [15, 16, 17].map(day => ({ date: `2026-01-${day}`, weekday: ['Thursday', 'Friday', 'Saturday'][day - 15]!, crowd_level: 'low', crowd_score: 40, score_difference: 40, open_seats: 60, flight_count: 2, history_average_occupancy_percent: 50, flights: [], reasons: ['60 seats are open on 1 departing flights.'] })), message: '',
}
const explanation: DateExplanation = {
  airport: { id: 1, code: 'CEB', name: 'Cebu' }, date: '2026-01-14', weekday: 'Wednesday', has_data: true,
  flights: { count: 2, departing_count: 1, arriving_count: 1, seats_total: 200, seats_booked: 80, occupancy_percent: 40 },
  history: { used_dates: ['2025-01-15'], records: [], average_occupancy_percent: 60 }, weights: { flights: 50, history: 50 }, thresholds: { medium_from: 50, high_from: 75 },
  crowd_score: 50, crowd_level: 'medium', history_available: true, open_seats: 60, sentences: ['The combined score is 50.0, which is Medium.'],
}
const airports = [
  { id: 1, code: 'CEB', name: 'Cebu', city: 'Cebu', country: 'Philippines' },
  { id: 2, code: 'MNL', name: 'Manila', city: 'Manila', country: 'Philippines' },
]
const forecast = (day: number, level: Forecast['crowd_level']): Forecast => ({ id: day, airport: 1, date: `2026-01-${String(day).padStart(2, '0')}`, crowd_level: level, crowd_score: null, is_calculated: false, flight_count: 2, seats_total: 180, seats_booked: 124, calculated_at: '2026-01-01T00:00:00Z', data_source: 'Staff entry' })
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  clearRecentRoutes(1)
  vi.mocked(loadRouteDates).mockReset().mockResolvedValue([{ date: '2026-01-14', flight_count: 2, open_seats: 100 }])
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-14T04:00:00Z'))
  vi.mocked(loadAirlines).mockReset().mockResolvedValue([{id:1,name:'Airline',code:'PR'}])
  vi.mocked(loadAirports).mockReset().mockResolvedValue(airports)
  vi.mocked(loadForecasts).mockReset().mockResolvedValue([forecast(14, 'low'), forecast(15, 'medium'), forecast(16, 'high')])
  vi.mocked(loadFlights).mockReset().mockResolvedValue([{
    direction: 'departing',
    id: 7, airline: 1, airline_name: 'Philippine Airlines', airline_code: 'PR', flight_number: '100', origin: 1, origin_code: 'CEB', origin_name: 'Cebu', destination: 2, destination_code: 'MNL', destination_name: 'Manila', departure_time: '2026-01-14T00:00:00Z', arrival_time: '2026-01-14T01:30:00Z', total_seats: 180, available_seats: 25,
  }])
  vi.mocked(loadDateExplanation).mockReset().mockResolvedValue(explanation)
  vi.mocked(loadDateRecommendations).mockReset().mockResolvedValue({ ...recommendations, recommendations: [], message: 'No flights with open seats were found within 7 days of 2026-01-14.' })
  setProfile({ id: 1, username: 'traveler', email: 'traveler@example.com', role: 'traveler', first_name: '', last_name: '' })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); clearSession(); clearRecentRoutes(1); vi.useRealTimers() })
async function render() {
  await act(async () => root.render(<MemoryRouter initialEntries={['/calendar']}><Routes>
    <Route path="/calendar" element={<RoleRoute allowedRoles={['traveler']}><TrafficCalendarPage /></RoleRoute>} />
    <Route path="/staff/dashboard" element={<p>Staff dashboard</p>} /><Route path="/head" element={<p>Head management</p>} /><Route path="/signin" element={<p>Sign in</p>} />
  </Routes></MemoryRouter>))
}
function day(day: number) { return container.querySelector<HTMLButtonElement>(`button[aria-label^="January ${day},"]`)! }
async function click(selector: string) { await act(async () => container.querySelector<HTMLButtonElement>(selector)!.click()) }
async function changeAirport(value: string) {
  await click('#record-calendar-airport')
  await click(`[role="option"][data-value="${value}"]`)
}

it('loads one airport, API crowd levels, no-data dates and actual weekdays', async () => {
  await render()
  expect(loadForecasts).toHaveBeenCalledWith({ airport: '1', month: '2026-01' })
  expect(loadFlights).toHaveBeenCalledWith({ airport: '1', date: '2026-01-14', page: 1, page_size: 4 })
  expect(container.querySelectorAll('.airport-day-grid button')).toHaveLength(31)
  expect([...container.querySelector('.airport-day-grid')!.children].indexOf(day(1))).toBe(11)
  expect(day(14).classList.contains('low')).toBe(true)
  expect(day(15).classList.contains('medium')).toBe(true)
  expect(day(16).classList.contains('high')).toBe(true)
  expect(day(17).getAttribute('aria-label')).toBe('January 17, 2026, No data')
  expect(day(14).getAttribute('aria-current')).toBe('date')
  expect(day(14).getAttribute('aria-pressed')).toBe('true')
  expect(container.querySelector('.legend')?.textContent).toBe('LowMediumHighNo data')
  expect(container.querySelector('[role=combobox]')?.textContent).not.toContain('All Airports')
})
it('shows selected crowd level and flights with PNG time and seat icons', async () => {
  await render()
  const panel = container.querySelector('.airport-date-details')!
  expect(panel.querySelector('.record-crowd-chip')?.textContent).toBe('Low crowd')
  expect(panel.textContent).toContain('Philippine Airlines (PR) · 100')
  expect(panel.textContent).toContain('CEB — Cebu → MNL — Manila')
  expect(panel.textContent).toContain('08:00')
  expect(panel.textContent).toContain('25 open seats / 180 total seats')
  expect(panel.querySelector('img[src*="ClockIcon"]')).not.toBeNull()
  expect(panel.querySelector('img[src*="SeatIcon"]')).not.toBeNull()
  expect(container.querySelector('svg')).toBeNull()
})
it('selects a no-data day and shows the empty flight message', async () => {
  await render(); vi.mocked(loadFlights).mockResolvedValue([])
  await act(async () => day(17).click())
  expect(loadFlights).toHaveBeenLastCalledWith({ airport: '1', date: '2026-01-17', page: 1, page_size: 4 })
  expect(container.querySelector('.airport-date-details .record-crowd-chip')?.textContent).toBe('No data')
  expect(container.textContent).toContain('No flights listed for this date.')
})
it('renders the real breakdown, history dates, and strict flight directions', async () => {
  const departing = (await loadFlights())[0]!
  vi.mocked(loadFlights).mockResolvedValue([departing, { ...departing, id: 8, direction: 'arriving' }])
  await render()
  expect(loadDateExplanation).toHaveBeenCalledWith('1', '2026-01-14')
  expect(container.querySelector('.calendar-flight-list')?.textContent).toContain('Departing')
  expect(container.querySelector('.calendar-flight-list')?.textContent).toContain('Arriving')
  const details = container.querySelector('.calendar-breakdown')!
  expect(details.textContent).toContain('Why this level')
  expect(details.textContent).toContain('80 of 200 seats; 40.0%')
  expect(details.textContent).toContain('January 15, 2025')
  expect(details.textContent).toContain('60.0%')
  expect(details.querySelector('img[src*="info-circleIcon"]')).not.toBeNull()
  await act(async () => day(15).click())
  expect(loadDateExplanation).toHaveBeenLastCalledWith('1', '2026-01-15')
  await changeAirport('2')
  expect(loadDateExplanation).toHaveBeenLastCalledWith('2', '2026-01-15')
  await click('[aria-label="Next month"]')
  expect(loadDateExplanation).toHaveBeenLastCalledWith('2', '2026-02-01')
})
it('shows no-history and no-data breakdown states from the API', async () => {
  vi.mocked(loadDateExplanation).mockResolvedValue({ ...explanation, history_available: false, history: { used_dates: [], records: [], average_occupancy_percent: null }, sentences: ['No 2025 history is available for this date, so the score uses 2026 flights only.'] })
  await render()
  expect(container.textContent).toContain('No 2025 history is available for this date')
  vi.mocked(loadDateExplanation).mockResolvedValue({ ...explanation, has_data: false, crowd_score: null, crowd_level: null, sentences: [] })
  await act(async () => day(17).click())
  expect(container.textContent).toContain('No calculated forecast: no flights with seat data for this date.')
})
it('handles breakdown loading, request errors, and retry', async () => {
  vi.mocked(loadDateExplanation).mockReturnValueOnce(new Promise(() => {}))
  await render()
  expect(container.textContent).toContain('Loading level breakdown')
  vi.mocked(loadDateExplanation).mockRejectedValueOnce(new Error('Offline'))
  await act(async () => day(15).click())
  expect(container.querySelector('.calendar-breakdown [role="alert"]')).not.toBeNull()
  await click('.calendar-breakdown button')
  expect(container.querySelector('.calendar-breakdown table')).not.toBeNull()
})
it('renders up to three recommendations and selects a card date with fresh requests', async () => {
  vi.mocked(loadDateRecommendations).mockResolvedValue(recommendations)
  await render()
  expect(loadDateRecommendations).toHaveBeenCalledWith('1', '2026-01-14')
  expect(container.querySelectorAll('.calendar-recommendation-card')).toHaveLength(3)
  expect(container.querySelector('.calendar-recommendations')?.textContent).toContain('40.0 points lower than your selected date')
  expect(container.querySelector('.calendar-recommendations')?.textContent).toContain('60 open seats')
  expect(container.querySelector('.calendar-recommendations img[src*="bulbIcon"]')).not.toBeNull()
  vi.mocked(loadDateRecommendations).mockResolvedValue({ ...recommendations, recommendations: [], message: 'No flights with open seats were found within 7 days of 2026-01-15.' })
  await click('.calendar-recommendation-card')
  expect(day(15).getAttribute('aria-pressed')).toBe('true')
  expect(loadDateRecommendations).toHaveBeenLastCalledWith('1', '2026-01-15')
  expect(loadDateExplanation).toHaveBeenLastCalledWith('1', '2026-01-15')
  expect(loadFlights).toHaveBeenLastCalledWith({ airport: '1', date: '2026-01-15', page: 1, page_size: 4 })
  expect(container.querySelectorAll('.calendar-recommendation-card')).toHaveLength(0)
})
it('shows fewer dates and missing-selected-data messages without a score comparison', async () => {
  vi.mocked(loadDateRecommendations).mockResolvedValue({ ...recommendations, selected: { date: '2026-01-14', has_data: false, crowd_score: null, crowd_level: null }, recommendations: [{ ...recommendations.recommendations[0]!, score_difference: null }], message: 'Only 1 qualifying date is available within 7 days of 2026-01-14.' })
  await render()
  const section = container.querySelector('.calendar-recommendations')!
  expect(section.textContent).toContain('Your selected date has no forecast.')
  expect(section.textContent).toContain('Only 1 qualifying date is available')
  expect(section.textContent).not.toContain('points lower than your selected date')
  expect(section.querySelectorAll('.calendar-recommendation-card')).toHaveLength(1)
})
it.each([
  ['full', 'All flights on this date are full.'],
  ['departed', 'All flights on this date have already departed.'],
  ['no_flights', 'No flights are scheduled for this date.'],
] as const)('shows the %s flight status under the selected date and before recommendations', async (state, message) => {
  vi.mocked(loadDateRecommendations).mockResolvedValueOnce({ ...recommendations, selected_status: { state, message } })
  await render()
  const status = container.querySelector('.airport-date-details h3 + .selected-flight-status')!
  const alternatives = container.querySelector('.calendar-recommendations')!
  expect(status.textContent).toBe(message)
  expect(status.compareDocumentPosition(alternatives) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(alternatives.querySelectorAll('.calendar-recommendation-card')).toHaveLength(3)
  expect(loadDateRecommendations).toHaveBeenCalledOnce()
  await act(async () => day(15).click())
  expect(container.querySelector('.selected-flight-status')).toBeNull()
})

it('labels Low and Medium recommendations and displays the backend reasons', async () => {
  const low = { ...recommendations.recommendations[0]!, reasons: ['This day has a Low crowd level (score 40.0).'] }
  const medium = { ...recommendations.recommendations[1]!, crowd_level: 'medium' as const, crowd_score: 60, reasons: ['This day has a Medium crowd level, moderate congestion (score 60.0).'] }
  vi.mocked(loadDateRecommendations).mockResolvedValue({ ...recommendations, recommendations: [low, medium] })
  await render()
  const cards = [...container.querySelectorAll('.calendar-recommendation-card')]
  expect(cards.map(card => card.querySelector('.record-crowd-chip')?.textContent)).toEqual(['Low crowd', 'Medium crowd'])
  expect(cards[0]?.textContent).toContain(low.reasons[0])
  expect(cards[1]?.textContent).toContain(medium.reasons[0])
})

it('shows the end of the flight schedule for a selected date in 2027', async () => {
  vi.setSystemTime(new Date('2026-12-15T04:00:00Z'))
  await render()
  vi.mocked(loadDateRecommendations).mockResolvedValue({
    ...recommendations,
    selected: { date: '2027-01-01', has_data: false, crowd_score: null, crowd_level: null },
    selected_status: { state: 'no_flights', message: 'No flights are scheduled for this date.' },
    recommendations: [],
    message: 'No flights with open seats were found within 7 days of 2027-01-01. Scheduled flights end on 2026-12-31.',
  })
  await click('[aria-label="Next month"]')
  expect(loadDateRecommendations).toHaveBeenLastCalledWith('1', '2027-01-01')
  expect(container.querySelector('.airport-date-details h3')?.textContent).toBe('January 1, 2027')
  expect(container.querySelector('.selected-flight-status')?.textContent).toBe('No flights are scheduled for this date.')
  expect(container.querySelector('.calendar-recommendations')?.textContent).toContain('Scheduled flights end on 2026-12-31.')
  expect(container.querySelectorAll('.calendar-recommendation-card')).toHaveLength(0)
})
it('handles recommendation loading, errors and retry', async () => {
  vi.mocked(loadDateRecommendations).mockReturnValueOnce(new Promise(() => {}))
  await render()
  expect(container.textContent).toContain('Loading recommended dates')
  vi.mocked(loadDateRecommendations).mockRejectedValueOnce(new Error('Offline'))
  await act(async () => day(15).click())
  expect(container.querySelector('.calendar-recommendations [role="alert"]')).not.toBeNull()
  await click('.calendar-recommendations .calendar-text-button')
  expect(container.querySelector('.calendar-recommendations [role="alert"]')).toBeNull()
})
it('recommendations update across airport and month changes', async () => {
  await render(); await changeAirport('2')
  expect(loadDateRecommendations).toHaveBeenLastCalledWith('2', '2026-01-14')
  await click('[aria-label="Next month"]')
  expect(loadDateRecommendations).toHaveBeenLastCalledWith('2', '2026-02-01')
})
it('changes airports without losing the selected date or exposing old flights', async () => {
  await render(); vi.mocked(loadFlights).mockResolvedValue([]); vi.mocked(loadForecasts).mockResolvedValue([])
  await changeAirport('2')
  expect(loadForecasts).toHaveBeenLastCalledWith({ airport: '2', month: '2026-01' })
  expect(loadFlights).toHaveBeenLastCalledWith({ airport: '2', date: '2026-01-14', page: 1, page_size: 4 })
  expect(container.querySelector('.calendar-flight-list')).toBeNull()
})
it('enables month navigation and handles year boundaries and leap years', async () => {
  await render()
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Next month"]')?.disabled).toBe(false)
  await click('[aria-label="Next month"]')
  expect(loadForecasts).toHaveBeenLastCalledWith({ airport: '1', month: '2026-02' })
  expect(container.querySelectorAll('.airport-day-grid button')).toHaveLength(28)
  await click('[aria-label="Previous month"]'); await click('[aria-label="Previous month"]')
  expect(loadForecasts).toHaveBeenLastCalledWith({ airport: '1', month: '2025-12' })
})
it('uses project UTC today across the Philippine day boundary', async () => {
  vi.setSystemTime(new Date('2026-01-13T17:00:00Z')); await render()
  expect(loadFlights).toHaveBeenCalledWith({ airport: '1', date: '2026-01-13', page: 1, page_size: 4 })
})
it('renders February 29 in a leap year with Tuesday alignment for February 1', async () => {
  vi.setSystemTime(new Date('2028-02-15T04:00:00Z')); await render()
  expect(container.querySelectorAll('.airport-day-grid button')).toHaveLength(29)
  const first = container.querySelector('button[aria-label^="February 1,"]')!
  expect([...container.querySelector('.airport-day-grid')!.children].indexOf(first)).toBe(9)
})
it('shows request errors distinctly from empty data and permits retry', async () => {
  vi.mocked(loadForecasts).mockRejectedValueOnce(new TypeError('Offline'))
  vi.mocked(loadFlights).mockRejectedValueOnce(new TypeError('Offline'))
  await render()
  expect(container.querySelectorAll('[role="alert"]')).toHaveLength(2)
  expect(day(14).getAttribute('aria-label')).toContain('Forecast unavailable')
  expect(container.textContent).not.toContain('No flights listed for this date.')
  await click('.airport-calendar-month .calendar-text-button')
  await click('.airport-date-details .calendar-text-button')
  expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0)
})
it('does not show stale results after switching airport during a request', async () => {
  let resolveOld: (records: Forecast[]) => void = () => {}
  vi.mocked(loadForecasts).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
  await render(); await changeAirport('2')
  vi.mocked(loadForecasts).mockResolvedValue([])
  await act(async () => resolveOld([forecast(14, 'high')]))
  expect(day(14).classList.contains('high')).toBe(false)
})
it('handles missing airports and lookup failures', async () => {
  vi.mocked(loadAirports).mockResolvedValue([]); await render()
  expect(container.textContent).toContain('No airports available.')
  expect(loadFlights).not.toHaveBeenCalled()
})
it('allows airport lookup retry', async () => {
  vi.mocked(loadAirports).mockRejectedValueOnce(new TypeError('Offline')); await render()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to load airports')
  await click('.calendar-text-button'); expect(container.querySelector('[role=combobox]')).not.toBeNull()
})
it.each(['staff', 'head', null] as const)('guards calendar access for %s', async role => {
  if (role) setProfile({ id: 1, username: role, email: `${role}@example.com`, role, first_name: '', last_name: '' })
  else clearSession()
  await render()
  expect(loadAirports).not.toHaveBeenCalled()
  expect(container.textContent).toBe(role === 'staff' ? 'Staff dashboard' : role === 'head' ? 'Head management' : 'Sign in')
})

it('places recommendations in the sidebar and filters flights only by airline', async () => {
  await render()
  const recommendation = container.querySelector('.calendar-recommendations')!
  const month = container.querySelector('.airport-calendar-month')!
  expect(recommendation.closest('.traffic-calendar-sidebar')).not.toBeNull()
  expect(month.closest('.traffic-calendar-main')).not.toBeNull()
  expect(container.textContent).toContain('Crowd levels are per airport. The airline filter only changes the flight list.')
  const explanations = vi.mocked(loadDateExplanation).mock.calls.length
  const suggestions = vi.mocked(loadDateRecommendations).mock.calls.length
  await click('#record-calendar-airline'); await click('[role=option][data-value="1"]')
  expect(loadFlights).toHaveBeenLastCalledWith({airport:'1',date:'2026-01-14',airline:'1',page:1,page_size:4})
  expect(loadDateExplanation).toHaveBeenCalledTimes(explanations)
  expect(loadDateRecommendations).toHaveBeenCalledTimes(suggestions)
  const panel=container.querySelector('.airport-date-details')!
  expect(panel.querySelector('.calendar-flight-list')!.compareDocumentPosition(panel.querySelector('.calendar-breakdown')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})
it('selects today when navigating back into the current month', async () => {
  await render(); await click('[aria-label="Next month"]'); await click('[aria-label="Previous month"]')
  expect(day(14).getAttribute('aria-pressed')).toBe('true')
})


it('uses saved bookings for airport, highlights, strict route flights and recommendations', async () => {
  saveRecentRoute(1, {origin: '2', destination: '1'})
  await render()
  await click('#record-calendar-booking'); await click('[role=option][data-value="2/1"]')
  expect(container.querySelector('#record-calendar-airport')?.textContent).toContain('MNL')
  expect(container.textContent).toContain('Booking: MNL to CEB')
  expect(loadRouteDates).toHaveBeenLastCalledWith('2', '1', '2026-01')
  expect(loadFlights).toHaveBeenLastCalledWith({airport: '2', origin: '2', destination: '1', date: '2026-01-14', page: 1, page_size: 4})
  expect(loadDateRecommendations).toHaveBeenLastCalledWith('2', '2026-01-14', '1')
  expect(day(14).classList.contains('route-highlight')).toBe(true)
  expect(day(15).getAttribute('aria-label')).toContain('No flights on this route')
  await click('#record-calendar-airline'); await click('[role=option][data-value="1"]')
  expect(loadFlights).toHaveBeenLastCalledWith(expect.objectContaining({origin:'2',destination:'1',airline:'1',page:1,page_size:4}))
  await changeAirport('1')
  expect(container.textContent).not.toContain('Booking: MNL to CEB')
  expect(container.querySelector('#record-calendar-booking')?.textContent).toContain('No booking')
  expect(loadDateRecommendations).toHaveBeenLastCalledWith('1', '2026-01-14')
  expect(day(14).classList.contains('route-highlight')).toBe(false)
})
it('keeps No booking usable without saved routes and clears an active booking', async () => {
  await render()
  expect(container.textContent).toContain('No saved bookings yet. Search flights on Home.')
  await click('#record-calendar-booking')
  expect(container.querySelectorAll('[role=option]')).toHaveLength(1)
  await click('[role=option][data-value=""]')
  expect(container.querySelector('.traffic-calendar-sidebar.traffic-calendar-controls')).not.toBeNull()
  expect(container.querySelector('.traffic-calendar-main .airport-calendar-month')).not.toBeNull()
})
it('appends four flights and resets the list when the selected date changes', async () => {
  const original = (await loadFlights())[0]!
  vi.mocked(loadFlights).mockImplementation(async filters => Object.assign(Array.from({length:4}, (_, index)=>({...original,id:(filters?.page === 2 ? 4 : 0)+index})),{count:8,next:filters?.page === 2 ? null : '?page=2'}))
  await render()
  expect(container.querySelectorAll('.calendar-flight-list li')).toHaveLength(4)
  const more = () => [...container.querySelectorAll<HTMLButtonElement>('.airport-date-details button')].find(button=>button.textContent==='See more')!
  await act(async()=>more().click())
  expect(loadFlights).toHaveBeenLastCalledWith({airport:'1',date:'2026-01-14',page:2,page_size:4})
  expect(container.querySelectorAll('.calendar-flight-list li')).toHaveLength(8)
  expect(container.textContent).toContain('Showing 8 of 8 flights')
  expect(more()).toBeUndefined()
  await act(async()=>day(15).click())
  expect(container.querySelectorAll('.calendar-flight-list li')).toHaveLength(4)
  expect(loadFlights).toHaveBeenLastCalledWith({airport:'1',date:'2026-01-15',page:1,page_size:4})
})
it('shows the recommendation flight previews and selects their date', async () => {
  vi.mocked(loadDateRecommendations).mockResolvedValue({...recommendations, recommendations:[{...recommendations.recommendations[0]!,flights:[{airline_name:'Airline',airline_code:'PR',flight_number:'123',origin_code:'CEB',destination_code:'MNL',departure_time:'2026-01-15T00:00:00Z',available_seats:60}]}]})
  await render()
  const section=container.querySelector('.calendar-recommendations')!
  expect(section.textContent).toContain('Airline (PR) 123')
  expect(section.textContent).toContain('CEB to MNL')
  expect(section.querySelector('img[src*="ClockIcon"]')).not.toBeNull()
  expect(section.querySelector('img[src*="SeatIcon"]')).not.toBeNull()
  await click('.calendar-recommendation-card')
  expect(day(15).getAttribute('aria-pressed')).toBe('true')
})
it('ignores an old See more response after leaving and returning to the same date', async () => {
  const original = (await loadFlights())[0]!
  const first = Object.assign(Array.from({length:4}, (_,index)=>({...original,id:index})),{count:8,next:'?page=2'})
  let finish: (rows: typeof first) => void = () => {}
  vi.mocked(loadFlights).mockImplementation(async filters => filters?.page === 2 ? new Promise(resolve=>{finish=resolve}) : first)
  await render()
  await act(async()=>[...container.querySelectorAll<HTMLButtonElement>('.airport-date-details button')].find(button=>button.textContent==='See more')!.click())
  await act(async()=>day(15).click())
  await act(async()=>day(14).click())
  await act(async()=>finish(Object.assign(first.map(flight=>({...flight,id:flight.id+4})),{count:8,next:null})))
  expect(container.querySelectorAll('.calendar-flight-list li')).toHaveLength(4)
  expect(container.textContent).toContain('Showing 4 of 8 flights')
})
it('restores the normal page and heading without changing the calendar card', async () => {
  await render()
  expect(container.querySelector('.traffic-calendar-page, .traffic-calendar-title')).toBeNull()
  expect(container.querySelector('.app-header')).not.toBeNull()
  const main = container.querySelector('main.record-page')!
  expect(main.querySelector(':scope > h1')?.textContent).toBe('Traffic Calendar')
  expect(main.querySelector(':scope > h1')?.className).toBe('')
  expect(main.querySelector(':scope > .airport-calendar')).not.toBeNull()
  expect(container.querySelectorAll('.airport-calendar')).toHaveLength(1)
  expect(main.querySelector('.traffic-calendar-sidebar .calendar-recommendations')).not.toBeNull()
  expect(main.querySelector('.traffic-calendar-main .calendar-breakdown')).not.toBeNull()
  expect(main.querySelector('.airport-date-details .record-crowd-chip')?.textContent).toBe('Low crowd')
  expect(main.querySelectorAll('.calendar-flight-list li')).toHaveLength(1)
  expect(document.body.classList.contains('traffic-calendar-page')).toBe(false)
})
it('joins navy sections into an unscrolled edge-to-edge desktop column with narrow grid areas', async () => {
  const sheet=document.createElement('style')
  sheet.textContent=globalCss+fieldCss+calendarCss+selectCss
  document.head.append(sheet)
  try {
    const mediaRules=[...sheet.sheet!.cssRules].filter((rule): rule is CSSMediaRule=>rule.type===CSSRule.MEDIA_RULE)
    const narrow=mediaRules.find(rule=>rule.conditionText==='(max-width: 1100px)')!
    expect(narrow).toBeDefined()
    const narrowGrid=[...narrow.cssRules].find((rule): rule is CSSStyleRule=>'selectorText' in rule && rule.selectorText==='.traffic-calendar-grid')!
    // Apply each layout explicitly because jsdom does not provide browser viewport layout.
    for(let index=sheet.sheet!.cssRules.length-1;index>=0;index--) {
      if(sheet.sheet!.cssRules[index]!.type===CSSRule.MEDIA_RULE) sheet.sheet!.deleteRule(index)
    }
    await render()
    const card=container.querySelector<HTMLElement>('.airport-calendar-sidebar-card')!
    const grid=card.querySelector<HTMLElement>('.traffic-calendar-grid')!
    const controls=grid.querySelector<HTMLElement>('.traffic-calendar-controls')!
    const main=grid.querySelector<HTMLElement>('.traffic-calendar-main')!
    const suggestions=grid.querySelector<HTMLElement>('.traffic-calendar-suggestions')!
    expect([...grid.children]).toEqual([controls,main,suggestions])
    expect(getComputedStyle(card).padding).toBe('0px')
    expect(getComputedStyle(grid).gap).toMatch(/^0(px)?$/)
    expect(getComputedStyle(grid).gridTemplateAreas).toBe('"main controls" "main suggestions"')
    for(const panel of [controls,suggestions]) {
      expect(panel.classList.contains('traffic-calendar-navy-panel')).toBe(true)
      expect(getComputedStyle(panel).position).not.toBe('sticky')
      expect(getComputedStyle(panel).maxHeight).toBe('none')
      expect(getComputedStyle(panel).overflow).toBe('visible')
    }
    expect(getComputedStyle(controls).gridArea).toBe('controls')
    expect(getComputedStyle(main).gridArea).toBe('main')
    expect(getComputedStyle(suggestions).gridArea).toBe('suggestions')
    expect(narrowGrid.style.getPropertyValue('grid-template-areas')).toBe('"controls" "main" "suggestions"')
    sheet.sheet!.insertRule(narrowGrid.cssText,sheet.sheet!.cssRules.length)
    expect(getComputedStyle(grid).gridTemplateAreas).toBe('"controls" "main" "suggestions"')
    expect([...grid.children]).toEqual([controls,main,suggestions])
    expect(controls.querySelectorAll('[role=combobox]')).toHaveLength(3)
    expect(suggestions.querySelectorAll('.calendar-recommendations')).toHaveLength(1)
    expect(main.querySelector('.calendar-breakdown')).not.toBeNull()
  } finally { sheet.remove() }
})
it('uses navy fields and white panel icons while the opened airport list stays light', async () => {
  const sheet=document.createElement('style')
  sheet.textContent=globalCss+fieldCss+calendarCss+selectCss
  document.head.append(sheet)
  try {
    await render()
    const controls=container.querySelector('.traffic-calendar-controls')!
    expect(controls.querySelectorAll('.record-field-navy')).toHaveLength(3)
    for(const field of controls.querySelectorAll('.record-field-navy')) {
      expect(getComputedStyle(field).backgroundColor).toBe('rgba(0, 0, 0, 0)')
      expect(getComputedStyle(field).borderTopColor).toBe('rgb(213, 220, 230)')
      expect(getComputedStyle(field.querySelector('label')!).color).toBe('rgb(219, 234, 254)')
      expect(getComputedStyle(field.querySelector('[role=combobox]')!).color).toBe('rgb(255, 255, 255)')
      expect(getComputedStyle(field.querySelector('img')!).filter).toBe('brightness(0) invert(1)')
      expect(field.querySelector('[role=combobox] img.navy-white-icon')).not.toBeNull()
    }
    expect(container.querySelector('.calendar-recommendations h2 img.navy-white-icon')).not.toBeNull()
    await click('#record-calendar-airport')
    const popover=controls.querySelector('.searchable-popover')!
    expect(getComputedStyle(popover).color).toBe('rgb(15, 27, 45)')
    expect(getComputedStyle(popover).backgroundColor).toBe('rgb(255, 255, 255)')
    const search=popover.querySelector<HTMLInputElement>('input')!
    expect(document.activeElement).toBe(search)
    expect(popover.querySelector('img.navy-white-icon')).toBeNull()
    await click('[role=option][data-value="2"]')
    expect(loadFlights).toHaveBeenLastCalledWith({airport:'2',date:'2026-01-14',page:1,page_size:4})
  } finally { sheet.remove() }
})
it('keeps the readable booking chip and Clear within the navy controls', async () => {
  saveRecentRoute(1,{origin:'1',destination:'2'})
  await render()
  await click('#record-calendar-booking'); await click('[role=option][data-value="1/2"]')
  expect(container.querySelector('.traffic-calendar-controls .calendar-booking-chip')?.textContent).toContain('Booking: CEB to MNL')
  await click('.calendar-booking-chip button')
  expect(container.querySelector('.calendar-booking-chip')).toBeNull()
  expect(container.querySelector('#record-calendar-booking')?.textContent).toContain('No booking')
  expect(day(14).classList.contains('route-highlight')).toBe(false)
})
