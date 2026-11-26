import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthLayout from '../../components/AuthLayout'
import type { SampleDay } from '../../components/AuthLayout'
import AuthField from '../../components/AuthField'
import { usePendingAction } from '../../components/usePendingAction'

import { signup } from './api'
import { ApiError, fieldMessage } from '../../api/client'

const sampleDays: readonly SampleDay[] = [
  { day: 19, level: 'Medium' }, { day: 20, level: 'Low' },
  { day: 21, level: 'Low' }, { day: 22, level: 'Low' },
  { day: 23, level: 'Medium' }, { day: 24, level: 'High' },
  { day: 25, level: 'High' }, { day: 26, level: 'High' },
  { day: 27, level: 'Medium' }, { day: 28, level: 'Low' },
  { day: 29, level: 'Low' }, { day: 30, level: 'Medium' },
  { day: 1, level: 'Medium' }, { day: 2, level: 'High' },
]
const fields = [
  { name: 'username', label: 'Username', placeholder: 'Choose a username', type: 'text', autoComplete: 'username' },
  { name: 'email', label: 'Email', placeholder: 'Enter your email', type: 'email', autoComplete: 'email' },
  { name: 'password', label: 'Password', placeholder: 'Create a password', type: 'password', autoComplete: 'new-password' },
  { name: 'confirmPassword', label: 'Confirm password', placeholder: 'Enter your password again', type: 'password', autoComplete: 'new-password' },
] as const
type FieldName = typeof fields[number]['name']
type Errors = Partial<Record<FieldName, string>>

export default function SignUpPage() {
  const navigate = useNavigate()
  const { isPending: isSubmitting, tryBegin, finish } = usePendingAction()
  const [serverError, setServerError] = useState('')
  const errorRef = useRef<HTMLParagraphElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [errors, setErrors] = useState<Errors>({})

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return
    setServerError('')
    const form = event.currentTarget
    const values = new FormData(form)
    const username = String(values.get('username') ?? '').trim()
    const email = String(values.get('email') ?? '').trim()
    const password = String(values.get('password') ?? '')
    const confirmPassword = String(values.get('confirmPassword') ?? '')
    const nextErrors: Errors = {}
    if (!username) nextErrors.username = 'Choose a username.'
    if (!email) nextErrors.email = 'Enter your email.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) nextErrors.email = 'Enter a valid email address.'
    if (!password) nextErrors.password = 'Create a password.'
    if (!confirmPassword) nextErrors.confirmPassword = 'Confirm your password.'
    else if (confirmPassword !== password) nextErrors.confirmPassword = 'Passwords do not match.'
    setErrors(nextErrors)
    const firstInvalid = fields.find(field => nextErrors[field.name])
    if (firstInvalid) {
      formRef.current?.querySelector<HTMLInputElement>(`[name="${firstInvalid.name}"]`)?.focus()
      return
    }
    if (!tryBegin()) return
    try {
      await signup({ username, email, password })
      navigate('/signin', { replace: true, state: { accountCreated: true } })
    } catch (error) {
      const backendErrors: Errors = {}
      if (error instanceof ApiError) {
        for (const field of fields) {
          const message = fieldMessage(error.fields[field.name])
          if (message) backendErrors[field.name] = message
        }
      }
      setErrors(backendErrors)
      const invalid = fields.find(field => backendErrors[field.name])
      if (invalid) {
        formRef.current?.querySelector<HTMLInputElement>(`[name="${invalid.name}"]`)?.focus()
      } else {
        setServerError('Unable to create your account. Please try again.')
        requestAnimationFrame(() => errorRef.current?.focus())
      }
    } finally {
      finish()
    }
  }

  return (
    <AuthLayout pageId="signup" title="Create your account"
      intro="Set a username and password to search flights, check airport crowd levels, and get suggested dates."
      panelTitle="Plan around the crowds."
      panelIntro="Expected crowd levels and suggested dates, all in one place." days={sampleDays}>
      <form ref={formRef} onSubmit={handleSubmit} noValidate aria-busy={isSubmitting}>
        {serverError && <p ref={errorRef} tabIndex={-1} className="signin-error" role="alert">{serverError}</p>}
        {fields.map(field => (
          <AuthField key={field.name} {...field} id={'signup-' + field.name}
            error={errors[field.name]} errorId={'signup-' + field.name + '-error'}
            onChange={() => setErrors(previous => ({ ...previous, [field.name]: undefined }))} />
        ))}
        <button type="submit" className="button signin-submit" disabled={isSubmitting}>{isSubmitting ? 'Creating account?' : 'Create account'}</button>
      </form>
      <div className="signin-divider"><span>Already have an account?</span></div>
      <Link to="/signin" className="button signin-create">Sign in</Link>
    </AuthLayout>
  )
}
