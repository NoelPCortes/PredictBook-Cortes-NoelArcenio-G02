import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { setProfile } from '../../api/authState'
import { ApiError, fieldMessage } from '../../api/client'
import AuthField from '../../components/AuthField'
import { usePendingAction } from '../../components/usePendingAction'
import type { Profile } from '../../types/auth'
import userIcon from '../../assets/icons/UserCircleIcon.png'
import { updateProfile } from './api'
import type { ProfileFields } from './api'

const fields = [
  { name: 'username', label: 'Username', type: 'text', autoComplete: 'username', maxLength: 150 },
  { name: 'email', label: 'Email', type: 'email', autoComplete: 'email', maxLength: 254 },
  { name: 'first_name', label: 'First name', type: 'text', autoComplete: 'given-name', maxLength: 150 },
  { name: 'last_name', label: 'Last name', type: 'text', autoComplete: 'family-name', maxLength: 150 },
] as const

export default function ProfileInformation({ profile }: { profile: Profile }) {
  const [values, setValues] = useState<ProfileFields>(() => ({ username: profile.username, email: profile.email, first_name: profile.first_name, last_name: profile.last_name }))
  const [errors, setErrors] = useState<Partial<Record<keyof ProfileFields, string>>>({})
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null)
  const { isPending: isSaving, tryBegin, finish } = usePendingAction()
  const formRef = useRef<HTMLFormElement>(null)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSaving) return
    setFeedback(null)
    const nextErrors: Partial<Record<keyof ProfileFields, string>> = {}
    if (!values.username.trim()) nextErrors.username = 'Enter your username.'
    if (!values.email.trim()) nextErrors.email = 'Enter your email.'
    else if (formRef.current?.querySelector<HTMLInputElement>('[name="email"]')?.validity.typeMismatch) nextErrors.email = 'Enter a valid email address.'
    setErrors(nextErrors)
    const invalid = fields.find(field => nextErrors[field.name])
    if (invalid) { formRef.current?.querySelector<HTMLInputElement>(`[name="${invalid.name}"]`)?.focus(); return }
    if (!tryBegin()) return
    try {
      const updated = await updateProfile({ ...values, username: values.username.trim(), email: values.email.trim() })
      setValues({ username: updated.username, email: updated.email, first_name: updated.first_name, last_name: updated.last_name })
      setProfile(updated)
      setFeedback({ message: 'Profile updated.', isError: false })
    } catch (error) {
      const backendErrors: Partial<Record<keyof ProfileFields, string>> = {}
      if (error instanceof ApiError) {
        for (const field of fields) backendErrors[field.name] = fieldMessage(error.fields[field.name])
      }
      setErrors(backendErrors)
      const firstInvalid = fields.find(field => backendErrors[field.name])
      if (firstInvalid) formRef.current?.querySelector<HTMLInputElement>(`[name="${firstInvalid.name}"]`)?.focus()
      else setFeedback({ message: error instanceof ApiError ? fieldMessage(error.fields.detail) ?? fieldMessage(error.fields.non_field_errors) ?? 'Unable to save your profile. Please try again.' : 'Unable to save your profile. Please try again.', isError: true })
    } finally { finish() }
  }

  return <section className="profile-card" id="profile-information" tabIndex={-1} aria-labelledby="profile-information-title">
    <h2 id="profile-information-title">Profile Information</h2>
    <div className="profile-information-layout">
      <div className="profile-avatar"><img src={userIcon} alt="" aria-hidden="true" /></div>
      <form ref={formRef} onSubmit={save} noValidate aria-busy={isSaving}>
        {fields.map(field => <AuthField key={field.name} {...field} id={`profile-${field.name}`} value={values[field.name]} error={errors[field.name]} errorId={`profile-${field.name}-error`} onChange={event => { setValues(previous => ({ ...previous, [field.name]: event.target.value })); setErrors(previous => ({ ...previous, [field.name]: undefined })); setFeedback(null) }} />)}
        <div className="profile-role"><span>Role</span><p>{profile.role === 'head' ? 'Head' : profile.role === 'staff' ? 'Staff' : 'Traveler'}</p></div>
        <button className="button profile-action" disabled={isSaving} type="submit">{isSaving ? 'Saving changes…' : 'Save changes'}</button>
        {feedback && <p role={feedback.isError ? 'alert' : 'status'} className={`profile-feedback ${feedback.isError ? 'profile-error' : 'profile-success'}`}>{feedback.message}</p>}
      </form>
    </div>
  </section>
}
