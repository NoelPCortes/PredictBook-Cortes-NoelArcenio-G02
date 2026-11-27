import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../../api/authState'
import { ApiError, fieldMessage } from '../../api/client'
import AppNavbar from '../../components/AppNavbar'
import AuthField from '../../components/AuthField'
import { useSignOut } from '../../components/useSignOut'
import { usePendingAction } from '../../components/usePendingAction'
import { assignStaff, getHeadAccess } from './api'
import '../../components/AuthLayout.css'
import './HeadPage.css'
import StaffLists from './StaffLists'
import '../../components/RecordManagement.css'

export default function HeadPage() {
  const { profile } = useAuth()
  const { signOut, isSigningOut } = useSignOut()
  const [accessAttempt, setAccessAttempt] = useState(0)
  const [access, setAccess] = useState<'loading' | 'allowed' | 'denied' | 'error'>('loading')
  const { isPending: isSubmitting, tryBegin, finish } = usePendingAction()
  const [listRefresh, setListRefresh] = useState(0)
  const [emailError, setEmailError] = useState('')
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean; isInfo?: boolean } | null>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const feedbackRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    let isActive = true
    void getHeadAccess().then(() => { if (isActive) setAccess('allowed') })
      .catch(error => { if (isActive) setAccess(error instanceof ApiError && error.status === 403 ? 'denied' : 'error') })
    return () => { isActive = false }
  }, [accessAttempt])

  async function handleAssign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return
    const form = event.currentTarget
    setFeedback(null)
    setEmailError('')
    const email = emailRef.current?.value.trim() ?? ''
    if (!email || emailRef.current?.validity.typeMismatch) {
      setEmailError(email ? 'Enter a valid email address.' : 'Enter an email address.')
      emailRef.current?.focus()
      return
    }
    if (!tryBegin()) return
    try {
      const result = await assignStaff(email)
      form.reset()
      setFeedback({ message: result.detail, isError: false, isInfo: result.detail === "Account already has Staff or Head access; no change made." })
      setListRefresh(value => value + 1)
    } catch (error) {
      if (error instanceof ApiError) {
        const message = fieldMessage(error.fields.email)
        if (message) {
          setEmailError(message)
          emailRef.current?.focus()
          return
        }
        if (error.status === 403) {
          setAccess('denied')
          return
        }
        setFeedback({ message: fieldMessage(error.fields.detail) ?? fieldMessage(error.fields.non_field_errors) ?? 'Unable to assign Staff access. Please try again.', isError: true })
      } else {
        setFeedback({ message: 'Unable to assign Staff access. Please try again.', isError: true })
      }
    } finally {
      finish()
    }
  }

  useEffect(() => { if (feedback) feedbackRef.current?.focus() }, [feedback])

  return <>
    <AppNavbar userName={profile?.username ?? ''} onSignOut={signOut} isSigningOut={isSigningOut} navigation="head" />
    <main className="head-page record-page">
      <h1 tabIndex={-1}>Head management</h1>
      {access === 'loading' && <p role="status">Checking Head access…</p>}
      {access === 'denied' && <p className="head-feedback head-error" role="alert">You do not have access to Head management.</p>}
      {access === 'error' && <p className="head-feedback head-error" role="alert">Unable to load Head management. Please try again later.</p>}
      {access === 'error' && <button type="button" className="record-button record-secondary" onClick={() => { setAccess('loading'); setAccessAttempt(value => value + 1) }}>Retry access</button>}
      {access === 'allowed' && <StaffLists refresh={listRefresh}><section className="head-card" aria-labelledby="head-assign-title">
        <h2 id="head-assign-title">Assign Staff</h2>
        <p>Assign Staff access by email. The person can already have an account or register later.</p>
        <form onSubmit={handleAssign} noValidate aria-busy={isSubmitting} onChange={() => { setEmailError(''); setFeedback(null) }}>
          <AuthField ref={emailRef} id="head-staff-email" name="email" type="email" autoComplete="email" label="Email" error={emailError || undefined} errorId="head-staff-email-error" />
          <button className="button head-assign-button" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Assigning Staff…' : 'Assign Staff'}</button>
        </form>
        {feedback && <p ref={feedbackRef} tabIndex={-1} role={feedback.isError ? 'alert' : 'status'} className={`head-feedback ${feedback.isError ? 'head-error' : feedback.isInfo ? 'head-info' : 'head-success'}`}>{feedback.message}</p>}
      </section></StaffLists>}
    </main>
  </>
}
