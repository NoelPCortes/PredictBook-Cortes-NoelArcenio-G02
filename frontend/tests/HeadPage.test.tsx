// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearSession, setProfile } from '../src/api/authState'
import { ApiError } from '../src/api/client'
import HeadPage from '../src/features/head/HeadPage'
import { assignStaff, getHeadAccess, getStaffList, revokeStaff, getStaffDetails } from '../src/features/head/api'

vi.mock('../src/features/head/api', () => ({ assignStaff: vi.fn(), getHeadAccess: vi.fn(), getStaffList: vi.fn(), revokeStaff: vi.fn(), getStaffDetails: vi.fn() }))
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  setProfile({ id: 1, username: 'head_user', email: 'head@example.com', first_name: '', last_name: '', role: 'head' })
  vi.mocked(getHeadAccess).mockReset().mockResolvedValue({ detail: 'Head management access granted.' })
  vi.mocked(getStaffDetails).mockReset().mockResolvedValue({id:2,username:'staff_a',email:'a@example.com',first_name:'',last_name:'',date_joined:'2026-01-01T00:00:00Z',flights_created:7,forecasts_created:9})
  vi.mocked(getStaffList).mockReset().mockResolvedValue({ staff: [], pending: [] })
  vi.mocked(revokeStaff).mockReset().mockResolvedValue({ detail: 'Staff access revoked.' })
  vi.mocked(assignStaff).mockReset().mockResolvedValue({ detail: 'Staff access assigned.' })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  clearSession()
})

async function render() {
  await act(async () => root.render(<MemoryRouter initialEntries={['/head']}><HeadPage /></MemoryRouter>))
}

function emailInput() {
  return container.querySelector<HTMLInputElement>('[name="email"]')!
}

async function submit(email = 'newstaff@example.com') {
  emailInput().value = email
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
}

it('renders Head navigation and only the approved email assignment form after server authorization', async () => {
  await render()
  expect(getHeadAccess).toHaveBeenCalledOnce()
  expect(container.querySelector('h1')?.textContent).toBe('Head management')
  expect([...container.querySelectorAll('.app-nav-links a')].map(link => link.textContent)).toEqual(['Dashboard', 'Flights', 'Crowd forecasts', 'Head management'])
  expect(container.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('/head')
  expect(container.querySelector('.brand')?.getAttribute('href')).toBe('/head')
  expect(container.querySelector('a[href="/staff/dashboard"]')).not.toBeNull()
  expect(container.querySelectorAll('input')).toHaveLength(2)
  expect(container.querySelector('form label')?.textContent).toBe('Email')
  expect(emailInput().type).toBe('email')
  expect(container.textContent).toContain('head_user')
  expect(container.textContent).not.toMatch(/Promote|Charts/)
  expect(container.querySelector('svg')).toBeNull()
})

it.each(['Staff access assigned.', 'Pending Staff access assigned.', 'Account already has Staff or Head access; no change made.'])('shows the server result: %s', async detail => {
  vi.mocked(assignStaff).mockResolvedValueOnce({ detail })
  await render()
  await submit('  newstaff@example.com  ')
  expect(assignStaff).toHaveBeenCalledWith('newstaff@example.com')
  const status = container.querySelector(detail.includes('no change made') ? '.head-info[role="status"]' : '.head-success[role="status"]')
  expect(status?.textContent).toBe(detail)
  expect(document.activeElement).toBe(status)
})

it.each(['', 'invalid-email'])('validates email before sending: %s', async email => {
  await render()
  await submit(email)
  expect(assignStaff).not.toHaveBeenCalled()
  expect(emailInput().getAttribute('aria-invalid')).toBe('true')
  expect(emailInput().getAttribute('aria-describedby')).toBe('head-staff-email-error')
  expect(document.activeElement).toBe(emailInput())
})

it('associates backend email errors with the field and focuses it', async () => {
  vi.mocked(assignStaff).mockRejectedValueOnce(new ApiError(400, { email: ['Enter a valid email address.'] }))
  await render()
  await submit()
  expect(container.querySelector('#head-staff-email-error')?.textContent).toBe('Enter a valid email address.')
  expect(emailInput().getAttribute('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(emailInput())
})

it('shows backend general errors as an alert', async () => {
  vi.mocked(assignStaff).mockRejectedValueOnce(new ApiError(400, { detail: 'Assignment could not be completed.' }))
  await render()
  await submit()
  expect(container.querySelector('.head-error[role="alert"]')?.textContent).toBe('Assignment could not be completed.')
})

it('shows an error and permits another attempt after a network failure', async () => {
  vi.mocked(assignStaff).mockRejectedValueOnce(new TypeError('Offline'))
  await render()
  await submit()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to assign Staff access')
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false)
})

it('clears the result message when the email is edited', async () => {
  await render()
  await submit()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(emailInput(), 'other@example.com')
    emailInput().dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(container.querySelector('.head-feedback')).toBeNull()
})

it('disables assignment while a request is pending', async () => {
  vi.mocked(assignStaff).mockReturnValueOnce(new Promise(() => {}))
  await render()
  emailInput().value = 'staff@example.com'
  const form = container.querySelector('form')!
  await act(async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
  expect(container.querySelector('form')?.getAttribute('aria-busy')).toBe('true')
  expect(assignStaff).toHaveBeenCalledOnce()
})

it('withholds the form while Head authorization is pending', async () => {
  vi.mocked(getHeadAccess).mockReturnValueOnce(new Promise(() => {}))
  await render()
  expect(container.querySelector('[role="status"]')?.textContent).toContain('Checking Head access')
  expect(container.querySelector('form')).toBeNull()
})

it.each([403, 500])('withholds the form when server authorization returns %s', async status => {
  vi.mocked(getHeadAccess).mockRejectedValueOnce(new ApiError(status, {}))
  await render()
  expect(container.querySelector('[role="alert"]')).not.toBeNull()
  expect(container.querySelector('form')).toBeNull()
})

it('removes the form if Head access is revoked before assignment', async () => {
  vi.mocked(assignStaff).mockRejectedValueOnce(new ApiError(403, {}))
  await render()
  await submit()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('do not have access')
  expect(container.querySelector('form')).toBeNull()
})


it('renders Staff and pending lists, then refreshes them after assignment', async () => {
  vi.mocked(getStaffList).mockResolvedValue({ staff: [{ id: 2, username: 'staff_a', email: 'a@example.com' }], pending: [{ email: 'pending@example.com', assigned_by_username: 'head_user', assigned_at: '2026-11-17T04:00:00Z' }] })
  await render()
  expect(container.querySelector('[aria-label="Staff list"]')?.textContent).toContain('staff_a')
  expect(container.querySelector('[aria-label="Pending assignments list"]')?.textContent).toContain('pending@example.com')
  expect(container.querySelector('[aria-label="Pending assignments list"]')?.textContent).toContain('head_user')
  await submit()
  expect(getStaffList).toHaveBeenCalledTimes(2)
  expect(emailInput().value).toBe('')
})
it('shows empty states for both lists', async () => {
  await render()
  expect(container.textContent).toContain('No Staff accounts yet.')
  expect(container.textContent).toContain('No pending assignments.')
})
it.each([false, true])('confirms and removes the selected Staff or pending assignment: %s', async isPending => {
  vi.mocked(getStaffList).mockResolvedValue({ staff: [{ id: 2, username: 'staff_a', email: 'a@example.com' }], pending: [{ email: 'pending@example.com', assigned_by_username: 'head_user', assigned_at: '2026-11-17T04:00:00Z' }] })
  await render()
  const table = isPending ? 'Pending assignments list' : 'Staff list'
  await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="${table}"] button`)!.click())
  if (!isPending) await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Staff details"] button.record-danger')!.click())
  const message = container.querySelector('[role="alertdialog"]')?.textContent
  expect(message).toContain(isPending ? 'Remove the pending Staff assignment for pending@example.com?' : 'Remove Staff access for staff_a? They become a Traveler. Their account is not deleted.')
  expect(document.activeElement?.textContent).toBe('Cancel')
  expect(revokeStaff).not.toHaveBeenCalled()
  await act(async () => container.querySelector<HTMLButtonElement>('[role="alertdialog"] .record-ghost')!.click())
  expect(revokeStaff).not.toHaveBeenCalled()
  await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="${table}"] button`)!.click())
  if (!isPending) await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Staff details"] button.record-danger')!.click())
  vi.mocked(getStaffList).mockResolvedValue({ staff: [], pending: [] })
  await act(async () => container.querySelector<HTMLButtonElement>('[role="alertdialog"] .record-danger')!.click())
  expect(revokeStaff).toHaveBeenCalledWith(isPending ? 'pending@example.com' : 'a@example.com')
  expect(container.textContent).toContain('Staff access revoked.')
  expect(getStaffList).toHaveBeenCalledTimes(2)
})
it('shows backend list and removal errors without hiding them', async () => {
  vi.mocked(getStaffList).mockRejectedValueOnce(new ApiError(403, { detail: 'Head access required.' }))
  await render()
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Head access required.')
  vi.mocked(getStaffList).mockResolvedValue({ staff: [{ id: 2, username: 'staff_a', email: 'a@example.com' }], pending: [] })
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Retry lists')!.click())
  vi.mocked(revokeStaff).mockRejectedValueOnce(new ApiError(400, { detail: 'Only Staff access can be revoked here.' }))
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Staff list"] button')!.click())
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Staff details"] button.record-danger')!.click())
  await act(async () => container.querySelector<HTMLButtonElement>('[role="alertdialog"] .record-danger')!.click())
  expect(container.querySelector('[role="alertdialog"] [role="alert"]')?.textContent).toBe('Only Staff access can be revoked here.')
})

it('disables removal actions and sends one request after repeated confirmation clicks', async () => {
  vi.mocked(getStaffList).mockResolvedValue({ staff: [{ id: 2, username: 'staff_a', email: 'a@example.com' }], pending: [] })
  vi.mocked(revokeStaff).mockReturnValueOnce(new Promise(() => {}))
  await render()
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Staff list"] button')!.click())
  const remove = container.querySelector<HTMLButtonElement>('[aria-label="Staff details"] .record-danger')!
  await act(async () => remove.click())
  const confirm = container.querySelector<HTMLButtonElement>('[role="alertdialog"] .record-danger')!
  await act(async () => { confirm.click(); confirm.click() })
  expect(revokeStaff).toHaveBeenCalledOnce()
  expect(remove.disabled).toBe(true)
  expect(confirm.disabled).toBe(true)
})

it('shows selected Staff details, missing names, counts, side search and info feedback', async () => {
  vi.mocked(getStaffList).mockResolvedValue({staff:[{id:2,username:'staff_a',email:'a@example.com'}],pending:[]})
  await render()
  expect(container.textContent).toContain('Select a Staff member to see their details.')
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Staff list"] button')!.click())
  expect(getStaffDetails).toHaveBeenCalledWith(2)
  expect(container.querySelector('[aria-label="Staff list"] button')?.getAttribute('aria-pressed')).toBe('true')
  const details=container.querySelector('[aria-label="Staff details"]')!
  expect(details.textContent).toContain('Not set')
  expect([...details.querySelectorAll('dd')].map(item=>item.textContent)).toContain('7')
  await act(async () => {
    const search=container.querySelector<HTMLInputElement>('[name=head-staff-search]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,'staff_a')
    search.dispatchEvent(new Event('input',{bubbles:true}))
  })
  expect(getStaffList).toHaveBeenLastCalledWith(1,1,'staff_a')
  vi.mocked(assignStaff).mockResolvedValue({detail:'Account already has Staff or Head access; no change made.'})
  await submit()
  expect(container.querySelector('.head-info')?.textContent).toContain('no change made')
  expect(container.querySelector('.head-success')).toBeNull()
})
it('handles details loading and errors with retry', async () => {
  vi.mocked(getStaffList).mockResolvedValue({staff:[{id:2,username:'staff_a',email:'a@example.com'}],pending:[]})
  vi.mocked(getStaffDetails).mockReturnValueOnce(new Promise(()=>{}))
  await render(); await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Staff list"] button')!.click())
  expect(container.textContent).toContain('Loading Staff details')
})

it('shows details errors and retries the protected detail read', async () => {
  vi.mocked(getStaffList).mockResolvedValue({staff:[{id:2,username:'staff_a',email:'a@example.com'}],pending:[]})
  vi.mocked(getStaffDetails).mockRejectedValueOnce(new ApiError(404,{detail:'Staff member not found.'}))
  await render(); await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Staff list"] button')!.click())
  expect(container.querySelector('[aria-label="Staff details"] [role=alert]')?.textContent).toBe('Staff member not found.')
  await act(async () => [...container.querySelectorAll('button')].find(button=>button.textContent==='Retry details')!.click())
  expect(container.querySelector('[aria-label="Staff details"] dl')).not.toBeNull()
})
it('keeps Head management outside the calendar-only navy page frame', async () => {
  await render()
  expect(container.querySelector('h1')?.textContent).toBe('Head management')
  expect(container.querySelector('.traffic-calendar-page, .traffic-calendar-title')).toBeNull()
})
