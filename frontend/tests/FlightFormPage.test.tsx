// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearSession, setProfile } from '../src/api/authState'
import { ApiError } from '../src/api/client'
import RoleRoute from '../src/components/RoleRoute'
import FlightFormPage from '../src/features/flights/FlightFormPage'
import FlightListPage from '../src/features/flights/FlightListPage'
import { createFlight, getFlight, listFlights, loadFlightOptions, updateFlight } from '../src/features/flights/api'
import type { Flight } from '../src/types/flights'

vi.mock('../src/features/flights/api', () => ({ createFlight: vi.fn(), updateFlight: vi.fn(), getFlight: vi.fn(), loadFlightOptions: vi.fn(), listFlights: vi.fn() }))

it('shows Flight not found with a return link and no form', async () => {
  vi.mocked(getFlight).mockRejectedValueOnce(new ApiError(404, { detail: 'Not found.' }))
  await render('/staff/flights/999/edit')
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Flight not found.')
  expect(container.querySelector('main a[href="/staff/flights"]')?.textContent).toBe('Back to flights')
  expect(container.querySelector('form')).toBeNull()
})
const flight: Flight = {
  id: 7, airline: 1, airline_name: 'Philippine Airlines', airline_code: 'PR', flight_number: '100',
  origin: 1, origin_code: 'CEB', origin_name: 'Cebu', destination: 2, destination_code: 'MNL', destination_name: 'Manila',
  departure_time: '2026-12-01T00:00:00Z', arrival_time: '2026-12-01T01:30:00Z', total_seats: 180, available_seats: 25,
  created_by_username: 'staff', can_edit: true,
}
const airports = [
  { id: 1, code: 'CEB', name: 'Cebu', city: 'Cebu', country: 'Philippines' },
  { id: 2, code: 'MNL', name: 'Manila', city: 'Manila', country: 'Philippines' },
]
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.mocked(loadFlightOptions).mockReset().mockResolvedValue([airports, [{ id: 1, name: 'Philippine Airlines', code: 'PR' }]])
  vi.mocked(getFlight).mockReset().mockResolvedValue(flight)
  vi.mocked(createFlight).mockReset().mockResolvedValue(flight)
  vi.mocked(updateFlight).mockReset().mockResolvedValue(flight)
  vi.mocked(listFlights).mockReset().mockResolvedValue([flight])
  setProfile({ id: 1, username: 'staff', email: 'staff@example.com', role: 'staff', first_name: '', last_name: '' })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); clearSession() })

async function render(path = '/staff/flights/new') {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/staff/flights/new" element={<RoleRoute allowedRoles={['staff', 'head']}><FlightFormPage /></RoleRoute>} />
    <Route path="/staff/flights/:id/edit" element={<RoleRoute allowedRoles={['staff', 'head']}><FlightFormPage /></RoleRoute>} />
    <Route path="/staff/flights" element={<FlightListPage />} />
    <Route path="/home" element={<p>Traveler home</p>} /><Route path="/signin" element={<p>Sign in</p>} />
  </Routes></MemoryRouter>))
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
async function fill() {
  for (const [name, value] of Object.entries({ airline: '1', flight_number: '100', origin: '1', destination: '2', departure_time: '2026-12-01T08:00', arrival_time: '2026-12-01T09:30', total_seats: '180', available_seats: '25' })) await edit(name, value)
}

it('loads database airport and airline choices with visible labels', async () => {
  await render()
  expect(loadFlightOptions).toHaveBeenCalledOnce()
  expect(container.querySelectorAll('label')).toHaveLength(8)
  await fill()
  expect(field('airline').textContent).toContain('Philippine Airlines (PR)')
  expect(field('origin').textContent).toContain('CEB — Cebu')
  expect(field('destination').textContent).toContain('MNL — Manila')
  expect(field('departure_time').type).toBe('datetime-local')
  expect(container.textContent).toContain('Philippine time')
  expect(container.querySelector('[name="created_by"], svg')).toBeNull()
})
it('creates a flight with explicit Philippine offsets and shows success on the list', async () => {
  await render(); await fill(); await submit()
  expect(createFlight).toHaveBeenCalledWith({
    airline: '1', flight_number: '100', origin: '1', destination: '2', departure_time: '2026-12-01T08:00+08:00',
    arrival_time: '2026-12-01T09:30+08:00', total_seats: '180', available_seats: '25',
  })
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Flight created.')
  expect(container.querySelector('table')).not.toBeNull()
})
it('loads stored values for edit, converts UTC to Philippine input time and shows update success', async () => {
  await render('/staff/flights/7/edit')
  expect(getFlight).toHaveBeenCalledWith('7')
  expect(field('departure_time').value).toBe('2026-12-01T08:00')
  expect(field('available_seats').value).toBe('25')
  await edit('available_seats', '0'); await submit()
  expect(updateFlight).toHaveBeenCalledWith('7', { available_seats: '0' })
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Flight updated.')
  expect(createFlight).not.toHaveBeenCalled()
})
it('preserves untouched timestamp precision when editing other fields', async () => {
  vi.mocked(getFlight).mockResolvedValue({ ...flight, departure_time: '2026-12-01T00:00:12.123456Z', arrival_time: '2026-12-01T01:30:34.654321Z' })
  await render('/staff/flights/7/edit'); await edit('total_seats', '200'); await submit()
  expect(updateFlight).toHaveBeenCalledWith('7', { total_seats: '200' })
})
it('sends an explicit Philippine timestamp when the departure field is changed', async () => {
  await render('/staff/flights/7/edit'); await edit('departure_time', '2026-12-01T08:15'); await submit()
  expect(updateFlight).toHaveBeenCalledWith('7', { departure_time: '2026-12-01T08:15+08:00' })
})
it.each(['airline', 'flight_number', 'origin', 'destination', 'departure_time', 'arrival_time', 'total_seats', 'available_seats'])('shows backend %s messages under the field and focuses it', async name => {
  vi.mocked(createFlight).mockRejectedValueOnce(new ApiError(400, { [name]: ['First message.', 'Second message.'] }))
  await render(); await submit()
  expect(field(name).getAttribute('aria-invalid')).toBe('true')
  const errorId = field(name).getAttribute('aria-describedby')!
  expect(document.getElementById(errorId)?.textContent).toBe('First message. Second message.')
  expect(document.activeElement).toBe(field(name))
})
it('focuses the first invalid field in form order and shows non-field errors', async () => {
  vi.mocked(createFlight).mockRejectedValueOnce(new ApiError(400, { destination: ['Different airports required.'], airline: ['Choose an airline.'], non_field_errors: ['Unable to save record.'] }))
  await render(); await submit()
  expect(document.activeElement).toBe(field('airline'))
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Unable to save record.')
})
it('shows update permission errors and enables retry after a network failure', async () => {
  await render('/staff/flights/7/edit')
  vi.mocked(updateFlight).mockRejectedValueOnce(new ApiError(403, { detail: 'You do not have permission to perform this action.' }))
  await submit()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('You do not have permission')
  vi.mocked(updateFlight).mockRejectedValueOnce(new TypeError('Offline'))
  await submit()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to save the flight')
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false)
})
it('withholds the form when the server says this record cannot be edited', async () => {
  vi.mocked(getFlight).mockResolvedValue({ ...flight, can_edit: false })
  await render('/staff/flights/7/edit')
  expect(container.querySelector('form')).toBeNull()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('permission to edit')
})
it('handles loading, failed lookups and retry', async () => {
  vi.mocked(loadFlightOptions).mockRejectedValueOnce(new TypeError('Offline'))
  await render()
  expect(container.querySelector('form')).toBeNull()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to load')
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Try again')!.click())
  expect(container.querySelector('form')).not.toBeNull()
})
it('keeps submit disabled while the save is pending', async () => {
  vi.mocked(createFlight).mockReturnValue(new Promise(() => {}))
  await render()
  const form = container.querySelector('form')!
  await act(async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
  expect(createFlight).toHaveBeenCalledOnce()
})
it.each(['/staff/flights/new', '/staff/flights/7/edit'])('blocks Traveler form access at %s', async path => {
  setProfile({ id: 1, username: 'traveler', email: 'traveler@example.com', role: 'traveler', first_name: '', last_name: '' })
  await render(path)
  expect(container.textContent).toContain('Traveler home')
  expect(loadFlightOptions).not.toHaveBeenCalled()
})
it('lets Heads open the edit form', async () => {
  setProfile({ id: 1, username: 'head', email: 'head@example.com', role: 'head', first_name: '', last_name: '' })
  await render('/staff/flights/7/edit')
  expect(container.querySelector('form')).not.toBeNull()
})
it('cancels without saving', async () => {
  await render()
  await act(async () => container.querySelector<HTMLAnchorElement>('a[href="/staff/flights"]')!.click())
  expect(container.querySelector('table')).not.toBeNull()
  expect(createFlight).not.toHaveBeenCalled()
})
