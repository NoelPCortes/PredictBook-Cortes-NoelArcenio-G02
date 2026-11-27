// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearSession, setProfile } from '../src/api/authState'
import { ApiError } from '../src/api/client'
import ProfilePage from '../src/features/profile/ProfilePage'
import { changePassword, updateProfile } from '../src/features/profile/api'

vi.mock('../src/features/profile/api', () => ({ updateProfile: vi.fn(), changePassword: vi.fn() }))
const profile = { id: 1, username: 'traveler', email: 'traveler@example.com', first_name: 'Ada', last_name: 'Lee', role: 'traveler' as const }
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let notifyIntersection: IntersectionObserverCallback
const observe = vi.fn()
const disconnect = vi.fn()

beforeEach(async () => {
  observe.mockClear()
  disconnect.mockClear()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { notifyIntersection = callback }
    observe = observe
    disconnect = disconnect
  })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  setProfile(profile)
  vi.mocked(updateProfile).mockReset().mockResolvedValue(profile)
  vi.mocked(changePassword).mockReset().mockResolvedValue({ detail: 'Password changed.' })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<MemoryRouter initialEntries={['/profile']}><ProfilePage /></MemoryRouter>))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  clearSession()
  vi.unstubAllGlobals()
})

function field(name: string) {
  return container.querySelector<HTMLInputElement>(`[name="${name}"]`)!
}

async function edit(name: string, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field(name), value)
    field(name).dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit(section: string) {
  await act(async () => container.querySelector(`${section} form`)!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
}

async function fillPasswords() {
  await edit('current_password', 'Current-Test-Password-29!')
  await edit('new_password', 'New-Test-Password-38!')
  await edit('confirm_password', 'New-Test-Password-38!')
}

it('shows four editable profile fields, plain Role text, an icon-only avatar and three masked password fields', () => {
  expect(container.querySelector('h1')?.textContent).toBe('My account')
  expect(field('username').value).toBe('traveler')
  expect(field('email').value).toBe(profile.email)
  expect(field('first_name').value).toBe('Ada')
  expect(field('last_name').value).toBe('Lee')
  expect(container.querySelector('.profile-role p')?.textContent).toBe('Traveler')
  expect(container.querySelector('[name="role"], [name="promoted_by"], input[type="file"], select, svg')).toBeNull()
  expect(container.querySelector('.profile-avatar img')?.getAttribute('src')).toContain('UserCircleIcon.png')
  expect(container.querySelectorAll('input[type="password"]')).toHaveLength(3)
  expect(container.querySelector('a[href="/home"]')).not.toBeNull()
  expect(container.textContent).not.toContain('Suggestions')
})

it('saves editable values and displays a success message', async () => {
  await edit('username', 'updated')
  await edit('first_name', 'Grace')
  vi.mocked(updateProfile).mockResolvedValueOnce({ ...profile, username: 'updated', first_name: 'Grace' })
  await submit('#profile-information')
  expect(updateProfile).toHaveBeenCalledWith({ username: 'updated', email: profile.email, first_name: 'Grace', last_name: 'Lee' })
  expect(container.querySelector('#profile-information [role="status"]')?.textContent).toBe('Profile updated.')
  expect(field('username').value).toBe('updated')
})

it('moves focus to the selected account section and updates the sidebar state', async () => {
  const password = container.querySelector<HTMLElement>('#password-security')!
  password.scrollIntoView = vi.fn()
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
  await act(async () => container.querySelector<HTMLAnchorElement>('a[href="/profile#password-security"]')!.click())
  expect(document.activeElement).toBe(password)
  expect(password.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  expect(container.querySelector('a[aria-current="location"]')?.textContent).toBe('Password & Security')
  await act(async () => container.querySelector<HTMLAnchorElement>('a[href="/profile#profile-information"]')!.click())
  expect(document.activeElement).toBe(container.querySelector('#profile-information'))
})

it('honors reduced motion when scrolling to a section', async () => {
  const password = container.querySelector<HTMLElement>('#password-security')!
  password.scrollIntoView = vi.fn()
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
  await act(async () => container.querySelector<HTMLAnchorElement>('a[href="/profile#password-security"]')!.click())
  expect(password.scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' })
})

it('observes both sections and follows scroll in both directions', async () => {
  const information = container.querySelector('#profile-information')!
  const password = container.querySelector('#password-security')!
  expect(observe.mock.calls).toEqual([[information], [password]])
  const entries = (showInformation: boolean) => [
    { target: information, isIntersecting: showInformation },
    { target: password, isIntersecting: !showInformation },
  ] as IntersectionObserverEntry[]
  const observer = {} as IntersectionObserver
  await act(async () => notifyIntersection(entries(false), observer))
  expect(container.querySelector('[aria-current="location"]')?.textContent).toBe('Password & Security')
  await act(async () => notifyIntersection(entries(true), observer))
  expect(container.querySelector('[aria-current="location"]')?.textContent).toBe('Profile Information')
  await act(async () => root.unmount())
  expect(disconnect).toHaveBeenCalledOnce()
})

it('keeps Sign out at the end of the account sidebar', () => {
  const signOut = container.querySelector('.profile-sidebar')?.lastElementChild
  expect(signOut?.tagName).toBe('BUTTON')
  expect(signOut?.textContent).toMatch(/^sign out$/i)
})

it.each(['username', 'email', 'first_name', 'last_name'])('shows backend %s errors next to the field', async name => {
  vi.mocked(updateProfile).mockRejectedValueOnce(new ApiError(400, { [name]: ['Invalid field value.'] }))
  await submit('#profile-information')
  expect(container.querySelector(`#profile-${name}-error`)?.textContent).toBe('Invalid field value.')
  expect(field(name).getAttribute('aria-invalid')).toBe('true')
  expect(field(name).getAttribute('aria-describedby')).toBe(`profile-${name}-error`)
  expect(document.activeElement).toBe(field(name))
})

it.each(['username', 'email'])('rejects empty %s locally', async name => {
  await edit(name, '')
  await submit('#profile-information')
  expect(updateProfile).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(field(name))
})

it('shows a save error after a network failure and permits retry', async () => {
  vi.mocked(updateProfile).mockRejectedValueOnce(new TypeError('Offline'))
  await submit('#profile-information')
  expect(container.querySelector('#profile-information [role="alert"]')?.textContent).toContain('Unable to save your profile')
  expect(container.querySelector<HTMLButtonElement>('#profile-information button')?.disabled).toBe(false)
})

it('does not send a mismatched password confirmation', async () => {
  await fillPasswords()
  await edit('confirm_password', 'different')
  await submit('#password-security')
  expect(changePassword).not.toHaveBeenCalled()
  expect(container.querySelector('#profile-confirm_password-error')?.textContent).toBe('Passwords do not match.')
  expect(document.activeElement).toBe(field('confirm_password'))
})

it('requires all password fields and focuses the first missing field', async () => {
  await submit('#password-security')
  expect(container.querySelectorAll('#password-security [aria-invalid="true"]')).toHaveLength(3)
  expect(document.activeElement).toBe(field('current_password'))
  expect(changePassword).not.toHaveBeenCalled()
})

it.each(['current_password', 'new_password'])('links backend password messages to %s', async name => {
  await fillPasswords()
  vi.mocked(changePassword).mockRejectedValueOnce(new ApiError(400, { [name]: ['First validation message.', 'Second validation message.'] }))
  await submit('#password-security')
  expect(container.querySelector(`#profile-${name}-error`)?.textContent).toBe('First validation message. Second validation message.')
  expect(field(name).getAttribute('aria-describedby')).toBe(`profile-${name}-error`)
  expect(document.activeElement).toBe(field(name))
})

it('changes the password, displays success and clears password inputs', async () => {
  await fillPasswords()
  await submit('#password-security')
  expect(changePassword).toHaveBeenCalledWith('Current-Test-Password-29!', 'New-Test-Password-38!')
  expect(container.querySelector('#password-security [role="status"]')?.textContent).toBe('Password changed.')
  for (const name of ['current_password', 'new_password', 'confirm_password']) expect(field(name).value).toBe('')
})

it('shows a general password error when the request fails', async () => {
  await fillPasswords()
  vi.mocked(changePassword).mockRejectedValueOnce(new TypeError('Offline'))
  await submit('#password-security')
  expect(container.querySelector('#password-security [role="alert"]')?.textContent).toContain('Unable to update your password')
})

it.each(['#profile-information', '#password-security'])('prevents repeated submission of %s while saving', async section => {
  if (section === '#password-security') await fillPasswords()
  vi.mocked(updateProfile).mockReturnValueOnce(new Promise(() => {}))
  vi.mocked(changePassword).mockReturnValueOnce(new Promise(() => {}))
  const form = container.querySelector(`${section} form`)!
  await act(async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  expect(container.querySelector<HTMLButtonElement>(`${section} button`)?.disabled).toBe(true)
  expect(section === '#profile-information' ? updateProfile : changePassword).toHaveBeenCalledOnce()
})
