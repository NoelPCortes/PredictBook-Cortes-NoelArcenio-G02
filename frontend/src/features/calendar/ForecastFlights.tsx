import { useCallback } from 'react'
import clockIcon from '../../assets/icons/ClockIcon.png'
import RecordAlert from '../../components/RecordAlert'
import { formatFlightTime } from '../../components/flightTime'
import { useAppendPages } from '../../components/useAppendPages'
import { loadForecastFlights } from './api'
import '../../components/AirportCalendar.css'

export default function ForecastFlights({ airport, date }: { airport: number; date: string }) {
  const load = useCallback((page: number) => loadForecastFlights(airport, date, page), [airport, date])
  const { result, retry, seeMore } = useAppendPages(`${airport}/${date}`, load)

  if (!result) return <p role="status">Loading flights...</p>

  return <div className="forecast-flights">
    {result.error && <RecordAlert kind="error">{result.error}</RecordAlert>}
    {result.page === 0 && <div><button type="button" className="record-button record-secondary" onClick={retry}>Retry flights</button></div>}
    {result.page > 0 && <>
      {result.rows.length === 0 ? <p>No flights listed for this date.</p> : <>
        <p>Flight times are in Philippine time (Asia/Manila).</p>
        <ul className="calendar-flight-list">{result.rows.map(flight => <li key={flight.id}>
          <h4>{flight.flight_number}</h4>
          <p>{flight.origin_code} to {flight.destination_code}</p>
          <p><strong>{flight.direction === 'arriving' ? 'Arriving' : 'Departing'}</strong></p>
          <p><img src={clockIcon} alt="" /><span>
            Departure: <time dateTime={flight.departure_time}>{formatFlightTime(flight.departure_time)}</time><br />
            Arrival: <time dateTime={flight.arrival_time}>{formatFlightTime(flight.arrival_time)}</time>
          </span></p>
          <p>{flight.total_seats - flight.available_seats} of {flight.total_seats} seats</p>
        </li>)}</ul>
      </>}
      <p role="status">Showing {result.rows.length} of {result.count} flights</p>
      {result.hasMore && <div><button type="button" className="record-button record-secondary" onClick={seeMore} disabled={result.loading}>{result.loading ? 'Loading more flights...' : 'See more'}</button></div>}
    </>}
  </div>
}
