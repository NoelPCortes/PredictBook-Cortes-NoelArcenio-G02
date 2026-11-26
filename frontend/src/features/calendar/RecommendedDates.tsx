import { useCallback, useId, useState } from 'react'
import type { CalendarPanels, CalendarSelection } from '../../components/AirportCalendar'
import type { ReactNode } from 'react'
import CrowdChip from '../../components/CrowdChip'
import { calendarDateLabel } from '../../components/calendarDates'
import RecordAlert from '../../components/RecordAlert'
import { useRemoteResource } from '../../components/useRemoteResource'
import { formatFlightTime } from '../../components/flightTime'
import clockIcon from '../../assets/icons/ClockIcon.png'
import seatIcon from '../../assets/icons/SeatIcon.png'
import bulbIcon from '../../assets/icons/bulbIcon.png'
import { loadDateRecommendations } from './api'
import './CalendarInsights.css'

export default function RecommendedDates({ airport, destination, date, onSelectDate, renderCalendar }: CalendarSelection & { renderCalendar: (panels: CalendarPanels) => ReactNode }) {
  const [attempt, setAttempt] = useState(0)
  const heading = useId()
  const load = useCallback(() => destination ? loadDateRecommendations(airport, date, destination) : loadDateRecommendations(airport, date), [airport, date, destination])
  const resource = useRemoteResource(`recommendations/${airport}/${date}/${destination}/${attempt}`, load)
  const result = resource.value
  const status = result?.selected_status
  const selectedStatus = status && status.state !== 'bookable' ? <p className="selected-flight-status">{status.message}</p> : undefined
  const recommendations = <section className="calendar-recommendations" aria-labelledby={heading} aria-live="polite">
    <h2 id={heading}><img src={bulbIcon} alt="" className="navy-white-icon" />Recommended best date to travel</h2>
    {!result && !resource.error && <p role="status">Loading recommended dates…</p>}
    {resource.error && <><RecordAlert kind="error">{resource.error}</RecordAlert><button type="button" className="calendar-text-button" onClick={() => setAttempt(value => value + 1)}>Retry recommendations</button></>}
    {result && <>
      {!result.selected.has_data && <p>Your selected date has no forecast. No score comparison is available.</p>}
      {result.selected.has_data && result.selected.crowd_score === null && <p>Your selected forecast has no numeric score. No score comparison is available.</p>}
      {result.message && <p>{result.message}</p>}
      {result.recommendations.length > 0 && <div className="calendar-recommendation-grid">{result.recommendations.map(recommendation => <button type="button" className="calendar-recommendation-card" key={recommendation.date} onClick={() => onSelectDate(recommendation.date)} aria-label={`Select ${calendarDateLabel(recommendation.date)}, ${recommendation.crowd_level} crowd`}>
        <span className="recommendation-date">{recommendation.weekday}, {calendarDateLabel(recommendation.date)}</span>
        <CrowdChip level={recommendation.crowd_level} />
        <span>Score: {recommendation.crowd_score.toFixed(1)}</span>
        {recommendation.score_difference !== null && recommendation.score_difference > 0 && <span>{recommendation.score_difference.toFixed(1)} points lower than your selected date</span>}
        <span>{recommendation.open_seats} open seats</span>
        {recommendation.flights.map(flight => <span className="recommendation-flight" key={`${flight.flight_number}/${flight.departure_time}`}>
          <strong>{flight.airline_name} ({flight.airline_code}) {flight.flight_number}</strong>
          <span>{flight.origin_code} to {flight.destination_code}</span>
          <span><img src={clockIcon} alt="" />{formatFlightTime(flight.departure_time)}</span>
          <span><img src={seatIcon} alt="" />{flight.available_seats} open seats</span>
        </span>)}
        <span className="recommendation-reasons" role="list">{recommendation.reasons.map(reason => <span role="listitem" key={reason}>{reason}</span>)}</span>
      </button>)}</div>}
    </>}
  </section>
  return renderCalendar({ selectedStatus, recommendations })
}
