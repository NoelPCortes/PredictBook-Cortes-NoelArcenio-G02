# Traffic calendar and forecast calculation

[Documentation index](../README.md) ? [Database](../database.md)

## Live calendars

HomeCalendar and the Traveler-only `/calendar` route reuse AirportCalendar. One
airport is chosen from the authenticated airport lookup; All Airports aggregation
remains TBD. Month navigation uses the existing PNG chevrons, real month lengths,
and real weekdays. Every day exposes its date and level in its accessible name.
Selection uses aria-pressed, today uses aria-current=date, and the legend and
selected-date chip keep levels available as text. Missing forecasts show No data.
Loading and request failures are distinct from missing data, with retry controls
and stale-response protection.

Forecast dates and the calendar's initial today use the project timezone,
currently UTC. Flight entry and time display remain Philippine time; the panel
labels that distinction. It reads arrivals and departures through
`GET /api/flights/?airport=<id>&date=YYYY-MM-DD`, so the displayed flight set
matches the forecast's live references. The earlier origin/date filter retains
its Philippine departure-date behavior. Flight details include airline, flight
number, route, departure/arrival times with ClockIcon, and open seats with SeatIcon.
No flights listed for this date is shown only for a successful empty response.
There is no Your bookings row in the calendar. Home's separate cards now summarize
browser route searches, not stored bookings; its calendar can highlight a route.

Landing and sign-in/sign-up retain their separate marketing previews. Landing's
inactive flight search form was removed. Real recommendations appear only on /calendar.
production datasets and accuracy evaluation remain TBD. The product's 75% accuracy
target has not been measured by this seat-utilization calculation.

## Calculation rule

For airport A and project-local date D, count flights with origin A and departure
local date D, plus flights with destination A and arrival local date D. A route's
origin and destination differ, so one flight contributes once to a given pair.
An overnight flight may contribute on different origin and destination dates.

- seats_total: sum of total_seats for the counted flights.
- seats_booked: sum of total_seats minus available_seats.
- flight occupancy: seats_booked / seats_total * 100.
- history occupancy: simple average of each existing positive-seat historical record
  at D minus 371, 364, and 357 days (matching weekdays around a year earlier).
- crowd_score: 0.5 * flight occupancy + 0.5 * history occupancy, rounded once
  to one decimal. Without history use flights only and explain that fallback.
- Low: score below 50. Medium: 50 to below 75. High: 75 or above.

Rounding uses decimal half-up before classifying the score. MEDIUM_THRESHOLD and
HIGH_THRESHOLD, FLIGHT_WEIGHT=0.5, HISTORY_WEIGHT=0.5,
HISTORY_DAY_OFFSETS=(371,364,357), RECOMMENDATION_WINDOW=7, and
MAX_RECOMMENDATIONS=3 are defined once in backend/traffic/calculation.py. No flights or
zero total seats gives no calculated forecast. Colors remain frontend styles;
no color or aggregate-count column is stored in PostgreSQL.

Calculated rows have exact source Calculated from 2026 flights and 2025 history and the current
calculation timestamp. Their required creator is the user triggering the first
calculation; management commands use the configured seed Staff user. Later
recalculations preserve that original calculated creator.

Legacy Calculated from flights rows are also calculated and upgraded
on recalculation without changing their creator. Every source except these two
calculated labels and exact Sample data is manual.
Manual forecasts, including old blank/null sources, always take precedence and
are never overwritten or deleted by recalculation. Blank API source input is
normalized to Staff entry. A manual score can be left blank or set from 0 to
100. The automatic thresholds do not override the manually chosen level.

## Transactions, permissions and references

Existing flight create, PATCH and DELETE services explicitly recalculate the
affected pairs in the same database transaction. Updates include both old and new
origin/departure and destination/arrival pairs. Failure rolls back the flight
change. If no seats remain, only a calculated row is removed. No signals are used.
Airport locks serialize flight calculations and manual writes.

All signed-in roles can read forecasts. Staff and Heads can create manual
forecasts, edit any forecast, and delete manual forecasts. Editing a calculated
forecast changes its source to `Staff entry`, stamps the current time, and keeps
its creator. A change to the airport or date of a calculated row returns 400.
Deleting a calculated forecast returns 403. Deleting a manual forecast recalculates
its pair in the same transaction and restores the calculated row when flights
supply seat data. Reserved calculated sources and client-supplied `created_by`
or `calculated_at` return 400.

Forecast responses add is_calculated, flight_count, seats_total and seats_booked.
The numbers are live aggregates even for manual forecasts. Staff/Head responses
include `can_edit=true` and show `Calculated automatically` for calculated rows,
which have `created_by_username=null` and `can_delete=false`. Manual rows show
`Staff entry` and have `can_delete=true`. Traveler responses omit creator
information and write flags. Two
aggregate flight queries serve the entire forecast list, rather than querying
per row; a regression test fixes the nonempty list at four forecast-data queries (count, page and two flight aggregates), with authentication already resolved.

`GET /api/traffic/forecasts/` supports airport, month=YYYY-MM, and mine=true.
POST creates manual entries. Detail GET/PATCH/DELETE remains at
`/api/traffic/forecasts/<id>/`. One airport/date row is still enforced, and expected
constraint failures return field-level 400 messages.

The Staff forecast table shows Airport, Date, Crowd level, Seats booked, Flights,
Source and Actions. Seats booked uses live numbers and their percentage; with
no counted flights it says No flight data. View flights links to
`/staff/flights?airport=<id>&date=<date>`, where the filter can be cleared.
Each airport forecast has a Show flights toggle for that same result set. It
opens four flights at a time, with origin and destination codes, Manila times,
direction, booked seats, and a count. Staff and Heads can edit every row. Delete
appears for manual rows and requires confirmation. Missing edit records show
**Forecast not found.** and a link back to the list.

## Commands and cleanup

`python manage.py recalculate_forecasts` recalculates all flight-backed pairs and
removes stale calculated rows. `--remove-sample-data` additionally deletes only
forecasts whose source is exactly Sample data. Manual rows, accounts, airports,
airlines, and flights are not cleanup targets. The command requires the existing
Staff user named by SEED_STAFF_USERNAME and prints only counts.

`python manage.py seed_sample_data` remains a DEBUG-only invented ten-flight seed
using the configured flight numbers. It now calls the same recalculation service
inside its transaction and removes the old exact Sample data forecast fixtures.
It no longer invents weekday-based forecast levels. Invented flight schedules do
not become real timetables because they feed this calculation.

Backend tests cover threshold boundaries, combined arrivals/departures, timezone
dates, zero seats, manual protection, original creator retention, idempotence,
old/new pairs, deletion, rollback, exact-source cleanup, forecast permissions,
and query count. Frontend tests use mocked API data; live browser layout and the
complete browser-to-database walkthrough remain unverified.


## Explanations and recommendations

GET /api/traffic/explanation/?airport=<id>&date=YYYY-MM-DD returns live counted
flights, departing/arriving counts, total/booked seats and occupancy, matching
history records and dates, daily history average, weights/thresholds, the computed
score/level, departing open seats, and number-backed sentences. It shares the
stored calculation function. With no flights/zero seats, has_data=false and the
score/level are null. Manual forecasts stay unchanged: their stored level remains
on the calendar; the explanation is labeled as a separate calculated blend.

Only /calendar enables DateBreakdown (info-circleIcon) and RecommendedDates
(bulbIcon) through optional shared-calendar render slots. Home enables neither.
The breakdown shows backend sentences, flight/history/combined values and the
history dates used. Requests are keyed by airport/date, refreshed on selection
or month changes, and handle loading, errors, retries and obsolete responses.
Flights use the airport/date endpoint and its departing/arriving direction field.

GET /api/traffic/recommendations/?airport=<id>&date=YYYY-MM-DD implements the
[recommendation rule](date-suggestions.md). Cards select their date, refreshing
forecasts, flights, breakdown and recommendations. Neither endpoint returns user
details. Both require authentication (401); missing/invalid parameters return
400, unknown airports 404. Constant-query-count tests cover both endpoints.
Raw SQL changes require an explicit recalculate_forecasts run.


## Redesigned layout and filters

/calendar has a main column with its month grid, selected-date flights, and
Why this level, beside a navy panel with searchable Airport, Airline,
My booking, the airport-level hint, and Recommended best date to travel. On
narrow screens the visual order is pickers, calendar/panel, recommendations.
The hint remains: Crowd levels are per airport. The airline filter only changes
the flight list. Airline changes neither forecasts, breakdown nor recommendations.

My booking reads the same src/api/recentRoutes.ts browser-only route list as Home,
keyed by the signed-in user's id. No booking is always available. With no saved
routes, show No saved bookings yet. Search flights on Home. Selecting From/To
sets Airport to From, adds a Booking chip with Clear, highlights only its route
dates and makes other days neutral. Route-day accessible names include the route,
flight count and level; other days say No flights on this route. The selected
panel still shows the airport's stored crowd level in text. Changing Airport by
hand clears the booking; clearing booking retains its airport. Booking sets
origin/destination on the flight request and destination on recommendations.

The initial selected date is today in UTC. Month navigation selects today when
returning to its month, otherwise day one. UTC date grouping is intentionally
shared by forecasts, airport/date flight lists, and route highlights. Flight
timestamps, recommendations, and optional Home search dates/hours use
Asia/Manila. The UI labels both zones. The forecast storage timezone remains UTC.

Selected-date flights request page_size=4 and display Showing {shown} of {total}
flights. See more appends the next four, with loading and retry states, and hides
when all results are shown. Airport, airline, booking and date changes reset it.
Delayed responses from an earlier selection cannot append to the reset list.
Without booking, flights include matching UTC departures and arrivals; with a
booking, only From-to-To departures on that UTC date. Existing icons and direction
labels remain. Recommendations use the [route-aware Low and Medium rule](date-suggestions.md)
with future departure previews and a status message beneath the selected date.

Forecasts remain airport-wide stored levels. /api/traffic/forecasts/ now returns
{count,next,previous,results}, default/capped page size 50. Additional optional
filters are search (airport code/name/city or date text YYYY-MM-DD/YYYY-MM), level
(low/medium/high), and source (calculated/manual), combined with existing filters.
Both calculated source labels count as calculated. Manual source filtering excludes
those labels and the legacy Sample data marker; blank/null manual sources remain.

Staff Crowd forecasts begins with a global search box and an Airports list with
code/name/city/country/forecast_count, without downloading all forecasts. Counts
include every stored calculated/manual row via one aggregate lookup query; cards
show No forecasts yet, 1 forecast or {n} forecasts. Missing counts are labeled
unavailable rather than invented as zero. Selecting
an airport opens its search, month/level/source filters and paginated table, with
the secondary Back to airports button and Add forecast. Global search shows results across
all airports; Clear search restores the airport list. No counted flights displays
No flight data. Otherwise the seats cell shows booked of total and percentage.
The inline flight list handles loading, retry, pagination, and empty results.
The forecast view refetches on return from Flights and after a manual deletion.
Home never enables recommendations or the breakdown.
