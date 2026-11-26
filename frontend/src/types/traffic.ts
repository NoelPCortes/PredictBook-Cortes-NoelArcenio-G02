export type CrowdLevel = 'low' | 'medium' | 'high'
export type Forecast = {
  id: number; airport: number; date: string; crowd_level: CrowdLevel
  crowd_score: number | null; calculated_at: string; data_source: string | null
  created_by_username?: string | null; can_edit?: boolean; can_delete?: boolean
  is_calculated: boolean; flight_count: number; seats_total: number; seats_booked: number
}
