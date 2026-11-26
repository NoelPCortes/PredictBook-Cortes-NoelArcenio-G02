import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import RecordLayout from '../../components/RecordLayout'
import RecordAlert from '../../components/RecordAlert'
import RecordField from '../../components/RecordField'
import { useRecordErrors } from '../../components/useRecordErrors'
import type { Airport } from '../../types/flights'
import type { CrowdLevel } from '../../types/traffic'
import { createForecast, getForecast, loadForecastAirports, updateForecast } from './api'
import type { ForecastInput } from './api'

const EMPTY_FORECAST: ForecastInput = { airport: '', date: '', crowd_level: '', crowd_score: '', data_source: '' }
const FIELD_NAMES = Object.keys(EMPTY_FORECAST)

function ForecastForm({ id }: { id?: string }) {
  const navigate = useNavigate()
  const [values, setValues] = useState<ForecastInput>(EMPTY_FORECAST)
  const [airports, setAirports] = useState<Airport[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<'not-found' | 'unavailable' | null>(null)
  const [canEdit, setCanEdit] = useState(!id)
  const [isCalculated, setIsCalculated] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const { formRef, errors, formError, clearErrors, showErrors } = useRecordErrors(FIELD_NAMES)
  useEffect(() => {
    let isActive = true
    const forecastRequest = id ? getForecast(id).catch(error => {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }) : Promise.resolve(null)
    void Promise.all([loadForecastAirports(), forecastRequest])
      .then(([options, record]) => {
        if (!isActive) return
        if (id && !record) {
          setLoadError('not-found')
          return
        }
        setAirports(options)
        if (record) {
          setCanEdit(record.can_edit === true)
          setIsCalculated(record.is_calculated)
          setValues({ airport: String(record.airport), date: record.date, crowd_level: record.crowd_level, crowd_score: record.crowd_score === null ? '' : String(record.crowd_score), data_source: record.data_source ?? '' })
        }
      })
      .catch(() => { if (isActive) setLoadError('unavailable') })
      .finally(() => { if (isActive) setIsLoading(false) })
    return () => { isActive = false }
  }, [id, attempt])
  function change(name: keyof ForecastInput, value: string) { setValues(previous => ({ ...previous, [name]: value })) }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (isSaving) return
    clearErrors(); setIsSaving(true)
    const payload = { ...values, crowd_score: values.crowd_score === '' ? null : values.crowd_score }
    try {
      if (id) await updateForecast(id, isCalculated ? { crowd_level: payload.crowd_level, crowd_score: payload.crowd_score } : payload)
      else await createForecast(payload)
      navigate('/staff/forecasts', { state: { success: id ? 'Forecast updated.' : 'Forecast created.' } })
    } catch (error) { showErrors(error, 'Unable to save the forecast. Please try again.'); setIsSaving(false) }
  }
  return <RecordLayout>
    <h1>{id ? 'Edit forecast' : 'Add forecast'}</h1>
    {isLoading && <p role="status">Loading forecast form…</p>}
    {loadError === 'not-found' && <><RecordAlert kind="error">Forecast not found.</RecordAlert><div><Link className="record-button record-secondary" to="/staff/forecasts">Back to forecasts</Link></div></>}
    {loadError === 'unavailable' && <><RecordAlert kind="error">Unable to load the forecast form. Please try again.</RecordAlert><div><button type="button" className="record-button record-secondary" onClick={() => { setLoadError(null); setIsLoading(true); setAttempt(value => value + 1) }}>Try again</button></div></>}
    {!isLoading && !loadError && !canEdit && <RecordAlert kind="error">You do not have permission to edit this forecast.</RecordAlert>}
    {!isLoading && !loadError && canEdit && <form ref={formRef} className="record-form" onSubmit={submit} noValidate>
      {formError && <RecordAlert kind="error">{formError}</RecordAlert>}
      <div className="record-fields">
        {isCalculated ? <>
          <p><strong>Airport</strong> {airports.find(airport => String(airport.id) === values.airport)?.code ?? values.airport}</p>
          <p><strong>Date</strong> <time dateTime={values.date}>{values.date}</time></p>
          <p><strong>Source</strong> Calculated automatically. Saving changes makes this a Staff entry.</p>
        </> : <>
          <RecordField searchable name="airport" label="Airport" value={values.airport} onChange={value => change('airport', value)} error={errors.airport} options={airports.map(airport => ({ value: String(airport.id), label: `${airport.code} — ${airport.name}`, searchText: `${airport.city} ${airport.country}` }))} />
          <RecordField name="date" label="Date" type="date" value={values.date} onChange={value => change('date', value)} error={errors.date} />
          {id && <p><strong>Source</strong> Staff entry</p>}
        </>}
        <RecordField name="crowd_level" label="Crowd level" value={values.crowd_level} onChange={value => change('crowd_level', value as CrowdLevel | '')} error={errors.crowd_level} options={['Low', 'Medium', 'High'].map(level => ({ value: level.toLowerCase(), label: level }))} />
        <RecordField name="crowd_score" label="Crowd score (optional)" type="number" step="any" value={values.crowd_score ?? ''} onChange={value => change('crowd_score', value)} error={errors.crowd_score} />
        {!isCalculated && <RecordField name="data_source" label="Data source (optional)" value={values.data_source} onChange={value => change('data_source', value)} error={errors.data_source} maxLength={100} />}
      </div>
      <div className="record-actions"><button type="submit" className="record-button" disabled={isSaving}>{isSaving ? 'Saving…' : id ? 'Save forecast' : 'Create forecast'}</button><Link className="record-button record-ghost" to="/staff/forecasts">Cancel</Link></div>
    </form>}
  </RecordLayout>
}

export default function ForecastFormPage() {
  const { id } = useParams<{ id: string }>()
  return <ForecastForm key={id ?? 'new'} id={id} />
}
