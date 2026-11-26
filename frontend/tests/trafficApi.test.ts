// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { getOwnRecordCounts } from '../src/features/staff-dashboard/api'
import { loadForecastFlights } from '../src/features/calendar/api'
import { loadFlights, loadForecasts } from '../src/api/traffic'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

it('counts only the results from mine=true requests for both record types', async () => {
  vi.stubEnv('VITE_API_URL', 'https://api.example.test')
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async url => new Response(JSON.stringify(
    { count: String(url).includes('/api/flights/') ? 2 : 1, results: [{ id: 1 }], next: null, previous: null },
  ), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  expect(await getOwnRecordCounts()).toEqual({ flights: 2, forecasts: 1 })
  expect(fetchMock.mock.calls.map(([url]) => String(url)).sort()).toEqual([
    'https://api.example.test/api/flights/?page_size=1&mine=true',
    'https://api.example.test/api/traffic/forecasts/?page_size=1&mine=true',
  ])
})

it('sends the selected airport, month and departure date through shared reads', async () => {
  vi.stubEnv('VITE_API_URL', 'https://api.example.test')
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{"count":0,"results":[],"next":null,"previous":null}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await loadFlights({ origin: '2', date: '2026-12-01' })
  await loadForecasts({ airport: '2', month: '2026-12' })
  expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
    'https://api.example.test/api/flights/?origin=2&date=2026-12-01',
    'https://api.example.test/api/traffic/forecasts/?airport=2&month=2026-12',
  ])
})

it('rejects an obsolete unpaginated response instead of showing unfiltered flights', async () => {
  vi.stubEnv('VITE_API_URL', 'https://api.example.test')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[{"id":1}]')))
  await expect(loadFlights({ origin: '2', destination: '3', upcoming: true })).rejects.toMatchObject({
    fields: { detail: expect.stringContaining('Restart the backend') },
  })
})

it('requests four flights for the forecast airport and date', async () => {
  vi.stubEnv('VITE_API_URL', 'https://api.example.test')
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"count":0,"results":[],"next":null,"previous":null}'))
  vi.stubGlobal('fetch', fetchMock)
  await loadForecastFlights(2, '2026-12-01', 2)
  expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.test/api/flights/?airport=2&date=2026-12-01&page=2&page_size=4')
})
