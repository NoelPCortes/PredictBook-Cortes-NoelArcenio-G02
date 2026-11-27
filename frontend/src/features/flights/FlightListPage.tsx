import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import RecordLayout from '../../components/RecordLayout'
import RecordAlert from '../../components/RecordAlert'
import RecordField from '../../components/RecordField'
import { useRemoteResource } from '../../components/useRemoteResource'
import { airportOptions, airlineOptions } from '../../components/lookupOptions'
import DeleteConfirmation from '../../components/DeleteConfirmation'
import { usePendingAction } from '../../components/usePendingAction'
import { ApiError, fieldMessage } from '../../api/client'
import { formatFlightTime } from '../../components/flightTime'
import PageControls from '../../components/PageControls'
import type { Records } from '../../api/pagination'
import type { Flight } from '../../types/flights'
import { deleteFlight, listFlights, loadFlightOptions } from './api'

function FlightList() {
  const location = useLocation()
  const query = new URLSearchParams(location.search)
  const airport = query.get('airport') ?? ''
  const date = query.get('date') ?? ''
  const origin = query.get('origin') ?? ''
  const destination = query.get('destination') ?? ''
  const airline = query.get('airline') ?? ''
  const search = query.get('search') ?? ''
  const [draft, setDraft] = useState({ origin, destination, airline, date, search })
  const [lookupAttempt, setLookupAttempt] = useState(0)
  const options = useRemoteResource(`flight-filter-options/${lookupAttempt}`, loadFlightOptions)
  const navigate = useNavigate()
  const [success, setSuccess] = useState(() => typeof location.state?.success === 'string' ? location.state.success as string : '')
  const [pendingDelete, setPendingDelete] = useState<Flight | null>(null)
  const { isPending: isDeleting, tryBegin, finish } = usePendingAction()
  const [deleteError, setDeleteError] = useState('')
  const [flights, setFlights] = useState<Records<Flight>>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (location.state?.success) navigate(location.pathname + location.search, { replace: true, state: null })
  }, [location.pathname, location.search, location.state, navigate])
  useEffect(() => {
    let isActive = true
    void listFlights({ airport, date, ...(origin ? { origin } : {}), ...(destination ? { destination } : {}), ...(airline ? { airline } : {}), ...(search ? { search } : {}), ...(page > 1 ? { page } : {}) }).then(records => { if (isActive) setFlights(records) })
      .catch(() => { if (isActive) setError('Unable to load flights. Please try again.') })
      .finally(() => { if (isActive) setIsLoading(false) })
    return () => { isActive = false }
  }, [attempt, airport, date, origin, destination, airline, search, page])
  function submitSearch(event: FormEvent) {
    event.preventDefault()
    const params = new URLSearchParams()
    if (airport) params.set('airport', airport)
    for (const [key,value] of Object.entries(draft)) if (value.trim()) params.set(key,value.trim())
    navigate(`/staff/flights${params.size ? `?${params}` : ''}`)
    setIsLoading(true); setError(''); setPage(1); setAttempt(value => value + 1)
  }
  async function confirmDelete() {
    if (!pendingDelete || !tryBegin()) return
    setDeleteError(''); setSuccess('')
    try {
      await deleteFlight(pendingDelete.id)
      setFlights(previous => previous.filter(flight => flight.id !== pendingDelete.id))
      setPendingDelete(null); setSuccess('Flight deleted.')
    } catch (error) {
      setDeleteError(error instanceof ApiError ? fieldMessage(error.fields.detail) ?? 'Unable to delete the flight. Please try again.' : 'Unable to delete the flight. Please try again.')
    } finally { finish() }
  }
  return <RecordLayout>
    <header className="record-heading"><h1 tabIndex={-1}>Flights</h1><Link className="record-button" to="/staff/flights/new">Add flight</Link></header>
    <form className="record-form" onSubmit={submitSearch} aria-label="Search flights">
      <div className="record-fields">
        <RecordField name="flight-search" label="Search" placeholder="Search flight number, airline, or airport" value={draft.search} onChange={value => setDraft(previous => ({ ...previous, search: value }))} />
        <RecordField searchable name="flight-origin" label="From" value={draft.origin} onChange={value => setDraft(previous => ({ ...previous, origin: value }))} options={[{value:'',label:'All airports'},...airportOptions(options.value?.[0] ?? [])]} />
        <RecordField searchable name="flight-destination" label="To" value={draft.destination} onChange={value => setDraft(previous => ({ ...previous, destination: value }))} options={[{value:'',label:'All airports'},...airportOptions(options.value?.[0] ?? [])]} />
        <RecordField searchable name="flight-airline" label="Airline" value={draft.airline} onChange={value => setDraft(previous => ({ ...previous, airline: value }))} options={[{value:'',label:'All airlines'},...airlineOptions(options.value?.[1] ?? [])]} />
        <RecordField name="flight-date" label="Date" type="date" value={draft.date} onChange={value => setDraft(previous => ({ ...previous, date: value }))} />
      </div>
      {options.error && <><RecordAlert kind="error">{options.error}</RecordAlert><button type="button" className="record-button record-secondary" onClick={() => setLookupAttempt(value => value + 1)}>Retry filters</button></>}
      {!options.value && !options.error && <p role="status">Loading search options...</p>}
      <div className="record-actions"><button className="record-button" type="submit">Search</button><button className="record-button record-ghost" type="button" onClick={() => { setDraft({origin:'',destination:'',airline:'',date:'',search:''}); setPage(1); navigate('/staff/flights'); setAttempt(value => value + 1) }}>Clear</button></div>
    </form>
    <p>Flight times are shown in Philippine time (Asia/Manila, UTC+08:00).</p>
    {(airport || date) && <p className="record-filter" role="status">Flights {airport ? `involving airport ${airport}` : ''}{date ? ` on ${date}` : ''} (forecast dates: UTC). <Link className="record-button record-ghost" to="/staff/flights">Clear filter</Link></p>}
    {success && <RecordAlert kind="success">{success}</RecordAlert>}
    {pendingDelete && <DeleteConfirmation key={pendingDelete.id} message={`Delete flight ${pendingDelete.airline_code} ${pendingDelete.flight_number}? This cannot be undone.`} isDeleting={isDeleting} error={deleteError} onCancel={() => { setPendingDelete(null); setDeleteError('') }} onDelete={() => { void confirmDelete() }} />}
    {isLoading && <p role="status">Loading flights…</p>}
    {error && <><RecordAlert kind="error">{error}</RecordAlert><button className="record-button record-secondary" onClick={() => { setIsLoading(true); setError(''); setAttempt(value => value + 1) }}>Try again</button></>}
    {!isLoading && !error && <div className="record-table-scroll" tabIndex={0} role="region" aria-label="Flights table">
      <table className="record-table"><thead><tr>
        {['Airline', 'Flight number', 'Route', 'Departure', 'Arrival', 'Open seats / total seats', 'Created by', 'Actions'].map(label => <th scope="col" key={label}>{label}</th>)}
      </tr></thead><tbody>
        {flights.map(flight => <tr key={flight.id}>
          <td>{flight.airline_name} ({flight.airline_code})</td><td>{flight.flight_number}</td>
          <td>{flight.origin_code} → {flight.destination_code}</td>
          <td><time dateTime={flight.departure_time}>{formatFlightTime(flight.departure_time)}</time></td>
          <td><time dateTime={flight.arrival_time}>{formatFlightTime(flight.arrival_time)}</time></td>
          <td>{flight.available_seats} / {flight.total_seats}</td><td>{flight.created_by_username}</td>
          <td>{flight.can_edit && <div className="record-actions"><Link className="record-button record-secondary" to={`/staff/flights/${flight.id}/edit`}>Edit</Link><button type="button" className="record-button record-danger" disabled={isDeleting} onClick={() => { setDeleteError(''); setPendingDelete(flight) }}>Delete</button></div>}</td>
        </tr>)}
        {!flights.length && <tr><td colSpan={8}>No flights listed yet.</td></tr>}
      </tbody></table>
    </div>}
    {!isLoading && !error && <PageControls rows={flights} page={page} onChange={value => { setPage(value); setIsLoading(true) }} />}
  </RecordLayout>
}

export default function FlightListPage() {
  const location = useLocation()
  return <FlightList key={location.search} />
}
