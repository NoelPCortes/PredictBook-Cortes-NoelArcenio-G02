// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearSession, setProfile } from '../src/api/authState'
import { ApiError } from '../src/api/client'
import RoleRoute from '../src/components/RoleRoute'
import ForecastFormPage from '../src/features/calendar/ForecastFormPage'
import ForecastListPage from '../src/features/calendar/ForecastListPage'
import { createForecast, deleteForecast, getForecast, loadForecastAirports, loadForecastFlights, loadForecastList, updateForecast } from '../src/features/calendar/api'
import { records } from '../src/api/pagination'
import type { Flight } from '../src/types/flights'
import type { Forecast } from '../src/types/traffic'

vi.mock('../src/features/calendar/api', () => ({ createForecast: vi.fn(), deleteForecast: vi.fn(), updateForecast: vi.fn(), getForecast: vi.fn(), loadForecastAirports: vi.fn(), loadForecastFlights: vi.fn(), loadForecastList: vi.fn() }))
const forecast: Forecast = { id: 7, airport: 1, date: '2026-12-01', crowd_level: 'low', crowd_score: null, is_calculated: false, flight_count: 2, seats_total: 180, seats_booked: 124, calculated_at: '2026-11-16T00:00:00Z', data_source: 'Staff entry', created_by_username: 'staff', can_edit: true, can_delete: true }
const calculatedForecast = { ...forecast, is_calculated: true, can_delete: false, created_by_username: null, data_source: 'Calculated from 2026 flights and 2025 history' }
const flight: Flight = {
  id: 1, airline: 1, airline_name: 'Cebu Pacific', airline_code: '5J', flight_number: '5J12',
  origin: 1, origin_code: 'CEB', origin_name: 'Cebu', destination: 2, destination_code: 'MNL', destination_name: 'Manila',
  departure_time: '2026-12-01T01:30:00Z', arrival_time: '2026-12-01T02:30:00Z',
  direction: 'departing', total_seats: 100, available_seats: 35,
}
const airports = [{ id: 1, code: 'CEB', name: 'Cebu', city: 'Cebu', country: 'Philippines' }]
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.mocked(loadForecastAirports).mockReset().mockResolvedValue(airports)
  vi.mocked(loadForecastList).mockReset().mockResolvedValue([forecast])
  vi.mocked(loadForecastFlights).mockReset().mockResolvedValue([])
  vi.mocked(getForecast).mockReset().mockResolvedValue(forecast)
  vi.mocked(createForecast).mockReset().mockResolvedValue(forecast)
  vi.mocked(updateForecast).mockReset().mockResolvedValue(forecast)
  vi.mocked(deleteForecast).mockReset().mockResolvedValue(undefined)
  setProfile({ id: 1, username: 'staff', email: 'staff@example.com', role: 'staff', first_name: '', last_name: '' })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); clearSession() })
async function render(path = '/staff/forecasts', openAirport = true) {
  const protect = (page: React.ReactNode) => <RoleRoute allowedRoles={['staff', 'head']}>{page}</RoleRoute>
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/staff/forecasts" element={protect(<ForecastListPage />)} />
    <Route path="/staff/forecasts/new" element={protect(<ForecastFormPage />)} />
    <Route path="/staff/forecasts/:id/edit" element={protect(<ForecastFormPage />)} />
    <Route path="/staff/flights" element={<Link to="/staff/forecasts">Return to forecasts</Link>} />
    <Route path="/home" element={<p>Traveler home</p>} /><Route path="/signin" element={<p>Sign in</p>} />
  </Routes></MemoryRouter>))
  if (openAirport && path === '/staff/forecasts' && container.querySelector('.forecast-airport-list button')) await click('.forecast-airport-list button')
}
function field(name: string) { return container.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)! }
async function edit(name: string, value: string) {
  await act(async () => {
    const control = field(name)
    if (control.getAttribute('role') === 'combobox') {
      control.click()
      return
    }
    const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value)
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
  if (field(name).getAttribute('role') === 'combobox') await act(async () => {
    container.querySelector<HTMLElement>(`[role="option"][data-value="${value}"]`)!.click()
  })
}
async function submit() { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))) }
async function click(selector: string) { await act(async () => container.querySelector<HTMLButtonElement>(selector)!.click()) }

it('lists airport, date, crowd chip with dot and text, score and author', async () => {
  await render()
  expect(container.textContent).toContain('CEB — Cebu')
  expect(container.textContent).toContain('2026-12-01')
  expect(container.querySelector('.record-crowd-chip')?.textContent).toBe('Low crowd')
  expect(container.querySelector('.record-crowd-chip i')).not.toBeNull()
  expect(container.querySelector('tbody')?.textContent).toContain('Staff entry')
  expect(container.querySelector('a[href="/staff/forecasts/new"]')?.textContent).toBe('Add forecast')
  expect(container.querySelector('.app-nav-links a[aria-current="page"]')?.textContent).toBe('Crowd forecasts')
  expect(container.querySelector('svg')).toBeNull()
})
it('hides edit and delete when both permission flags are false', async () => {
  vi.mocked(loadForecastList).mockResolvedValue([{ ...forecast, can_edit: false, can_delete: false }])
  await render()
  expect(container.querySelector('tbody a[href$="/edit"], tbody .record-danger')).toBeNull()
})
it('shows the empty table message', async () => {
  vi.mocked(loadForecastList).mockResolvedValue([]); await render()
  expect(container.textContent).toContain('No forecasts listed yet.')
})
it('handles list loading and failure', async () => {
  vi.mocked(loadForecastList).mockReturnValue(new Promise(() => {})); await render()
  expect(container.querySelector('[role="status"]')?.textContent).toContain('Loading forecasts')
})
it('permits retry after a failed list request', async () => {
  vi.mocked(loadForecastList).mockRejectedValueOnce(new TypeError('Offline')); await render()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to load forecasts')
  await act(async () => [...container.querySelectorAll('button')].find(button=>button.textContent==='Try again')!.click()); expect(container.querySelector('table')).not.toBeNull()
})
it('cancels deletion and then deletes only after confirmation', async () => {
  await render(); await click('tbody .record-danger')
  expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain('Delete forecast for CEB — Cebu on 2026-12-01? This cannot be undone.')
  expect(document.activeElement?.textContent).toBe('Cancel')
  await click('[role="alertdialog"] .record-ghost')
  expect(deleteForecast).not.toHaveBeenCalled()
  vi.mocked(loadForecastList).mockResolvedValueOnce([])
  await click('tbody .record-danger'); await click('[role="alertdialog"] .record-danger')
  expect(deleteForecast).toHaveBeenCalledWith(7)
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Forecast deleted.')
  expect(container.textContent).toContain('No forecasts listed yet.')
})
it('keeps the row after a failed delete', async () => {
  vi.mocked(deleteForecast).mockRejectedValueOnce(new ApiError(403, { detail: 'Permission denied.' }))
  await render(); await click('tbody .record-danger'); await click('[role="alertdialog"] .record-danger')
  expect(container.querySelector('[role="alertdialog"] [role="alert"]')?.textContent).toBe('Permission denied.')
  expect(container.querySelector('tbody')?.textContent).toContain('CEB')
})
it('creates from five labeled fields without sending server-managed fields', async () => {
  await render('/staff/forecasts/new')
  expect(container.querySelectorAll('label')).toHaveLength(5)
  expect(container.querySelector('[name="created_by"], [name="calculated_at"]')).toBeNull()
  await edit('airport', '1'); await edit('date', '2026-12-01'); await edit('crowd_level', 'low'); await submit()
  expect(createForecast).toHaveBeenCalledWith({ airport: '1', date: '2026-12-01', crowd_level: 'low', crowd_score: null, data_source: '' })
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Forecast created.')
})
it('updates existing values and preserves optional negative scores without extra rules', async () => {
  await render('/staff/forecasts/7/edit')
  expect(field('airport').value).toBe('1'); expect(field('date').value).toBe('2026-12-01')
  await edit('crowd_level', 'high'); await edit('crowd_score', '-1.5'); await submit()
  expect(updateForecast).toHaveBeenCalledWith('7', expect.objectContaining({ crowd_level: 'high', crowd_score: '-1.5' }))
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Forecast updated.')
})
it.each(['airport', 'date', 'crowd_level', 'crowd_score', 'data_source'])('links backend %s messages and focuses the field', async name => {
  vi.mocked(createForecast).mockRejectedValueOnce(new ApiError(400, { [name]: ['Fix this value.'] }))
  await render('/staff/forecasts/new'); await submit()
  expect(field(name).getAttribute('aria-invalid')).toBe('true')
  expect(document.getElementById(field(name).getAttribute('aria-describedby')!)?.textContent).toBe('Fix this value.')
  expect(document.activeElement).toBe(field(name))
})
it('displays non-field errors and permits a save retry', async () => {
  vi.mocked(createForecast).mockRejectedValueOnce(new ApiError(400, { non_field_errors: ['Cannot save.'] }))
  await render('/staff/forecasts/new'); await submit()
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Cannot save.')
  await submit(); expect(container.querySelector('[role="status"]')?.textContent).toBe('Forecast created.')
})
it('withholds uneditable records and handles failed form loads', async () => {
  vi.mocked(getForecast).mockResolvedValue({ ...forecast, can_edit: false })
  await render('/staff/forecasts/7/edit')
  expect(container.querySelector('form')).toBeNull()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('permission to edit')
})
it('handles lookup errors', async () => {
  vi.mocked(loadForecastAirports).mockRejectedValue(new TypeError('Offline'))
  await render('/staff/forecasts/new')
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to load the forecast form')
})
it.each(['/staff/forecasts', '/staff/forecasts/new', '/staff/forecasts/7/edit'])('guards Traveler access to %s', async path => {
  setProfile({ id: 1, username: 'traveler', email: 'traveler@example.com', role: 'traveler', first_name: '', last_name: '' })
  await render(path); expect(container.textContent).toContain('Traveler home')
  expect(loadForecastList).not.toHaveBeenCalled(); expect(loadForecastAirports).not.toHaveBeenCalled()
})
it('allows Heads to create forecasts', async () => {
  setProfile({ id: 1, username: 'head', email: 'head@example.com', role: 'head', first_name: '', last_name: '' })
  await render('/staff/forecasts/new'); expect(container.querySelector('form')).not.toBeNull()
})


it('shows live seats, flight references and Edit but no Delete for calculated rows', async () => {
  vi.mocked(loadForecastList).mockResolvedValue([calculatedForecast])
  await render()
  expect(container.querySelector('tbody')?.textContent).toContain('124 of 180 seats, 68.9%')
  expect(container.querySelector('tbody')?.textContent).toContain('Calculated automatically')
  expect(container.querySelector('a[href="/staff/flights?airport=1&date=2026-12-01"]')?.textContent).toBe('View flights')
  expect(container.querySelector('tbody a[href$="/edit"]')?.textContent).toBe('Edit')
  expect(container.querySelector('tbody .record-danger')).toBeNull()
})

it('edits calculated forecasts without sending airport, date or source', async () => {
  vi.mocked(getForecast).mockResolvedValue(calculatedForecast)
  await render('/staff/forecasts/7/edit')
  expect(container.querySelector('form')?.textContent).toContain('Calculated automatically')
  expect(container.querySelector('form time')?.textContent).toBe(forecast.date)
  expect(field('airport')).toBeNull()
  expect(field('date')).toBeNull()
  expect(field('data_source')).toBeNull()
  await edit('crowd_level', 'high'); await submit()
  expect(updateForecast).toHaveBeenCalledWith('7', { crowd_level: 'high', crowd_score: null })
})

it('refetches and shows the calculated replacement after deleting a manual forecast', async () => {
  await render()
  vi.mocked(loadForecastList).mockResolvedValueOnce([{ ...calculatedForecast, id: 8 }])
  await click('tbody .record-danger'); await click('[role="alertdialog"] .record-danger')
  expect(loadForecastList).toHaveBeenCalledTimes(2)
  expect(container.querySelector('tbody')?.textContent).toContain('Calculated automatically')
  expect(container.querySelector('a[href="/staff/forecasts/8/edit"]')).not.toBeNull()
})

it('refetches airports and forecasts after returning from the flight list', async () => {
  await render()
  await click('a[href^="/staff/flights?"]')
  vi.mocked(loadForecastList).mockResolvedValueOnce([{ ...forecast, seats_booked: 140 }])
  await click('a[href="/staff/forecasts"]')
  await click('.forecast-airport-list button')
  expect(loadForecastAirports).toHaveBeenCalledTimes(2)
  expect(loadForecastList).toHaveBeenCalledTimes(2)
  expect(container.querySelector('tbody')?.textContent).toContain('140 of 180 seats')
})

it('loads and appends four flights per page under the correct forecast row', async () => {
  const firstPage = Array.from({ length: 4 }, (_, index) => ({ ...flight, id: index + 1 }))
  vi.mocked(loadForecastFlights)
    .mockResolvedValueOnce(records({ count: 5, next: 'page-2', previous: null, results: firstPage }))
    .mockResolvedValueOnce(records({ count: 5, next: null, previous: 'page-1', results: [{ ...flight, id: 5, flight_number: '5J13', direction: 'arriving' }] }))
  await render()
  expect(loadForecastFlights).not.toHaveBeenCalled()
  const toggle = container.querySelector<HTMLButtonElement>('tbody button[aria-expanded]')!
  const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!
  expect(toggle.textContent).toBe('Show flights')
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(panel.closest('tr')?.hidden).toBe(true)
  await act(async () => toggle.click())
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(panel.closest('tr')?.hidden).toBe(false)
  expect(loadForecastFlights).toHaveBeenNthCalledWith(1, 1, '2026-12-01', 1)
  expect(panel.querySelectorAll('li')).toHaveLength(4)
  expect(panel.textContent).toContain('Showing 4 of 5 flights')
  expect(panel.querySelector('li')?.textContent).toContain('5J12')
  expect(panel.querySelector('li')?.textContent).toContain('CEB to MNL')
  expect(panel.querySelector('li')?.textContent).toContain('Departing')
  expect(panel.querySelector('li')?.textContent).toContain('65 of 100 seats')
  expect(panel.querySelector('img')?.getAttribute('src')).toContain('ClockIcon')
  expect(panel.querySelectorAll('li:first-child time')).toHaveLength(2)
  expect(panel.querySelector('time')?.textContent).toContain('9:30')
  await act(async () => panel.querySelector('button')!.click())
  expect(loadForecastFlights).toHaveBeenNthCalledWith(2, 1, '2026-12-01', 2)
  expect(panel.querySelectorAll('li')).toHaveLength(5)
  expect(panel.querySelector('li:last-child')?.textContent).toContain('Arriving')
  expect(panel.textContent).toContain('Showing 5 of 5 flights')
  await act(async () => toggle.click())
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(panel.closest('tr')?.hidden).toBe(true)
})

it('shows inline flight loading, request errors, retry and the empty state', async () => {
  let rejectFlights!: (reason: Error) => void
  vi.mocked(loadForecastFlights).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFlights = reject }))
  await render()
  await click('tbody button[aria-expanded]')
  expect(container.querySelector('tbody [role="status"]')?.textContent).toBe('Loading flights...')
  await act(async () => rejectFlights(new TypeError('Offline')))
  expect(container.querySelector('tbody [role="alert"]')?.textContent).toContain('Unable to load flights')
  await click('.forecast-flights button')
  expect(container.querySelector('tbody')?.textContent).toContain('No flights listed for this date.')
})

it('starts with airports only, opens an airport and returns to the list', async () => {
  await render('/staff/forecasts', false)
  expect(container.querySelector('table')).toBeNull()
  expect(container.querySelector('.forecast-airport-list')?.textContent).toContain('Philippines')
  expect(loadForecastList).not.toHaveBeenCalled()
  await click('.forecast-airport-list button')
  expect(loadForecastList).toHaveBeenLastCalledWith({airport:'1',page:1})
  const back = container.querySelector<HTMLButtonElement>('.forecast-back')!
  expect(back.textContent).toBe('Back to airports')
  expect(back.classList.contains('record-secondary')).toBe(true)
  expect(back.querySelector('img')?.getAttribute('src')).toContain('chevron-leftIcon')
  await act(async () => back.click())
  expect(container.querySelector('table')).toBeNull()
})
it('searches globally instead of listing airports and supports Clear search', async () => {
  await render('/staff/forecasts', false)
  await edit('global-forecast-search','2026-12')
  expect(loadForecastList).toHaveBeenLastCalledWith({search:'2026-12',page:1})
  expect(container.querySelector('.forecast-airport-list')).toBeNull()
  expect(container.querySelector('table')).not.toBeNull()
  await act(async () => [...container.querySelectorAll('button')].find(button=>button.textContent==='Clear search')!.click())
  expect(container.querySelector('.forecast-airport-list')).not.toBeNull()
})
it('applies per-airport month, level and source filters and labels missing flight data', async () => {
  vi.mocked(loadForecastList).mockResolvedValue([{...forecast,flight_count:0,seats_total:0,seats_booked:0}])
  await render()
  expect(container.querySelector('tbody')?.textContent).toContain('No flight data')
  await edit('forecast-month','2026-12'); await edit('forecast-level','low'); await edit('forecast-source','manual')
  expect(loadForecastList).toHaveBeenLastCalledWith({airport:'1',month:'2026-12',level:'low',source:'manual',page:1})
})


it.each([[0, 'No forecasts yet'], [1, '1 forecast'], [362, '362 forecasts']] as const)('shows the real forecast count %s with the correct label', async (count, label) => {
  vi.mocked(loadForecastAirports).mockResolvedValue([{...airports[0]!, forecast_count:count}])
  await render('/staff/forecasts', false)
  expect(container.querySelector('.forecast-airport-list')?.textContent).toContain(label)
})
it('does not invent a zero count when the server omits the count', async () => {
  await render('/staff/forecasts', false)
  expect(container.querySelector('.forecast-airport-list')?.textContent).toContain('Forecast count unavailable')
  expect(container.querySelector('.forecast-airport-list')?.textContent).not.toContain('0 forecasts')
})
