import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AuthLayout from '../../components/AuthLayout'
import type { SampleDay } from '../../components/AuthLayout'
import AuthField from '../../components/AuthField'
import { usePendingAction } from '../../components/usePendingAction'
import { signin } from './api'
import { writeTokens } from '../../api/authStorage'
import { clearSignOutNotice, setProfile, useAuth } from '../../api/authState'
import { ROLE_LANDING_PATHS } from '../../types/auth'
import successIcon from '../../assets/icons/successIcon.png'

const sampleDays: readonly SampleDay[] = [
  { day: 5, level: 'Medium' }, { day: 6, level: 'Low' },
  { day: 7, level: 'Low' }, { day: 8, level: 'Low' },
  { day: 9, level: 'Medium' }, { day: 10, level: 'High' },
  { day: 11, level: 'High' }, { day: 12, level: 'Medium' },
  { day: 13, level: 'Low' }, { day: 14, level: 'Low' },
  { day: 15, level: 'Low' }, { day: 16, level: 'Low' },
  { day: 17, level: 'Medium' }, { day: 18, level: 'High' },
]

export default function SignInPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signOutNotice } = useAuth()
  const navigationState = location.state as { accountCreated?: boolean } | null
  const [hasSignupSuccess, setHasSignupSuccess] = useState(() => navigationState?.accountCreated === true)
  const notice = hasSignupSuccess ? { message: 'Account created. Please sign in.', isError: false } : signOutNotice
  useEffect(() => {
    if (navigationState?.accountCreated) {
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [navigationState, location.pathname, navigate])
  const { isPending: isSubmitting, tryBegin, finish } = usePendingAction()
  const [serverError, setServerError] = useState('')
  const errorRef = useRef<HTMLParagraphElement>(null)
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const [errors, setErrors] = useState({ username: false, password: false })

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return
    setServerError('')
    const nextErrors = {
      username: !usernameRef.current?.value.trim(),
      password: !passwordRef.current?.value,
    }
    setErrors(nextErrors)
    if (nextErrors.username) {
      usernameRef.current?.focus()
      return
    }
    if (nextErrors.password) {
      passwordRef.current?.focus()
      return
    }
    if (!tryBegin()) return
    try {
      const result = await signin(usernameRef.current!.value.trim(), passwordRef.current!.value)
      writeTokens({ access: result.access, refresh: result.refresh })
      setProfile(result.profile)
      navigate(ROLE_LANDING_PATHS[result.profile.role], { replace: true })
    } catch {
      setServerError('Unable to sign in. Check your credentials and try again.')
      requestAnimationFrame(() => errorRef.current?.focus())
    } finally {
      finish()
    }
  }

  return (
    <AuthLayout pageId="signin" title="Welcome back"
      intro="Sign in to search flights, check airport crowd levels, and get suggested dates. Staff sign in here too."
      panelTitle="Know the crowd before you book."
      panelIntro="Low, Medium, or High, for every day of your trip." days={sampleDays}>
      {notice && (notice.isError
        ? <p className="signin-error" role="alert">{notice.message}</p>
        : <div className="auth-success" role="status"><img src={successIcon} alt="" aria-hidden="true" /><span>{notice.message}</span></div>)}
      <form onSubmit={handleSubmit} onChange={() => { setHasSignupSuccess(false); clearSignOutNotice() }} noValidate aria-busy={isSubmitting}>
        {serverError && <p ref={errorRef} tabIndex={-1} className="signin-error" role="alert">{serverError}</p>}
        <AuthField ref={usernameRef} id="signin-username" name="username" label="Email or username" type="text" autoComplete="username" placeholder="Enter your email or username" error={errors.username ? 'Enter your email or username.' : undefined} errorId="username-error" />
        <AuthField ref={passwordRef} id="signin-password" name="password" label="Password" type="password" autoComplete="current-password" placeholder="Enter your password" error={errors.password ? 'Enter your password.' : undefined} errorId="password-error" />
        <button type="submit" className="button signin-submit" disabled={isSubmitting}>{isSubmitting ? 'Signing in?' : 'Sign in'}</button>
      </form>
      <div className="signin-divider"><span>Don’t have an account yet?</span></div>
      <Link to="/signup" className="button signin-create" onClick={clearSignOutNotice}>Create an account</Link>
    </AuthLayout>
  )
}
