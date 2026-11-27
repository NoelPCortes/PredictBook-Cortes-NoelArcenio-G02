import { Link } from 'react-router-dom'
import { useAuth } from '../api/authState'
import { ROLE_LANDING_PATHS } from '../types/auth'
import './RecordManagement.css'

export default function NotFoundPage() {
  const { profile } = useAuth()
  return <main className="record-page">
    <section className="record-form" aria-labelledby="not-found-title">
      <h1 id="not-found-title">Page not found</h1>
      <div><Link className="record-button" to={profile ? ROLE_LANDING_PATHS[profile.role] : '/signin'}>
        {profile ? 'Back to your start page' : 'Sign in'}
      </Link></div>
    </section>
  </main>
}
