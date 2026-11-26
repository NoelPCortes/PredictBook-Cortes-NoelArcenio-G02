import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import RecordLayout from '../../components/RecordLayout'
import RecordAlert from '../../components/RecordAlert'
import RecordField from '../../components/RecordField'
import { useRecordErrors } from '../../components/useRecordErrors'
import { usePendingAction } from '../../components/usePendingAction'
import { flightTimeInput, flightTimePayload } from '../../components/flightTime'
import type { Airline, Airport, Flight } from '../../types/flights'
import { createFlight, getFlight, loadFlightOptions, updateFlight } from './api'
import type { FlightInput } from './api'

const EMPTY_FLIGHT: FlightInput = { airline: '', flight_number: '', origin: '', destination: '', departure_time: '', arrival_time: '', total_seats: '', available_seats: '' }
const FIELD_NAMES = Object.keys(EMPTY_FLIGHT)

function inputValues(flight: Flight): FlightInput {
  return {
    airline: String(flight.airline), flight_number: flight.flight_number, origin: String(flight.origin), destination: String(flight.destination),
    departure_time: flightTimeInput(flight.departure_time), arrival_time: flightTimeInput(flight.arrival_time),
    total_seats: String(flight.total_seats), available_seats: String(flight.available_seats),
  }
}

function FlightForm({ id }: { id?: string }) {
  const navigate = useNavigate()
  const [values, setValues] = useState<FlightInput>(EMPTY_FLIGHT)
  const [originalValues, setOriginalValues] = useState<FlightInput | null>(null)
  const [airports, setAirports] = useState<Airport[]>([])
  const [airlines, setAirlines] = useState<Airline[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<'not-found' | 'unavailable' | null>(null)
  const [canEdit, setCanEdit] = useState(!id)
  const { isPending: isSaving, tryBegin, finish } = usePendingAction()
  const [attempt, setAttempt] = useState(0)
  const { formRef, errors, formError, clearErrors, showErrors } = useRecordErrors(FIELD_NAMES)
  useEffect(() => {
    let isActive = true
    const flightRequest = id ? getFlight(id).catch(error => {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }) : Promise.resolve(null)
    void Promise.all([loadFlightOptions(), flightRequest])
      .then(([[airportOptions, airlineOptions], flight]) => {
        if (!isActive) return
        if (id && !flight) {
          setLoadError('not-found')
          return
        }
        setAirports(airportOptions); setAirlines(airlineOptions)
        if (flight) {
          const initialValues = inputValues(flight)
          setValues(initialValues); setOriginalValues(initialValues); setCanEdit(flight.can_edit === true)
        }
      })
      .catch(() => { if (isActive) setLoadError('unavailable') })
      .finally(() => { if (isActive) setIsLoading(false) })
    return () => { isActive = false }
  }, [id, attempt])
  function change(name: keyof FlightInput, value: string) { setValues(previous => ({ ...previous, [name]: value })) }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!tryBegin()) return
    clearErrors()
    const payload = { ...values, departure_time: flightTimePayload(values.departure_time), arrival_time: flightTimePayload(values.arrival_time) }
    try {
      if (id) {
        const changes: Partial<FlightInput> = {}
        for (const field of FIELD_NAMES as (keyof FlightInput)[]) {
          if (values[field] !== originalValues?.[field]) changes[field] = payload[field]
        }
        await updateFlight(id, changes)
      } else await createFlight(payload)
      navigate('/staff/flights', { state: { success: id ? 'Flight updated.' : 'Flight created.' } })
    } catch (error) {
      showErrors(error, 'Unable to save the flight. Please try again.')
      finish()
    }
  }
  const airportOptions = airports.map(airport => ({ value: String(airport.id), label: `${airport.code} — ${airport.name}`, searchText: `${airport.city} ${airport.country}` }))
  return <RecordLayout>
    <h1>{id ? 'Edit flight' : 'Add flight'}</h1>
    <p>Enter flight dates and times in Philippine time (Asia/Manila, UTC+08:00).</p>
    {isLoading && <p role="status">Loading flight form…</p>}
    {loadError === 'not-found' && <><RecordAlert kind="error">Flight not found.</RecordAlert><div><Link className="record-button record-secondary" to="/staff/flights">Back to flights</Link></div></>}
    {loadError === 'unavailable' && <><RecordAlert kind="error">Unable to load the flight form. Please try again.</RecordAlert><div><button type="button" className="record-button record-secondary" onClick={() => { setLoadError(null); setIsLoading(true); setAttempt(value => value + 1) }}>Try again</button></div></>}
    {!isLoading && !loadError && !canEdit && <RecordAlert kind="error">You do not have permission to edit this flight.</RecordAlert>}
    {!isLoading && !loadError && canEdit && <form ref={formRef} className="record-form" onSubmit={submit} noValidate aria-busy={isSaving}>
      {formError && <RecordAlert kind="error">{formError}</RecordAlert>}
      <div className="record-fields">
        <RecordField searchable name="airline" label="Airline" value={values.airline} onChange={value => change('airline', value)} error={errors.airline} options={airlines.map(airline => ({ value: String(airline.id), label: `${airline.name} (${airline.code})` }))} />
        <RecordField name="flight_number" label="Flight number" value={values.flight_number} onChange={value => change('flight_number', value)} error={errors.flight_number} maxLength={10} />
        <RecordField searchable name="origin" label="Origin" value={values.origin} onChange={value => change('origin', value)} error={errors.origin} options={airportOptions} />
        <RecordField searchable name="destination" label="Destination" value={values.destination} onChange={value => change('destination', value)} error={errors.destination} options={airportOptions} />
        <RecordField name="departure_time" label="Departure (date and time)" value={values.departure_time} onChange={value => change('departure_time', value)} error={errors.departure_time} type="datetime-local" />
        <RecordField name="arrival_time" label="Arrival (date and time)" value={values.arrival_time} onChange={value => change('arrival_time', value)} error={errors.arrival_time} type="datetime-local" />
        <RecordField name="total_seats" label="Total seats" value={values.total_seats} onChange={value => change('total_seats', value)} error={errors.total_seats} type="number" step="1" />
        <RecordField name="available_seats" label="Available seats" value={values.available_seats} onChange={value => change('available_seats', value)} error={errors.available_seats} type="number" step="1" />
      </div>
      <div className="record-actions"><button type="submit" className="record-button" disabled={isSaving}>{isSaving ? 'Saving…' : id ? 'Save flight' : 'Create flight'}</button><Link className="record-button record-ghost" to="/staff/flights">Cancel</Link></div>
    </form>}
  </RecordLayout>
}

export default function FlightFormPage() {
  const { id } = useParams<{ id: string }>()
  return <FlightForm key={id ?? 'new'} id={id} />
}
