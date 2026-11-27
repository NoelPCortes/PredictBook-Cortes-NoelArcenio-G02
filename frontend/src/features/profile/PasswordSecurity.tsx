import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, fieldMessage } from '../../api/client'
import AuthField from '../../components/AuthField'
import { usePendingAction } from '../../components/usePendingAction'
import { changePassword } from './api'

const fields = [
  { name: 'current_password', label: 'Current password', autoComplete: 'current-password' },
  { name: 'new_password', label: 'New password', autoComplete: 'new-password' },
  { name: 'confirm_password', label: 'Confirm new password', autoComplete: 'new-password' },
] as const
type FieldName = typeof fields[number]['name']

export default function PasswordSecurity() {
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null)
  const { isPending: isSaving, tryBegin, finish } = usePendingAction()
  const formRef = useRef<HTMLFormElement>(null)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSaving) return
    setFeedback(null)
    const form = event.currentTarget
    const values = new FormData(form)
    const currentPassword = String(values.get('current_password') ?? '')
    const newPassword = String(values.get('new_password') ?? '')
    const confirmation = String(values.get('confirm_password') ?? '')
    const nextErrors: Partial<Record<FieldName, string>> = {}
    if (!currentPassword) nextErrors.current_password = 'Enter your current password.'
    if (!newPassword) nextErrors.new_password = 'Enter your new password.'
    if (!confirmation) nextErrors.confirm_password = 'Confirm your new password.'
    else if (confirmation !== newPassword) nextErrors.confirm_password = 'Passwords do not match.'
    setErrors(nextErrors)
    const invalid = fields.find(field => nextErrors[field.name])
    if (invalid) { form.querySelector<HTMLInputElement>(`[name="${invalid.name}"]`)?.focus(); return }
    if (!tryBegin()) return
    try {
      const result = await changePassword(currentPassword, newPassword)
      form.reset()
      setFeedback({ message: result.detail, isError: false })
    } catch (error) {
      const backendErrors: Partial<Record<FieldName, string>> = {}
      if (error instanceof ApiError) for (const field of fields) backendErrors[field.name] = fieldMessage(error.fields[field.name])
      setErrors(backendErrors)
      const firstInvalid = fields.find(field => backendErrors[field.name])
      if (firstInvalid) form.querySelector<HTMLInputElement>(`[name="${firstInvalid.name}"]`)?.focus()
      else setFeedback({ message: error instanceof ApiError ? fieldMessage(error.fields.detail) ?? fieldMessage(error.fields.non_field_errors) ?? 'Unable to update your password. Please try again.' : 'Unable to update your password. Please try again.', isError: true })
    } finally { finish() }
  }

  return <section className="profile-card profile-password-layout" id="password-security" tabIndex={-1} aria-labelledby="password-security-title">
    <h2 id="password-security-title">Password &amp; Security</h2>
    <form ref={formRef} onSubmit={save} noValidate aria-busy={isSaving}>
      {fields.map(field => <AuthField key={field.name} {...field} type="password" id={`profile-${field.name}`} error={errors[field.name]} errorId={`profile-${field.name}-error`} onChange={() => { setErrors(previous => ({ ...previous, [field.name]: undefined })); setFeedback(null) }} />)}
      <button className="button profile-action" disabled={isSaving} type="submit">{isSaving ? 'Updating password…' : 'Update password'}</button>
      {feedback && <p role={feedback.isError ? 'alert' : 'status'} className={`profile-feedback ${feedback.isError ? 'profile-error' : 'profile-success'}`}>{feedback.message}</p>}
    </form>
  </section>
}
