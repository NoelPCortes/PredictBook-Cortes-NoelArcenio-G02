# Staff dashboard

[Documentation index](../README.md) ? [Accounts and access](accounts.md)

## Period, airport and permissions

`/staff/dashboard` is protected by the existing RoleRoute for Staff and Heads.
The page retains the existing `/api/dashboard/` access probe, but ignores its
legacy sample marker and takes all displayed figures from
`GET /api/dashboard/summary/?airport=<id>`. The summary endpoint independently
requires authenticated Staff/Head access: 401 signed out and 403 for Travelers.
No user identity fields appear in its response.

The period is today through today + 29 days inclusive in settings.TIME_ZONE,
currently UTC. It covers one airport. With airport omitted, the server chooses
the first airport alphabetically by code with any forecast in the period, or the
first airport by code if none has forecasts. No airports yields airport=null and
empty counts/date lists. All Airports aggregation remains TBD.

## Summary response

- airport: id, code, name (or null).
- period_start and period_end: ISO dates.
- counts: low, medium, high day counts.
- dates: low, medium, high arrays of {date, weekday}, sorted by date.
- busiest_weekday: the weekday with most high days, or null. Ties choose the
  weekday whose first high-crowd date occurs earliest in the period.
- next_7_days: seven {date, weekday, crowd_level} rows from today; absent forecasts
  use crowd_level=null.

Both manual and calculated forecasts contribute their stored levels. The page
shows a clear no-data message when the selected airport has no forecast in the
period. Busiest weekday then shows No data; it is not invented from empty counts.

## Layout and interaction

The header has STAFF DASHBOARD, Crowd overview, an airport dropdown, Next 30 days,
and the returned date range. Four cards show High, Medium, Low day counts and
Busiest weekday. Three equal-height grid cards list every date under its level,
with a count and text/color date chips or a level-specific empty message. These
cards stack on narrow screens. A seven-day strip shows weekday, date and level
or No data. Your records is last and uses mine=true flight and forecast reads.
Every container has content; no placeholder chart link or fixed empty panel is
rendered. Shared spacing, colors, controls, focus and table styles follow the UI
guide. Summary and own-record errors have independent retry states.

January fixtures, their calculation helper, and the Home sample-data module have
been removed. There are no sample labels or fixed future dates on this page.
Heads retain Dashboard, Flights, Crowd forecasts and Head management navigation
on this and every other Staff page. Staff see the first three links only.

The Dashboard weekday range chart is implemented below. A separate Charts page, its
additional chart definitions/API contracts and routes remain TBD. There is no
new dashboard table or individual traveler detail in these summaries.

## Verification

The Your records counts use `mine=true` for flights and forecasts. Forecast counts
measure creator ownership even though Staff and Heads can edit any forecast.
Flight edits remain owner-only for Staff. An available-seat change recalculates
affected automatic forecasts before returning success, so a fresh dashboard or
forecast request reads the updated totals.

Backend tests cover counts, ordered dates, weekdays, tie behavior, period bounds,
airport selection, project timezone, permissions and response privacy. Frontend
API-mocked tests cover the real layout/data, airport changes, zero-data states,
loading, retries and own-record counts. A live visual/browser walkthrough remains
unverified; tests do not establish a pixel-perfect layout on each viewport.


## Flight/history comparison

The existing summary now includes comparison with:
average_occupancy_2026_percent, average_occupancy_2025_percent, difference_points,
days_busier_than_2025, days_quieter_than_2025 and days_compared.
Over forecast dates for the chosen airport/period, average the raw daily flight
occupancies and the available daily history averages. History uses the same
three offsets and positive-seat records as forecast calculation. Missing values
are omitted from their respective averages; difference_points is the difference
of those unrounded averages, or null if either is absent. Returned percentages
and difference are rounded to one decimal. Daily busier/quieter counts compare
only dates with both values; equal days count in days_compared but neither side.
No user details appear.

There is no Charts page, so a 2026 flights vs 2025 history card appears before
Your records. It shows all six fields, uses No data for unavailable values and
No 2025 history for this period. when history is absent. It shares the selected
airport, summary loading/error/retry and period. API-mocked tests cover values
and the no-history case; backend tests use hand-calculated daily averages.


## Weekday range chart and counts

The summary adds days for forecast dates in the period, each with date, weekday,
crowd_level, crowd_score, seats_booked, seats_total and flight_count. The existing
flight/history aggregates are shared with comparison, avoiding a query per date.
A null manual score uses the matching 2025 daily history average for this read
only; no stored manual field or level changes. Without that history it stays null.
The backend regression test guards five data queries for an explicit airport,
with authentication resolved, across different numbers of dates.

The summary also returns weekday_ranges: exactly seven rows, Sunday through
Saturday, with weekday, day_count, min_score, min_date, max_score, max_date,
max_day_seats_booked, max_day_seats_total and max_day_flight_count. Ranges include
forecast dates with a usable numeric score (including the history fallback).
Missing usable scores give day_count=0 and null numeric/date values. Equal-score
dates choose the earlier date. Existing bulk aggregates supply the busiest
(maximum score) date's flight totals without additional queries per weekday.

CrowdChart renders seven focusable range buttons, Sun to Sat, on a 0-100 scale.
Each bar starts at the weekday's least score and ends at its most, with Least/Most
labels and the crowd color of its maximum score. Zero-width ranges keep a visible
line. Empty weekdays say No data. Weekdays and Weekend brackets, dashed 50/75
reference lines, and a Low/Medium/High/No data text legend explain the chart.
Hover, focus or selection updates the accessible detail line with weekday,
minimum/maximum scores and dates, number of days, and the maximum date's booked
seats, total seats and flight count. No chart library or SVG is used.

The Airport picker waits for the server's selected default rather than showing
an empty Choose airport value. The server still prefers the first code with a
forecast in the period, otherwise the first alphabetical code. Summary loading,
error/retry and empty states apply to the chart; unrelated cards remain intact.

All summary cards, level date lists, Next 7 days, comparison and Your records
remain. Loading/errors use the summary's existing states. Your records requests
mine=true with page_size=1 and uses response count, rather than downloading all
created records. No fulfilled-response cache is used.
