import { useCallback, useId, useState } from 'react'
import type { ReactNode } from 'react'
import type { Forecast } from '../types/traffic'
import { loadAirports, loadAirlines } from '../api/lookups'
import { loadFlights, loadForecasts, loadRouteDates } from '../api/traffic'
import { airlineOptions } from './lookupOptions'
import { useAppendPages } from './useAppendPages'
import RecordField from './RecordField'
import RecordAlert from './RecordAlert'
import CrowdChip from './CrowdChip'
import { formatFlightTime } from './flightTime'
import { calendarDate, calendarDateLabel, changeMonth, monthDates, monthLabel, projectToday } from './calendarDates'
import { useRemoteResource } from './useRemoteResource'
import previousIcon from '../assets/icons/chevron-leftIcon.png'
import nextIcon from '../assets/icons/chevron-rightIcon.png'
import clockIcon from '../assets/icons/ClockIcon.png'
import seatIcon from '../assets/icons/SeatIcon.png'
import './AirportCalendar.css'

export type CalendarSelection = { airport: string; destination?: string; date: string; forecast?: Forecast; onSelectDate: (date: string) => void }
export type CalendarPanels = { selectedStatus?: ReactNode; recommendations?: ReactNode }
export type CalendarRoute = { origin: string; destination: string; originCode: string; destinationCode: string }
type CalendarOptions = { sidebar?: boolean; bookingRoutes?: { origin: string; destination: string }[]; airlineFilter?: boolean; renderSelection?: (selection: CalendarSelection, renderCalendar: (panels: CalendarPanels) => ReactNode) => ReactNode; route?: CalendarRoute; onClearRoute?: () => void; renderDetails?: (selection: CalendarSelection) => ReactNode; renderAfter?: (selection: CalendarSelection) => ReactNode; showFlightDirections?: boolean }

function AirportMonth({ airport, renderDetails, renderAfter, showFlightDirections, route, onClearRoute, renderSelection, airline, sidebar, pickers }: { airport: string; airline?: string; pickers?: ReactNode } & CalendarOptions) {
  const routeOrigin = route?.origin
  const routeDestination = route?.destination
  const [routeAttempt, setRouteAttempt] = useState(0)
  const today = projectToday()
  const [selectedDate, setSelectedDate] = useState(today)
  const month = selectedDate.slice(0, 7)
  const [forecastAttempt, setForecastAttempt] = useState(0)
  const flightContext = `${airport}/${selectedDate}/${airline}/${route?.origin}/${route?.destination}`
  const fetchForecasts = useCallback(() => loadForecasts({ airport, month }), [airport, month])
  const fetchFlights = useCallback((page: number) => loadFlights({ airport, date: selectedDate, page, page_size: 4, ...(airline ? { airline } : {}), ...(routeOrigin && routeDestination ? { origin: routeOrigin, destination: routeDestination } : {}) }), [airport, selectedDate, routeOrigin, routeDestination, airline])
  const forecasts = useRemoteResource(`${airport}/${month}/${forecastAttempt}`, fetchForecasts)
  const flightPages = useAppendPages(flightContext, fetchFlights)
  const flights = { value: flightPages.result?.page ? flightPages.result.rows : undefined, error: flightPages.result?.error }
  const fetchRouteDates = useCallback(() => routeOrigin && routeDestination ? loadRouteDates(routeOrigin, routeDestination, month) : Promise.resolve(null), [routeOrigin, routeDestination, month])
  const routeDates = useRemoteResource(`route-dates/${route?.origin}/${route?.destination}/${month}/${routeAttempt}`, fetchRouteDates)
  const headingId = useId()
  const selectedForecast = forecasts.value?.find(record => record.date === selectedDate)
  const days = monthDates(month)
  const firstWeekday = calendarDate(days[0]!).getUTCDay()
  function selectMonth(offset: number) {
    const target = changeMonth(month, offset)
    setSelectedDate(target === today.slice(0,7) ? today : `${target}-01`)
  }
  const selection = { airport, destination: routeDestination, date: selectedDate, forecast: selectedForecast, onSelectDate: setSelectedDate }
  const body = (selectedStatus?: ReactNode) => <div className={`airport-calendar-layout${route ? ' route-mode' : ''}`}>
    <section className="airport-calendar-month" aria-labelledby={headingId}>
      {route && <><p>Route: {route.originCode} to {route.destinationCode}. Only route dates have crowd colors and a highlight ring.</p><button type="button" className="calendar-text-button" onClick={onClearRoute}>Show all crowd levels</button></>}
      {route && !routeDates.value && !routeDates.error && <p role="status">Loading route dates...</p>}
      {routeDates.error && <><RecordAlert kind="error">Unable to load route dates. Please try again.</RecordAlert><button className="calendar-text-button" onClick={() => setRouteAttempt(value => value + 1)}>Retry route dates</button></>}
      <div className="airport-calendar-heading">
        <h2 id={headingId}>{monthLabel(month)}</h2>
        <button type="button" className="calendar-month-button" aria-label="Previous month" onClick={() => selectMonth(-1)}><img src={previousIcon} alt="" /></button>
        <button type="button" className="calendar-month-button" aria-label="Next month" onClick={() => selectMonth(1)}><img src={nextIcon} alt="" /></button>
      </div>
      {!forecasts.value && !forecasts.error && <p role="status">Loading crowd forecasts…</p>}
      {forecasts.error && <><RecordAlert kind="error">Unable to load crowd forecasts. Please try again.</RecordAlert><button type="button" className="calendar-text-button" onClick={() => setForecastAttempt(value => value + 1)}>Retry forecasts</button></>}
      <div className="calendar-grid airport-day-grid" role="group" aria-label={`${monthLabel(month)} crowd levels`} aria-busy={!forecasts.value && !forecasts.error}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span className="weekday" key={day}>{day}</span>)}
        {Array.from({ length: firstWeekday }, (_, index) => <span aria-hidden="true" key={`blank-${index}`} />)}
        {days.map(date => {
          const forecast = forecasts.value?.find(record => record.date === date)
          const routeDay = routeDates.value?.find(item => item.date === date)
          const level = route && !routeDay ? undefined : forecast?.crowd_level
          const levelText = level ? `${level[0]!.toUpperCase()}${level.slice(1)} crowd` : forecasts.error ? 'Forecast unavailable' : forecasts.value ? 'No data' : 'Loading crowd forecast'
          const accessible = route ? routeDay ? `${calendarDateLabel(date)}, ${routeDay.flight_count} flights from ${route.originCode} to ${route.destinationCode}, ${levelText}` : `${calendarDateLabel(date)}, No flights on this route` : `${calendarDateLabel(date)}, ${levelText}`
          return <button type="button" key={date} className={`calendar-day ${level ?? 'no-data'}${routeDay ? ' route-highlight' : ''}`} aria-label={accessible} aria-pressed={selectedDate === date} aria-current={date === today ? 'date' : undefined} onClick={() => setSelectedDate(date)}>{Number(date.slice(-2))}</button>
        })}
      </div>
      <p>{route ? 'Route dates only; other days are neutral.' : 'All crowd levels for this airport.'}</p><div className="legend">{(['low', 'medium', 'high'] as const).map(level => <span key={level}><i className={level} aria-hidden="true" />{level[0]!.toUpperCase() + level.slice(1)}</span>)}<span><i className="no-data" aria-hidden="true" />No data</span></div>
    </section>
    <section className="airport-date-details" aria-live="polite" aria-atomic="true" aria-label="Selected date details">
      <h3>{calendarDateLabel(selectedDate)}</h3>
      {selectedStatus}
      {forecasts.value ? <CrowdChip level={selectedForecast?.crowd_level} /> : <p>{forecasts.error ? 'Crowd forecast unavailable.' : 'Loading crowd forecast…'}</p>}
      <p>Forecast dates: UTC. Calendar flights and route highlights use UTC dates.{renderSelection && ' Recommendations use Philippine dates.'}</p><p>{route ? 'Flights depart on the selected UTC date on this route.' : 'Flights include arrivals and departures on the selected UTC date.'}</p>
      <p>Flight times: Philippine time (Asia/Manila, UTC+08:00).</p>
      {!flights.value && !flights.error && <p role="status">Loading flights…</p>}
      {flights.error && <><RecordAlert kind="error">Unable to load flights. Please try again.</RecordAlert><button type="button" className="calendar-text-button" onClick={flightPages.result?.page ? flightPages.seeMore : flightPages.retry}>Retry flights</button></>}
      {flights.value?.length === 0 && <p>No flights listed for this date.</p>}
      {flights.value && flights.value.length > 0 && <ul className="calendar-flight-list">{flights.value.map(flight => <li key={flight.id}>
        <h4>{flight.airline_name} ({flight.airline_code}) · {flight.flight_number}</h4>
        {showFlightDirections && flight.direction && <p><strong>{flight.direction === 'departing' ? 'Departing' : 'Arriving'}</strong></p>}
        <p>{flight.origin_code} — {flight.origin_name} → {flight.destination_code} — {flight.destination_name}</p>
        <p><img src={clockIcon} alt="" /><span>Departure: <time dateTime={flight.departure_time}>{formatFlightTime(flight.departure_time)}</time><br />Arrival: <time dateTime={flight.arrival_time}>{formatFlightTime(flight.arrival_time)}</time></span></p>
        <p><img src={seatIcon} alt="" />{flight.available_seats} open seats / {flight.total_seats} total seats</p>
      </li>)}</ul>}
      {flights.value && <><p>Showing {flights.value.length} of {flightPages.result?.count} flights</p>{flightPages.result?.hasMore && <button type="button" className="calendar-text-button" onClick={flightPages.seeMore} disabled={flightPages.result.loading}>{flightPages.result.loading ? 'Loading more flights...' : 'See more'}</button>}</>}
      {renderDetails?.(selection)}
    </section>
  </div>
  function renderCalendar({ selectedStatus, recommendations }: CalendarPanels = {}) {
    return sidebar ? <div className="traffic-calendar-grid">
      <aside className="traffic-calendar-sidebar traffic-calendar-navy-panel traffic-calendar-controls" aria-label="Calendar filters">{pickers}</aside>
      <div className="traffic-calendar-main">{body(selectedStatus)}</div>
      <aside className="traffic-calendar-sidebar traffic-calendar-navy-panel traffic-calendar-suggestions" aria-label="Recommended travel dates">{recommendations}</aside>
    </div> : <>{pickers}{recommendations}{body(selectedStatus)}{renderAfter?.(selection)}</>
  }

  return renderSelection ? renderSelection(selection, renderCalendar) : renderCalendar()
}

export default function AirportCalendar(options: CalendarOptions) {
  const [booking, setBooking] = useState('')
  const [airline, setAirline] = useState('')
  const loadAirlineOptions = useCallback(() => options.airlineFilter ? loadAirlines() : Promise.resolve([]), [options.airlineFilter])
  const airlines = useRemoteResource(`calendar-airlines/${options.airlineFilter}`, loadAirlineOptions)
  const [airportId, setAirportId] = useState('')
  const [attempt, setAttempt] = useState(0)
  const airports = useRemoteResource(`airports/${attempt}`, loadAirports)
  const bookingRoute = options.bookingRoutes?.find(route => `${route.origin}/${route.destination}` === booking)
  const airportCode = (id: string) => airports.value?.find(airport => String(airport.id) === id)?.code ?? id
  const route = options.route ?? (bookingRoute ? { ...bookingRoute, originCode: airportCode(bookingRoute.origin), destinationCode: airportCode(bookingRoute.destination) } : undefined)
  function clearRoute() { if (route) setAirportId(route.origin); setBooking(''); options.onClearRoute?.() }
  const selectedAirport = route?.origin || airportId || String(airports.value?.[0]?.id ?? '')
  const pickers = <>      <RecordField searchable navy={options.sidebar} name="calendar-airport" label="Airport" value={selectedAirport} onChange={value => { setBooking(''); options.onClearRoute?.(); setAirportId(value) }} options={(airports.value ?? []).map(airport => ({ value: String(airport.id), label: `${airport.code} — ${airport.name}`, searchText: `${airport.city} ${airport.country}` }))} />
      {options.airlineFilter && <>
        {airlines.value && <RecordField searchable navy={options.sidebar} name="calendar-airline" label="Airline" value={airline} onChange={setAirline} options={[{ value: '', label: 'All airlines' }, ...airlineOptions(airlines.value)]} />}
        {!airlines.value && !airlines.error && <p role="status">Loading airlines...</p>}
        {airlines.error && <RecordAlert kind="error">{airlines.error}</RecordAlert>}
      </>}
      {options.bookingRoutes && <>
        <RecordField searchable navy={options.sidebar} name="calendar-booking" label="My booking" value={booking} onChange={value => value ? setBooking(value) : clearRoute()} options={[{ value: '', label: 'No booking' }, ...options.bookingRoutes.map(saved => ({ value: `${saved.origin}/${saved.destination}`, label: `${airportCode(saved.origin)} to ${airportCode(saved.destination)}` }))]} />
        {!options.bookingRoutes.length && <p>No saved bookings yet. Search flights on Home.</p>}
        {bookingRoute && <p className="calendar-booking-chip">Booking: {route?.originCode} to {route?.destinationCode} <button type="button" className="calendar-text-button" onClick={clearRoute}>Clear</button></p>}
      </>}
      {options.airlineFilter && <>
        <p>Crowd levels are per airport. The airline filter only changes the flight list.</p>
      </>}
</>
  return <section className={`airport-calendar${options.sidebar ? ' airport-calendar-sidebar-card' : ''}`} aria-label="Airport traffic calendar">
    {!airports.value && !airports.error && <p role="status">Loading airports…</p>}
    {airports.error && <><RecordAlert kind="error">Unable to load airports. Please try again.</RecordAlert><button type="button" className="calendar-text-button" onClick={() => setAttempt(value => value + 1)}>Retry airports</button></>}
    {airports.value && <>
      {selectedAirport ? <AirportMonth airline={airline} airport={selectedAirport} {...options} route={route} pickers={pickers} onClearRoute={clearRoute} /> : <p>No airports available.</p>}
    </>}
  </section>
}
