// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '../src/App'
import { clearSession, setProfile } from '../src/api/authState'
import { readTokens, writeTokens } from '../src/api/authStorage'
import { ApiError, apiRequest } from '../src/api/client'
import ErrorBoundary from '../src/components/ErrorBoundary'
import { signup } from '../src/features/signup/api'
import { logout } from '../src/features/homepage/api'

vi.mock('../src/api/lookups', () => ({ loadAirports: async () => [] }))
vi.mock('../src/features/head/api', async importOriginal => ({ ...await importOriginal<typeof import('../src/features/head/api')>(), getStaffList: async () => ({ staff: [], pending: [] }) }))
vi.mock('../src/features/staff-dashboard/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/features/staff-dashboard/api')>(),
  getOwnRecordCounts: async () => ({ flights: 0, forecasts: 0 }),
  getDashboardSummary: async () => ({ airport: null, period_start: '2026-11-16', period_end: '2026-12-15', counts: { low: 0, medium: 0, high: 0 }, dates: { low: [], medium: [], high: [] }, busiest_weekday: null, next_7_days: [], days: [], weekday_ranges: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map(weekday => ({weekday,day_count:0,min_score:null,min_date:null,max_score:null,max_date:null,max_day_seats_booked:null,max_day_seats_total:null,max_day_flight_count:null})), comparison: { average_occupancy_2026_percent: null, average_occupancy_2025_percent: null, difference_points: null, days_busier_than_2025: 0, days_quieter_than_2025: 0, days_compared: 0 } }),
}))

const profile = { id: 1, username: 'traveler', email: 'traveler@example.com', first_name: '', last_name: '', role: 'traveler' }
const tokens = { access: 'test-access', refresh: 'test-refresh' }
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
const fetchMock = vi.fn<typeof fetch>()

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  clearSession()
  vi.stubEnv('VITE_API_URL', 'https://api.example.test')
  fetchMock.mockReset()
  fetchMock.mockImplementation(url => {
    if (String(url).endsWith('/api/dashboard/')) return Promise.resolve(response({ detail: 'Dashboard uses sample data.', is_sample: true }))
    if (String(url).endsWith('/api/accounts/head/')) return Promise.resolve(response({ detail: 'Head management access granted.' }))
    return Promise.reject(new Error('Unexpected API request'))
  })
  vi.stubGlobal('fetch', fetchMock)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  clearSession()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function render(path: string) {
  await act(async () => { root.render(<MemoryRouter initialEntries={[path]}><AppRoutes /><CurrentPath /></MemoryRouter>) })
}

function CurrentPath() {
  return <output data-testid="current-path">{useLocation().pathname}</output>
}

function currentPath() {
  return container.querySelector('[data-testid="current-path"]')?.textContent
}

function input(name: string, value: string) {
  const field = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)
  if (!field) throw new Error(`Missing field ${name}`)
  field.value = value
  return field
}

async function submit() {
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

function validSignup() {
  input('username', 'traveler')
  input('email', 'traveler@example.com')
  input('password', 'Test-flow-password-927!')
  input('confirmPassword', 'Test-flow-password-927!')
}

it('shows a Sign in link on an unknown signed-out URL', async () => {
  await render('/unknown-page')
  expect(container.querySelector('h1')?.textContent).toBe('Page not found')
  expect(container.querySelector('main a')?.getAttribute('href')).toBe('/signin')
})

it.each([['traveler', '/home'], ['staff', '/staff/dashboard'], ['head', '/head']])(
  'links unknown URLs back to the %s landing page', async (role, path) => {
    writeTokens(tokens)
    fetchMock.mockResolvedValueOnce(response({ ...profile, role }))
    await render('/unknown-page')
    expect(container.querySelector('h1')?.textContent).toBe('Page not found')
    expect(container.querySelector('main a')?.getAttribute('href')).toBe(path)
  },
)

it('shows a reload action and hides exception details after a render error', async () => {
  function FailingComponent(): never { throw new Error('Private render diagnostics') }
  const reactLog = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await act(async () => root.render(<ErrorBoundary><FailingComponent /></ErrorBoundary>))
    expect(container.querySelector('h1')?.textContent).toBe('Something went wrong')
    expect(container.querySelector('button')?.textContent).toBe('Reload page')
    expect(container.textContent).not.toContain('Private render diagnostics')
  } finally {
    reactLog.mockRestore()
  }
})

describe('connected account flows', () => {
  it('submits only allowed signup fields and navigates to sign in', async () => {
    fetchMock.mockResolvedValueOnce(response(profile, 201))
    await render('/signup')
    validSignup()
    await submit()
    const options = fetchMock.mock.calls[0][1]!
    expect(JSON.parse(options.body as string)).toEqual({ username: 'traveler', email: 'traveler@example.com', password: 'Test-flow-password-927!' })
    expect(container.querySelector('h1')?.textContent).toBe('Welcome back')
    expect(container.querySelector('.auth-success[role="status"]')?.textContent).toBe('Account created. Please sign in.')
    expect(container.querySelector('.auth-success img')?.getAttribute('src')).toContain('successIcon.png')
    expect(readTokens()).toBeNull()
  })

  it.each(['username', 'password'])('dismisses signup success when the signin %s is edited', async name => {
    fetchMock.mockResolvedValueOnce(response(profile, 201))
    await render('/signup')
    validSignup()
    await submit()
    expect(container.querySelector('.auth-success')).not.toBeNull()
    const field = container.querySelector<HTMLInputElement>(`[name="${name}"]`)!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'edited')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.querySelector('.auth-success')).toBeNull()
  })

  it('does not restore signup success after navigating away and back', async () => {
    fetchMock.mockResolvedValueOnce(response(profile, 201))
    await render('/signup')
    validSignup()
    await submit()
    expect(container.querySelector('.auth-success')).not.toBeNull()
    await act(async () => container.querySelector<HTMLAnchorElement>('a[href="/signup"]')!.click())
    await act(async () => container.querySelector<HTMLAnchorElement>('a[href="/signin"]')!.click())
    expect(container.querySelector('h1')?.textContent).toBe('Welcome back')
    expect(container.querySelector('.auth-success')).toBeNull()
  })

  it('does not show signup success when signin is opened directly', async () => {
    await render('/signin')
    expect(container.querySelector('.auth-success')).toBeNull()
  })

  it.each([
    ['username', ['A user with that username already exists.']],
    ['email', ['User with this email already exists.']],
    ['email', ['Enter a valid email address.']],
    ['password', ['This password is too short.', 'This password is too common.']],
  ])('shows backend signup errors under %s', async (name, messages) => {
    fetchMock.mockResolvedValueOnce(response({ [name]: messages }, 400))
    await render('/signup')
    validSignup()
    await submit()
    const field = container.querySelector<HTMLInputElement>(`[name="${name}"]`)!
    expect(container.querySelector(`#signup-${name}-error`)?.textContent).toBe(messages.join(' '))
    expect(field.getAttribute('aria-describedby')).toBe(`signup-${name}-error`)
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(field)
    expect(currentPath()).toBe('/signup')
    expect(container.querySelector('.auth-success')).toBeNull()
  })

  it('does not submit mismatched passwords to the backend', async () => {
    await render('/signup')
    validSignup()
    input('confirmPassword', 'different')
    await submit()
    expect(container.querySelector('#signup-confirmPassword-error')?.textContent).toBe('Passwords do not match.')
    expect(document.activeElement).toBe(container.querySelector('[name="confirmPassword"]'))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('signup API preserves optional names while excluding injected role fields', async () => {
    fetchMock.mockResolvedValueOnce(response(profile, 201))
    const fields = { username: 'traveler', email: profile.email, password: 'test-only', first_name: 'Ada', last_name: 'Lee', role: 'head', promoted_by: 1 }
    await signup(fields)
    const sent = JSON.parse(fetchMock.mock.calls[0][1]!.body as string)
    expect(sent.first_name).toBe('Ada')
    expect(sent.last_name).toBe('Lee')
    expect(sent).not.toHaveProperty('role')
    expect(sent).not.toHaveProperty('promoted_by')
  })

  it('links backend errors to matching fields and focuses the first invalid field', async () => {
    fetchMock.mockResolvedValueOnce(response({ email: ['Already used.'], password: ['Too short.', 'Too common.'] }, 400))
    await render('/signup')
    validSignup()
    await submit()
    const email = container.querySelector<HTMLInputElement>('[name="email"]')!
    const password = container.querySelector<HTMLInputElement>('[name="password"]')!
    expect(container.querySelector('#signup-email-error')?.textContent).toBe('Already used.')
    expect(container.querySelector('#signup-password-error')?.textContent).toBe('Too short. Too common.')
    expect(email.getAttribute('aria-describedby')).toBe('signup-email-error')
    expect(password.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(email)
  })

  it('stores signin tokens, shows the actual username on Home, and signs out', async () => {
    fetchMock.mockResolvedValueOnce(response({ ...tokens, profile }))
      .mockResolvedValueOnce(response(profile))
      .mockResolvedValueOnce(response({ detail: 'Signed out.' }))
    await render('/signin')
    input('username', profile.email)
    input('password', 'Test-flow-password-927!')
    await submit()
    expect(readTokens()).toEqual(tokens)
    expect(container.querySelector('.eyebrow')?.textContent).toBe('WELCOME BACK, TRAVELER')
    expect(container.textContent).toContain('No upcoming booking yet. Search flights to get started.')
    await act(async () => container.querySelector<HTMLAnchorElement>('a[href="/profile"]')!.click())
    const signout = [...container.querySelectorAll('button')].find(button => button.textContent === 'Sign Out')!
    await act(async () => signout.click())
    const logoutCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/logout/'))!
    expect(JSON.parse(logoutCall[1]!.body as string)).toEqual({ refresh: tokens.refresh })
    expect(readTokens()).toBeNull()
    expect(container.querySelector('h1')?.textContent).toBe('Welcome back')
  })

  it('redirects signed-out Home visitors to sign in without requesting protected data', async () => {
    await render('/home')
    expect(container.querySelector('h1')?.textContent).toBe('Welcome back')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['/signin', '/signup'])('redirects authenticated visitors from %s to Home', async path => {
    writeTokens(tokens)
    fetchMock.mockResolvedValue(response(profile))
    await render(path)
    expect(container.querySelector('h1')?.textContent).toBe('Check airport crowds and flights')
  })

  it('clears tokens locally even when logout fails', async () => {
    writeTokens(tokens)
    fetchMock.mockResolvedValueOnce(response(profile)).mockRejectedValueOnce(new TypeError('Offline'))
    await render('/home')
    await act(async () => container.querySelector<HTMLAnchorElement>('a[href="/profile"]')!.click())
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Sign Out')!.click())
    expect(readTokens()).toBeNull()
    expect(container.querySelector('h1')?.textContent).toBe('Welcome back')
  })

  it('keeps landing public', async () => {
    await render('/')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.querySelector('a[href="/signin"]')).not.toBeNull()
  })

  it('shows a generic error on signin failure without storing tokens', async () => {
    fetchMock.mockResolvedValueOnce(response({ detail: 'Invalid username/email or password.' }, 401))
    await render('/signin')
    input('username', profile.username)
    input('password', 'incorrect')
    await submit()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Check your credentials')
    expect(readTokens()).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('role redirects and access', () => {
  it.each(['traveler', 'staff', 'head'])('allows %s to view its own profile', async role => {
    writeTokens(tokens)
    fetchMock.mockResolvedValueOnce(response({ ...profile, role }))
    await render('/profile')
    expect(currentPath()).toBe('/profile')
    expect(container.querySelector('h1')?.textContent).toBe('My account')
    expect(container.querySelector<HTMLInputElement>('[name="username"]')?.value).toBe(profile.username)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('redirects a signed-out profile visitor to signin', async () => {
    await render('/profile')
    expect(currentPath()).toBe('/signin')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reloads saved profile values from the backend after remounting the app', async () => {
    writeTokens(tokens)
    let stored = { ...profile }
    fetchMock.mockImplementation((url, options) => {
      if (String(url).endsWith('/profile/')) {
        if (options?.method === 'PATCH') stored = { ...stored, ...JSON.parse(options.body as string) }
        return Promise.resolve(response(stored))
      }
      return Promise.reject(new Error('Unexpected API request'))
    })
    await render('/profile')
    const username = container.querySelector<HTMLInputElement>('[name="username"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(username, 'persisted_username')
      username.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => container.querySelector('#profile-information form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    const update = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH')!
    expect(Object.keys(JSON.parse(update[1]!.body as string)).sort()).toEqual(['email', 'first_name', 'last_name', 'username'])
    expect(new Headers(update[1]!.headers).get('Authorization')).toBe('Bearer test-access')
    await act(async () => root.unmount())
    setProfile(null)
    root = createRoot(container)
    await render('/profile')
    expect(container.querySelector<HTMLInputElement>('[name="username"]')?.value).toBe('persisted_username')
    expect(fetchMock.mock.calls.filter(([, options]) => !options?.method || options.method === 'GET')).toHaveLength(2)
  })

  it('signs out from the profile sidebar and clears tokens', async () => {
    writeTokens(tokens)
    fetchMock.mockResolvedValueOnce(response(profile)).mockResolvedValueOnce(response({ detail: 'Signed out.' }))
    await render('/profile')
    await act(async () => container.querySelector<HTMLButtonElement>('.profile-sidebar button')!.click())
    expect(readTokens()).toBeNull()
    expect(currentPath()).toBe('/signin')
    const request = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/logout/'))!
    expect(JSON.parse(request[1]!.body as string)).toEqual({ refresh: tokens.refresh })
  })

  it('sends only current and new passwords to the existing password endpoint', async () => {
    writeTokens(tokens)
    fetchMock.mockResolvedValueOnce(response(profile)).mockResolvedValueOnce(response({ detail: 'Password changed.' }))
    await render('/profile')
    input('current_password', 'Current-Test-Password-29!')
    input('new_password', 'New-Test-Password-38!')
    input('confirm_password', 'New-Test-Password-38!')
    await act(async () => container.querySelector('#password-security form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    const request = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/password/change/'))!
    expect(request[1]!.method).toBe('POST')
    expect(JSON.parse(request[1]!.body as string)).toEqual({ current_password: 'Current-Test-Password-29!', new_password: 'New-Test-Password-38!' })
    expect(container.querySelector('#password-security [role="status"]')?.textContent).toBe('Password changed.')
  })

  it('sends the Head assignment form email to the existing protected endpoint', async () => {
    writeTokens(tokens)
    fetchMock.mockImplementation(url => {
      if (String(url).endsWith('/profile/')) return Promise.resolve(response({ ...profile, role: 'head' }))
      if (String(url).endsWith('/head/')) return Promise.resolve(response({ detail: 'Head management access granted.' }))
      if (String(url).endsWith('/staff/assign/')) return Promise.resolve(response({ detail: 'Pending Staff access assigned.' }))
      return Promise.reject(new Error('Unexpected API request'))
    })
    await render('/head')
    input('email', 'pending@example.com')
    await submit()
    const assignment = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/staff/assign/'))!
    expect(assignment[1]!.method).toBe('POST')
    expect(JSON.parse(assignment[1]!.body as string)).toEqual({ email: 'pending@example.com' })
    expect(new Headers(assignment[1]!.headers).get('Authorization')).toBe('Bearer test-access')
    expect(container.querySelector('.head-success')?.textContent).toBe('Pending Staff access assigned.')
  })

  it.each([
    ['traveler', '/home'],
    ['staff', '/staff/dashboard'],
    ['head', '/head'],
  ])('sends %s to its landing page after signin', async (role, destination) => {
    fetchMock.mockResolvedValueOnce(response({ ...tokens, profile: { ...profile, role } }))
    await render('/signin')
    input('username', profile.username)
    input('password', 'Test-flow-password-927!')
    await submit()
    expect(currentPath()).toBe(destination)
    expect(readTokens()).toEqual(tokens)
    expect(fetchMock).toHaveBeenCalledTimes(role === 'traveler' ? 1 : 2)
  })

  it.each([
    ['traveler', '/staff/dashboard', '/home'],
    ['traveler', '/head', '/home'],
    ['staff', '/home', '/staff/dashboard'],
    ['staff', '/head', '/staff/dashboard'],
    ['head', '/home', '/head'],
  ])('redirects %s away from %s to %s', async (role, requested, destination) => {
    writeTokens(tokens)
    fetchMock.mockResolvedValueOnce(response({ ...profile, role }))
    await render(requested)
    expect(currentPath()).toBe(destination)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/accounts/profile/')
    expect(fetchMock).toHaveBeenCalledTimes(destination === '/home' ? 1 : 2)
  })

  it.each([
    ['traveler', '/home'],
    ['staff', '/staff/dashboard'],
    ['head', '/head'],
    ['head', '/staff/dashboard'],
  ])('allows %s to visit %s', async (role, requested) => {
    writeTokens(tokens)
    fetchMock.mockResolvedValueOnce(response({ ...profile, role }))
    await render(requested)
    expect(currentPath()).toBe(requested)
    expect(container.textContent).not.toContain('Welcome back')
  })

  it.each(['/home', '/staff/dashboard', '/head'])('sends signed-out visitors from %s to signin', async requested => {
    await render(requested)
    expect(currentPath()).toBe('/signin')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['staff', '/signin', '/staff/dashboard'],
    ['staff', '/signup', '/staff/dashboard'],
    ['head', '/signin', '/head'],
    ['head', '/signup', '/head'],
  ])('sends restored %s sessions from %s to %s', async (role, requested, destination) => {
    writeTokens(tokens)
    fetchMock.mockResolvedValueOnce(response({ ...profile, role }))
    await render(requested)
    expect(currentPath()).toBe(destination)
  })

  it.each(['/staff/dashboard', '/head'])('rejects invalid sessions opening %s', async requested => {
    writeTokens(tokens)
    fetchMock.mockResolvedValueOnce(response({}, 401)).mockResolvedValueOnce(response({}, 401))
    await render(requested)
    expect(currentPath()).toBe('/signin')
    expect(readTokens()).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('API token refresh', () => {
  it('blacklists the rotated refresh token when logout must retry after a 401', async () => {
    writeTokens(tokens)
    const rotated = { access: 'rotated-access', refresh: 'rotated-refresh' }
    fetchMock.mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(response(rotated)).mockResolvedValueOnce(response({ detail: 'Signed out.' }))
    await logout()
    expect(JSON.parse(fetchMock.mock.calls[2][1]!.body as string)).toEqual({ refresh: rotated.refresh })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('shares one refresh attempt between concurrent protected requests', async () => {
    writeTokens(tokens)
    let completeRefresh: (value: Response) => void = () => {}
    const pending = new Promise<Response>(resolve => { completeRefresh = resolve })
    fetchMock.mockResolvedValueOnce(response({}, 401)).mockResolvedValueOnce(response({}, 401))
      .mockReturnValueOnce(pending).mockImplementation(() => Promise.resolve(response(profile)))
    const first = apiRequest('/api/accounts/profile/')
    const second = apiRequest('/api/dashboard/')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    completeRefresh(response({ access: 'rotated-access', refresh: 'rotated-refresh' }))
    await Promise.all([first, second])
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/token/refresh/'))).toHaveLength(1)
  })
  it('retries a 401 once with the rotated access token', async () => {
    writeTokens(tokens)
    const rotated = { access: 'rotated-access', refresh: 'rotated-refresh' }
    fetchMock.mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(response(rotated)).mockResolvedValueOnce(response(profile))
    expect(await apiRequest('/api/accounts/profile/')).toEqual(profile)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/accounts/token/refresh/')
    expect(new Headers(fetchMock.mock.calls[2][1]!.headers).get('Authorization')).toBe('Bearer rotated-access')
    expect(readTokens()).toEqual(rotated)
  })

  it('clears tokens and redirects when refresh fails without looping', async () => {
    writeTokens(tokens)
    fetchMock.mockResolvedValueOnce(response({}, 401)).mockResolvedValueOnce(response({}, 401))
    await render('/home')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(readTokens()).toBeNull()
    expect(container.querySelector('h1')?.textContent).toBe('Welcome back')
  })

  it('does not refresh again when the retried request also returns 401', async () => {
    writeTokens(tokens)
    fetchMock.mockResolvedValueOnce(response({}, 401)).mockResolvedValueOnce(response(tokens)).mockResolvedValueOnce(response({}, 401))
    await expect(apiRequest('/api/accounts/profile/')).rejects.toBeInstanceOf(ApiError)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(readTokens()).toBeNull()
  })
})
