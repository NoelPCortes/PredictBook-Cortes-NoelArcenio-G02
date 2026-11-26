import { useSyncExternalStore } from 'react'
import type { Profile } from '../types/auth'
import { clearTokens, readTokens } from './authStorage'

export type SignOutNotice = { message: string; isError: boolean }

let snapshot: { profile: Profile | null; isLoading: boolean; signOutNotice: SignOutNotice | null } = {
  profile: null, isLoading: Boolean(readTokens()), signOutNotice: null,
}
const listeners = new Set<() => void>()

function updateSession(profile: Profile | null, signOutNotice: SignOutNotice | null = null) {
  snapshot = { profile, isLoading: false, signOutNotice }
  listeners.forEach(listener => listener())
}

export function setProfile(profile: Profile | null) {
  updateSession(profile)
}

export function clearSession(signOutNotice: SignOutNotice | null = null) {
  clearTokens()
  updateSession(null, signOutNotice)
}

export function clearSignOutNotice() {
  if (snapshot.signOutNotice) updateSession(snapshot.profile)
}

export function useAuth() {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => snapshot,
  )
}
