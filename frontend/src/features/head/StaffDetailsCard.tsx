import { useCallback, useState } from 'react'
import RecordAlert from '../../components/RecordAlert'
import { useRemoteResource } from '../../components/useRemoteResource'
import { getStaffDetails } from './api'

export default function StaffDetailsCard({ id, refresh, isRemoving, onRemove }: { id: number; refresh: number; isRemoving: boolean; onRemove: () => void }) {
  const [attempt,setAttempt] = useState(0)
  const load = useCallback(() => getStaffDetails(id),[id])
  const resource = useRemoteResource(`staff-details/${id}/${refresh}/${attempt}`,load)
  const result = resource.value
  return <section className="head-card" aria-label="Staff details"><h2>Staff details</h2>
    {!result && !resource.error && <p role="status">Loading Staff details...</p>}
    {resource.error && <><RecordAlert kind="error">{resource.error}</RecordAlert><button className="record-button record-secondary" onClick={() => setAttempt(value => value + 1)}>Retry details</button></>}
    {result && <>
      <dl className="staff-details-values">
        <div><dt>Username</dt><dd>{result.username}</dd></div><div><dt>Email</dt><dd>{result.email}</dd></div>
        <div><dt>First name</dt><dd>{result.first_name || 'Not set'}</dd></div><div><dt>Last name</dt><dd>{result.last_name || 'Not set'}</dd></div>
        <div><dt>Date joined</dt><dd><time dateTime={result.date_joined}>{new Date(result.date_joined).toLocaleDateString('en-US',{timeZone:'UTC'})}</time></dd></div>
        <div><dt>Flights created</dt><dd>{result.flights_created}</dd></div><div><dt>Forecasts created</dt><dd>{result.forecasts_created}</dd></div>
      </dl>
      <button type="button" className="record-button record-danger" disabled={isRemoving} onClick={onRemove}>Remove Staff access</button>
    </>}
  </section>
}
