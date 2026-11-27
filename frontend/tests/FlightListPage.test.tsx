// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearSession, setProfile } from '../src/api/authState'
import RoleRoute from '../src/components/RoleRoute'
import FlightListPage from '../src/features/flights/FlightListPage'
import { deleteFlight, listFlights } from '../src/features/flights/api'
import { ApiError } from '../src/api/client'
import type { Flight } from '../src/types/flights'

vi.mock('../src/features/flights/api', () => ({ listFlights: vi.fn(), deleteFlight: vi.fn(), loadFlightOptions: vi.fn().mockResolvedValue([[{id:1,code:"CEB",name:"Cebu",city:"Cebu",country:"Philippines"}], [{id:1,name:"Philippine Airlines",code:"PR"}]]) }))
export const flight: Flight = {
  id: 7, airline: 1, airline_name: 'Philippine Airlines', airline_code: 'PR', flight_number: '100',
  origin: 1, origin_code: 'CEB', origin_name: 'Cebu', destination: 2, destination_code: 'MNL', destination_name: 'Manila',
  departure_time: '2026-12-01T00:00:00Z', arrival_time: '2026-12-01T01:30:00Z',
  total_seats: 180, available_seats: 25, created_by_username: 'staff', can_edit: true,
}
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.mocked(listFlights).mockReset().mockResolvedValue([flight])
  vi.mocked(deleteFlight).mockReset().mockResolvedValue(undefined)
  setProfile({ id: 1, username: 'staff', email: 'staff@example.com', role: 'staff', first_name: '', last_name: '' })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); clearSession() })

async function render(path = '/staff/flights') {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/staff/flights" element={<RoleRoute allowedRoles={['staff', 'head']}><FlightListPage /></RoleRoute>} />
    <Route path="/home" element={<p>Traveler home</p>} /><Route path="/signin" element={<p>Sign in</p>} />
  </Routes></MemoryRouter>))
}

it('shows stored flights with Philippine times, seats, author and management links', async () => {
  await render()
  expect(listFlights).toHaveBeenCalledOnce()
  expect(container.textContent).toContain('Philippine Airlines (PR)')
  expect(container.textContent).toContain('CEB → MNL')
  expect(container.textContent).toContain('08:00')
  expect(container.textContent).toContain('09:30')
  expect(container.textContent).toContain('25 / 180')
  expect(container.querySelector('a[href="/staff/flights/new"]')?.textContent).toBe('Add flight')
  expect(container.querySelector('a[href="/staff/flights/7/edit"]')?.textContent).toBe('Edit')
  expect(container.querySelector('svg')).toBeNull()
})
it('hides edit for records the server marks as uneditable', async () => {
  vi.mocked(listFlights).mockResolvedValue([{ ...flight, can_edit: false }])
  await render()
  expect(container.querySelector('a[href$="/edit"]')).toBeNull()
  expect(container.querySelector('tbody button')).toBeNull()
})

async function askToDelete() {
  await act(async () => container.querySelector<HTMLButtonElement>('tbody button')!.click())
}

it('asks for confirmation and focuses ghost Cancel before any deletion', async () => {
  await render(); await askToDelete()
  const confirmation = container.querySelector('[role="alertdialog"]')!
  expect(confirmation.textContent).toContain('Delete flight PR 100? This cannot be undone.')
  expect(deleteFlight).not.toHaveBeenCalled()
  expect(document.activeElement?.textContent).toBe('Cancel')
  expect(confirmation.querySelector('.record-ghost')?.textContent).toBe('Cancel')
  await act(async () => confirmation.querySelector<HTMLButtonElement>('.record-ghost')!.click())
  expect(container.querySelector('[role="alertdialog"]')).toBeNull()
  expect(container.querySelector('tbody')?.textContent).toContain('CEB → MNL')
  expect(deleteFlight).not.toHaveBeenCalled()
})

it('deletes the confirmed flight, updates the table and announces success', async () => {
  await render(); await askToDelete()
  await act(async () => container.querySelector<HTMLButtonElement>('[role="alertdialog"] .record-danger')!.click())
  expect(deleteFlight).toHaveBeenCalledWith(7)
  expect(container.querySelector('[role="alertdialog"]')).toBeNull()
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Flight deleted.')
  expect(container.textContent).toContain('No flights listed yet.')
  expect(document.activeElement).toBe(container.querySelector('h1'))
})

it.each([new ApiError(403, { detail: 'Permission denied.' }), new TypeError('Offline')])('keeps the row and displays deletion errors', async error => {
  vi.mocked(deleteFlight).mockRejectedValueOnce(error)
  await render(); await askToDelete()
  await act(async () => container.querySelector<HTMLButtonElement>('[role="alertdialog"] .record-danger')!.click())
  expect(container.querySelector('[role="alertdialog"] [role="alert"]')).not.toBeNull()
  expect(container.querySelector('tbody')?.textContent).toContain('CEB → MNL')
  expect(container.querySelector<HTMLButtonElement>('[role="alertdialog"] .record-danger')?.disabled).toBe(false)
})

it('prevents duplicate deletion while a request is pending', async () => {
  vi.mocked(deleteFlight).mockReturnValue(new Promise(() => {}))
  await render(); await askToDelete()
  const confirm = container.querySelector<HTMLButtonElement>('[role="alertdialog"] .record-danger')!
  await act(async () => { confirm.click(); confirm.click() })
  expect(container.querySelector<HTMLButtonElement>('[role="alertdialog"] .record-ghost')?.disabled).toBe(true)
  expect(container.querySelector<HTMLButtonElement>('[role="alertdialog"] .record-danger')?.disabled).toBe(true)
  expect(deleteFlight).toHaveBeenCalledOnce()
})

it('marks Flights as the active staff navigation link', async () => {
  await render()
  expect([...container.querySelectorAll('.app-nav-links a')].map(link => link.textContent)).toEqual(['Dashboard', 'Flights', 'Crowd forecasts'])
  expect(container.querySelector('.app-nav-links a[aria-current="page"]')?.getAttribute('href')).toBe('/staff/flights')
})
it('shows an empty table message', async () => {
  vi.mocked(listFlights).mockResolvedValue([])
  await render()
  expect(container.textContent).toContain('No flights listed yet.')
})
it('shows loading before the request resolves', async () => {
  vi.mocked(listFlights).mockReturnValue(new Promise(() => {}))
  await render()
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Loading flights…')
  expect(container.querySelector('table')).toBeNull()
})
it('shows an error and permits retry', async () => {
  vi.mocked(listFlights).mockRejectedValueOnce(new TypeError('Offline'))
  await render()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to load flights')
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Try again')!.click())
  expect(container.querySelector('table')).not.toBeNull()
})
it.each(['head', 'traveler', null] as const)('guards the flight list for %s', async role => {
  if (role) setProfile({ id: 2, username: role, email: `${role}@example.com`, role, first_name: '', last_name: '' })
  else clearSession()
  await render()
  expect(listFlights).toHaveBeenCalledTimes(role === 'head' ? 1 : 0)
  expect(container.textContent).toContain(role === 'head' ? 'Flights' : role === 'traveler' ? 'Traveler home' : 'Sign in')
})


it('reads airport/date filters and allows clearing them', async () => {
  await render('/staff/flights?airport=2&date=2026-12-01')
  expect(listFlights).toHaveBeenLastCalledWith({ airport: '2', date: '2026-12-01' })
  expect(container.querySelector('.record-filter')?.textContent).toContain('2026-12-01')
  await act(async () => container.querySelector<HTMLAnchorElement>('.record-filter a')!.click())
  expect(listFlights).toHaveBeenLastCalledWith({ airport: '', date: '' })
  expect(container.querySelector('.record-filter')).toBeNull()
})

it('searches server-side with all controls and clears filters', async () => {
  await render()
  expect(container.querySelector('[placeholder="Search flight number, airline, or airport"]')).not.toBeNull()
  await act(async () => {
    const input=container.querySelector<HTMLInputElement>('[name=flight-search]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'PR')
    input.dispatchEvent(new Event('input',{bubbles:true}))
  })
  for (const field of ['flight-origin','flight-destination','flight-airline']) {
    await act(async () => container.querySelector<HTMLButtonElement>(`[name="${field}"]`)!.click())
    await act(async () => container.querySelector<HTMLElement>('[role=option][data-value="1"]')!.click())
  }
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  expect(listFlights).toHaveBeenLastCalledWith(expect.objectContaining({origin:'1',destination:'1',airline:'1',search:'PR'}))
  await act(async () => [...container.querySelectorAll('form .record-actions button')].find(button=>button.textContent==='Clear')!.dispatchEvent(new MouseEvent('click',{bubbles:true})))
  expect(listFlights).toHaveBeenLastCalledWith({airport:'',date:''})
})
