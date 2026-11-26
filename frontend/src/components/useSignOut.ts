import { useNavigate } from 'react-router-dom'
import { clearSession } from '../api/authState'
import type { SignOutNotice } from '../api/authState'
import { logout } from '../api/session'
import { usePendingAction } from './usePendingAction'

export function useSignOut() {
  const navigate = useNavigate()
  const { isPending: isSigningOut, tryBegin } = usePendingAction()
  async function signOut() {
    if (!tryBegin()) return
    let signOutNotice: SignOutNotice
    try {
      const result = await logout()
      signOutNotice = { message: result.detail || 'Signed out.', isError: false }
    } catch {
      signOutNotice = { message: 'Signed out on this device. The server could not end the session.', isError: true }
    }
    clearSession(signOutNotice)
    navigate('/signin', { replace: true })
  }
  return { signOut, isSigningOut }
}
