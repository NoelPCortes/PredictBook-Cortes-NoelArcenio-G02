import type { CrowdLevel } from '../../types/traffic'

export type DateExplanation = {
  airport: { id: number; code: string; name: string }
  date: string; weekday: string; has_data: boolean
  flights: { count: number; departing_count: number; arriving_count: number; seats_total: number; seats_booked: number; occupancy_percent: number | null }
  history: { used_dates: string[]; records: { date: string; weekday: string; seats_booked: number; seats_total: number; occupancy_percent: number }[]; average_occupancy_percent: number | null }
  weights: { flights: number; history: number }
  thresholds: { medium_from: number; high_from: number }
  crowd_score: number | null; crowd_level: CrowdLevel | null; history_available: boolean
  open_seats: number; sentences: string[]
}

export type RecommendationFlight = { airline_name: string; airline_code: string; flight_number: string; origin_code: string; destination_code: string; departure_time: string; available_seats: number }
export type DateRecommendations = {
  route: { origin_code: string; destination_code: string } | null
  selected: { date: string; has_data: boolean; crowd_score: number | null; crowd_level: CrowdLevel | null }
  selected_status: { state: 'bookable' | 'full' | 'departed' | 'no_flights'; message: string }
  recommendations: {
    date: string; weekday: string; crowd_level: 'low' | 'medium'; crowd_score: number; score_difference: number | null
    flights: RecommendationFlight[]; open_seats: number; flight_count: number; history_average_occupancy_percent: number | null; reasons: string[]
  }[]
  message: string
}
