import { apiRequest } from '../../api/client'
import { loadAirports } from '../../api/lookups'
import { loadFlights, loadForecasts } from '../../api/traffic'
import type { Forecast, CrowdLevel } from '../../types/traffic'
import type { DateExplanation, DateRecommendations } from './types'

export type ForecastInput = { airport: string; date: string; crowd_level: CrowdLevel | ''; crowd_score: string | null; data_source: string }

export function loadForecastList(filters: Parameters<typeof loadForecasts>[0] = {}) { return loadForecasts(filters) }
export function loadForecastAirports() { return loadAirports() }
export function loadForecastFlights(airport: number, date: string, page: number) {
  return loadFlights({ airport: String(airport), date, page, page_size: 4 })
}
export function getForecast(id: string) { return apiRequest<Forecast>(`/api/traffic/forecasts/${id}/`) }
export function createForecast(values: ForecastInput) { return apiRequest<Forecast>('/api/traffic/forecasts/', { method: 'POST', body: JSON.stringify(values) }) }
export function updateForecast(id: string, values: Partial<ForecastInput>) { return apiRequest<Forecast>(`/api/traffic/forecasts/${id}/`, { method: 'PATCH', body: JSON.stringify(values) }) }
export function deleteForecast(id: number) { return apiRequest<void>(`/api/traffic/forecasts/${id}/`, { method: 'DELETE' }) }
export function loadDateExplanation(airport: string, date: string) {
  return apiRequest<DateExplanation>(`/api/traffic/explanation/?${new URLSearchParams({ airport, date })}`)
}
export function loadDateRecommendations(airport: string, date: string, destination?: string) {
  return apiRequest<DateRecommendations>(`/api/traffic/recommendations/?${new URLSearchParams({ airport, date, ...(destination ? { destination } : {}) })}`)
}
