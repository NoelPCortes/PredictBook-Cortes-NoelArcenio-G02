import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ApiError, fieldMessage } from '../../api/client'
import RecordLayout from '../../components/RecordLayout'
import RecordAlert from '../../components/RecordAlert'
import RecordField from '../../components/RecordField'
import DeleteConfirmation from '../../components/DeleteConfirmation'
import PageControls from '../../components/PageControls'
import CrowdChip from '../../components/CrowdChip'
import { useRemoteResource } from '../../components/useRemoteResource'
import backIcon from '../../assets/icons/chevron-leftIcon.png'
import type { Forecast } from '../../types/traffic'
import type { Airport } from '../../types/flights'
import { deleteForecast, loadForecastList, loadForecastAirports } from './api'
import ForecastFlights from './ForecastFlights'
import './CalendarInsights.css'

function ForecastRow({ record, airportName, showFlights, deleting, onDelete }: {
  record: Forecast; airportName: string; showFlights: boolean; deleting: boolean; onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()

  return <>
    <tr>
      <td>{airportName}</td><td><time dateTime={record.date}>{record.date}</time></td><td><CrowdChip level={record.crowd_level} /></td>
      <td>{!record.flight_count ? 'No flight data' : `${record.seats_booked} of ${record.seats_total} seats, ${record.seats_total ? (record.seats_booked / record.seats_total * 100).toFixed(1) : '0.0'}%`}</td>
      <td><div className="record-actions">
        <span>{record.flight_count}</span>
        {showFlights && <button type="button" className="record-button record-secondary" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(open => !open)}>{expanded ? 'Hide flights' : 'Show flights'}</button>}
        <Link className="record-button record-secondary" to={`/staff/flights?airport=${record.airport}&date=${record.date}`}>View flights</Link>
      </div></td>
      <td>{record.is_calculated ? 'Calculated automatically' : 'Staff entry'}</td>
      <td><div className="record-actions">
        {record.can_edit && <Link className="record-button record-secondary" to={`/staff/forecasts/${record.id}/edit`}>Edit</Link>}
        {record.can_delete && <button type="button" className="record-button record-danger" disabled={deleting} onClick={onDelete}>Delete</button>}
      </div></td>
    </tr>
    {showFlights && <tr hidden={!expanded}>
      <td colSpan={7} id={panelId}>{expanded && <ForecastFlights airport={record.airport} date={record.date} />}</td>
    </tr>}
  </>
}

function ForecastRecords({ airport, globalSearch, airports, onSuccess }: { airport: string; globalSearch: string; airports: Airport[]; onSuccess: (message: string) => void }) {
  const [filters, setFilters] = useState({ search: '', month: '', level: '', source: '' })
  const [page, setPage] = useState(1)
  const [attempt, setAttempt] = useState(0)
  const query = useMemo(() => globalSearch ? { search: globalSearch, page } : { airport, ...Object.fromEntries(Object.entries(filters).filter(([,value]) => value)), page }, [airport, globalSearch, filters, page])
  const load = useCallback(() => loadForecastList(query), [query])
  const result = useRemoteResource(`forecast-results/${JSON.stringify(query)}/${attempt}`, load)
  const [pending, setPending] = useState<Forecast | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const airportName = (id: number) => { const record = airports.find(item => item.id === id); return record ? `${record.code} — ${record.name}` : String(id) }
  async function remove() {
    if (!pending || deleting) return
    setDeleting(true); setError('')
    try { await deleteForecast(pending.id); setAttempt(value => value + 1); setPending(null); onSuccess('Forecast deleted.') }
    catch (error) { setError(error instanceof ApiError ? fieldMessage(error.fields.detail) ?? 'Unable to delete the forecast. Please try again.' : 'Unable to delete the forecast. Please try again.') }
    finally { setDeleting(false) }
  }
  function change(name: keyof typeof filters, value: string) { setFilters(previous => ({ ...previous, [name]: value })); setPage(1) }
  return <>
    {!globalSearch && <>
      <header className="record-heading"><h2>{airportName(Number(airport))}</h2><Link className="record-button" to="/staff/forecasts/new">Add forecast</Link></header>
      <div className="record-fields">
        <RecordField name="airport-forecast-search" label="Search this airport's forecasts" value={filters.search} onChange={value => change('search',value)} />
        <RecordField name="forecast-month" label="Month" type="month" value={filters.month} onChange={value => change('month',value)} />
        <RecordField name="forecast-level" label="Crowd level" value={filters.level} onChange={value => change('level',value)} options={[{value:'',label:'All levels'},...['low','medium','high'].map(level => ({value:level,label:level[0]!.toUpperCase()+level.slice(1)}))]} />
        <RecordField name="forecast-source" label="Source" value={filters.source} onChange={value => change('source',value)} options={[{value:'',label:'All sources'},{value:'calculated',label:'Calculated'},{value:'manual',label:'Manual'}]} />
      </div>
    </>}
    {pending && <DeleteConfirmation key={pending.id} message={`Delete forecast for ${airportName(pending.airport)} on ${pending.date}? This cannot be undone.`} isDeleting={deleting} error={error} onCancel={() => {setPending(null);setError('')}} onDelete={() => { void remove() }} />}
    {!result.value && !result.error && <p role="status">Loading forecasts...</p>}
    {result.error && <><RecordAlert kind="error">{`Unable to load forecasts. ${result.error}`}</RecordAlert><button className="record-button record-secondary" onClick={() => setAttempt(value => value + 1)}>Try again</button></>}
    {result.value && <>
      <div className="record-table-scroll" tabIndex={0} role="region" aria-label="Forecasts table"><table className="record-table">
        <thead><tr>{['Airport','Date','Crowd level','Seats booked','Flights','Source','Actions'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{result.value.map(record => <ForecastRow key={record.id} record={record} airportName={airportName(record.airport)} showFlights={!globalSearch} deleting={deleting} onDelete={() => {setPending(record);setError('')}} />)}
          {!result.value.length && <tr><td colSpan={7}>No forecasts listed yet.</td></tr>}
        </tbody>
      </table></div>
      <PageControls rows={result.value} page={page} onChange={setPage} />
    </>}
  </>
}

export default function ForecastListPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [success,setSuccess] = useState(() => typeof location.state?.success === 'string' ? location.state.success as string : '')
  const [search,setSearch] = useState('')
  const [airport,setAirport] = useState('')
  const [attempt,setAttempt] = useState(0)
  const airports = useRemoteResource(`forecast-airports/${attempt}`,loadForecastAirports)
  useEffect(() => { if (location.state?.success) navigate(location.pathname,{replace:true,state:null}) },[location.pathname,location.state,navigate])
  return <RecordLayout>
    <h1 tabIndex={-1}>Crowd forecasts</h1>
    {success && <RecordAlert kind="success">{success}</RecordAlert>}
    <RecordField name="global-forecast-search" label="Search all forecasts" placeholder="Search airport or date" value={search} onChange={setSearch} />
    {search.trim() && <button type="button" className="record-button record-ghost" onClick={() => {setSearch('');setAirport('')}}>Clear search</button>}
    {!airports.value && !airports.error && <p role="status">Loading airports...</p>}
    {airports.error && <><RecordAlert kind="error">{airports.error}</RecordAlert><button className="record-button record-secondary" onClick={() => setAttempt(value => value + 1)}>Try again</button></>}
    {airports.value && (search.trim() || airport ? <>
      {!search.trim() && <button type="button" className="record-button record-secondary forecast-back" onClick={() => {setAirport('');setAttempt(value => value + 1)}}><img src={backIcon} alt="" />Back to airports</button>}
      <ForecastRecords key={`${airport}/${search.trim()}`} airport={airport} globalSearch={search.trim()} airports={airports.value} onSuccess={setSuccess} />
    </> : <section aria-label="Airports"><h2>Airports</h2><ul className="forecast-airport-list">{airports.value.map(record => <li key={record.id}><button type="button" className="record-button record-secondary" onClick={() => setAirport(String(record.id))}><strong>{record.code} — {record.name}</strong><span>{record.city}, {record.country}</span><span>{record.forecast_count === undefined ? 'Forecast count unavailable' : record.forecast_count === 0 ? 'No forecasts yet' : `${record.forecast_count} ${record.forecast_count === 1 ? 'forecast' : 'forecasts'}`}</span></button></li>)}</ul>{!airports.value.length && <p>No airports available.</p>}</section>)}
  </RecordLayout>
}
