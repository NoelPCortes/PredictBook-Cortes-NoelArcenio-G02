# Backend

## Current implementation

The Django project lives in `backend/config/`. Settings load the local environment
through python-dotenv and use PostgreSQL. Credentials remain local. Accounts,
flights, traffic, Django admin, DRF, and SimpleJWT token blacklisting are configured.
Django's `TIME_ZONE` remains `UTC` and `USE_TZ=True`. `SECRET_KEY` is required,
`DEBUG` defaults to false, and `ALLOWED_HOSTS` comes from the local environment.

Accounts retain their existing sign-up, username/email sign-in, rotating JWT
refresh, logout, self-profile, password, and Head management behavior. See
[accounts](features/accounts.md) for the existing contract. `/api/dashboard/`
continues as a legacy Staff/Head access probe. Displayed dashboard data comes
from the authenticated summary endpoint.

DRF defaults to `JWTAuthentication` and `IsAuthenticated`. Sign-up, sign-in, and
token refresh are the three public routes. The API uses the Authorization header
and issues no authentication cookies. Django's session-based admin retains CSRF
protection. GET, HEAD, and OPTIONS leave application records unchanged.

With debug off, `config/errors.py` returns JSON for Django-handled `/api/` errors
and small plain HTML pages elsewhere. Unknown numeric and nonnumeric API record
paths return JSON 404. The DRF handler keeps validation fields and error detail
messages, logs unexpected exceptions on the server, and sends generic JSON 500.

## Flight and crowd forecast API

`config/urls.py` includes `flights.urls` at `/api/flights/` and `traffic.urls` at
`/api/traffic/`. Requests use the existing JWT bearer authentication. Signed-out
requests return 401. Every signed-in role can read. Travelers receive 403 on
writes. Staff and Heads can create records. Staff can update or delete their own
flights and Heads can update or delete any flight. Both can edit any forecast
and delete manual forecasts. Current database roles apply on
every request, including when the caller's token predates a role change.

| Method | Endpoint | Behavior |
|---|---|---|
| GET | `/api/flights/airports/` | Read-only airport lookup |
| GET | `/api/flights/airlines/` | Read-only airline lookup |
| GET, POST | `/api/flights/` | List or create flights |
| GET, PATCH, DELETE | `/api/flights/<id>/` | Retrieve, update or delete a flight |
| GET, POST | `/api/traffic/forecasts/` | List or create crowd forecasts |
| GET, PATCH, DELETE | `/api/traffic/forecasts/<id>/` | Retrieve, update or delete a forecast |

List endpoints use {count,next,previous,results}, default/capped page size 50,
with page and optional page_size. Flights order by departure_time then pk;
forecasts by date/airport/pk. Airport/airline lookups are also paginated; airport
rows include an aggregate forecast_count. No lookup write permission is added.

Flight filters combine origin, destination, airline, airport, date, search,
upcoming and mine. Lookup ids select origin/destination/airline; upcoming=true
means departure_time >= now. New optional departure_date and arrival_date
(YYYY-MM-DD) filter their local dates in Asia/Manila. departure_hour_from,
departure_hour_to, arrival_hour_from and arrival_hour_to filter local whole hours
0 through 23, inclusively (To 11 includes 11:59). Hour bounds work without dates
and can be one-sided. Invalid/non-integer/out-of-range bounds or To below From
return a field-level 400. These filters combine with the old filters; they do not
change the airport/date UTC grouping or TIME_ZONE. page_size is already supported,
maximum 50, and the count covers all matching flights. Home/calendar request four. Search partially matches flight number, airline
name/code and origin/destination code/name/city case-insensitively. With airport,
date counts origin/departure and destination/arrival in project-local UTC dates,
matching forecasts; without airport, existing date filtering stays Philippine
departure-date filtering. Forecast filters combine airport, month=YYYY-MM,
mine=true, search, level and source. Search includes airport code/name/city and
ISO date text; level is low/medium/high, source is calculated/manual. Both
calculated labels count as calculated; manual excludes them and Sample data.

Flight input uses `airline`, `flight_number`, `origin`, `destination`,
`departure_time`, `arrival_time`, `total_seats`, and `available_seats`. Responses
also include `id`, `airline_name`, `airline_code`, `origin_code`, `origin_name`,
`destination_code`, and `destination_name`, so callers need no flight lookup
requests. Flight timestamps are timezone-aware; frontend entry and display use
Philippine time without changing Django's timezone.

Forecast input uses `airport`, `date`, `crowd_level`, optional `crowd_score`, and
optional `data_source`. Responses also include `id` and `calculated_at`. The
server sets `calculated_at` to the current time on create and update. Blank or
omitted sources on creation become `Staff entry`; updates retain an existing
source unless a replacement is supplied, normalizing blank sources the same way.
When a calculated row is edited, the server sets `Staff entry` and preserves its
airport, date, and creator. Changes to its airport or date return a field-level
400. Deletion of a calculated row returns 403.

Both models have required `created_by` foreign keys to the custom user model with
`on_delete=PROTECT`. The server sets ownership; clients cannot reassign it.
Requests containing `created_by`, or forecast `calculated_at`, return field-level
400 messages. The calculated labels are reserved for the calculation service.
Staff and Head responses include `created_by_username` and `can_edit`. Forecast
responses also include `can_delete`, which is true for manual forecasts. Traveler
responses omit creator names and write flags. Creator IDs and other users' email
addresses are not returned.

Serializers enforce the [database rules](database.md), including partial updates.
Flight numbers are trimmed and uppercased before validating two to ten letters
or digits. Total seats must be an integer from 1 to 1000. Available seats must be
an integer between zero and total seats. Changing a departure into the past or
creating a flight with a past departure returns a field-level 400. Other fields
of an existing past flight remain editable when otherwise permitted. Route, time,
seat, and duplicate errors return field-level 400 responses. Forecasts accept
Low, Medium, or High and an optional score from 0 to 100. Duplicate airport/date
forecasts return a `date` error. Save services translate PostgreSQL
constraint races for the documented constraints into field-level 400 responses.
Create returns 201, successful PATCH returns 200, and DELETE returns 204.

Views use DRF generics, the existing ownership permission class, and related
object loading. Business saves live in services. The runtime API uses the ORM; the approved local dataset uses a plain SQL
script. No new dependency is used. Airports and airlines have no write endpoints.

## Migrations, samples, and checks

Ownership migrations are additive and have no default owner. The local flight
and forecast tables were empty before each migration was written and applied.
An existing-row installation requires an owner-approved backfill decision first.
Applied migrations must not be rewritten.

`accounts/management/commands/seed_sample_data.py` remains DEBUG-only and requires
the Staff user named by SEED_STAFF_USERNAME. SEED_FLIGHT_NUMBERS must supply ten
distinct comma-separated identifiers, each at most ten characters. Lookups use
get_or_create for seven approved airports and Cebu Pacific/Singapore Airlines.
It creates or updates ten invented seed-owned flights without modifying another
user's flights or existing lookups. Its transaction now invokes recalculation
and removes exact Sample data forecast fixtures. It prints counts only. These
are invented local schedules, not real timetables.

`python manage.py recalculate_forecasts` uses that same existing seed Staff user.
Its optional --remove-sample-data flag deletes only exact Sample data forecast
rows. It reports created, updated, deleted, manual skipped, and sample deleted
counts. Manual records are preserved. No new migration or dependency is required.

Run `python manage.py test`, `pytest`, and `ruff check .` from `backend/`. Tests use
a separate PostgreSQL test database and cover Standard Features, ownership,
permissions, privacy, server-managed fields, documented validation, filters,
constraint races, and seed idempotence. They do not prove browser integration.

## Remaining work

Production datasets, accuracy evaluation, dedicated flight search contracts/results,
and chart APIs remain TBD. The suggestions app remains a scaffold; the implemented recommendation logic
lives in traffic alongside the common calculation. `backend/database/` contains
the approved large sample SQL script; command fixtures remain available separately.


## Blended calculation service

traffic/calculation.py defines MEDIUM_THRESHOLD=50, HIGH_THRESHOLD=75, and the
calculated/source markers in one place. It groups origin/departure dates and
destination/arrival dates in settings.TIME_ZONE. Total seats and booked seats
(total minus available) give the flight occupancy. calculate_pairs fetches matching
positive-seat history in one query, averaging daily percentages at D minus 371,
364 and 357 days. Equal flight/history weights give the score; absent history
uses flights only. Decimal half-up rounds the final blend to one decimal before
classifying Low (<50), Medium (<75), or High. Weights, offsets, recommendation
window (7) and limit (3) live beside the thresholds in traffic/calculation.py.
No flights/zero seats gives no calculated row. See
[traffic calendar](features/traffic-calendar.md) for the full rule.

The first triggering user owns a new calculated row. Later recalculations keep
that owner. Manual rows (sources other than exact Calculated from 2026 flights and 2025 history,
legacy Calculated from flights, or Sample data) always win. Both calculated labels
are recognized by both write rules and recalculation. Recalculation upgrades
legacy labels and preserves the creator. Explicit flight save/delete services recalculate old/new
pairs atomically with the flight mutation, without signals. Airport locks
coordinate flight changes, recalculations and manual saves. Empty pairs delete
only calculated rows. Removing a manual forecast recalculates its pair in the
same transaction. A failed calculation rolls back the flight change or deletion.

Forecast reads add is_calculated and live flight_count, seats_total, seats_booked.
Two grouped aggregate queries cover a list of any size; the query-count guard
expects four forecast-data queries with authentication already resolved,
including the page count. Flight lists use two queries, one for the count and
one for the page with the related airline, airports, and creator. Forecasts join
their airport and creator and load flight totals in two grouped queries.
## Real dashboard and limited Head list

GET /api/dashboard/summary/?airport=<id> admits Staff/Heads only. Its optional
airport parameter selects one airport; default selection prefers the first code
with a forecast in today..today+29, otherwise the first code. It returns airport,
period_start, period_end, counts (low/medium/high), dates (date/weekday arrays by
level), busiest_weekday or null, and next_7_days (date/weekday/crowd_level or null).
Tied busiest weekdays use the earliest first high date. No user details appear.
The approved [dashboard contract](features/staff-dashboard.md) covers empty data.

GET /api/accounts/staff/ admits Heads only and returns independently paginated
staff and pending objects. staff_page/pending_page control them, page_size is
capped at 50, and optional search matches Staff username/email. Staff list rows
contain id/username/email only; pending retains email/assigned_by_username/assigned_at.

GET /api/accounts/staff/<id>/ is Head-only and returns exactly id, username,
email, first_name, last_name, date_joined, flights_created and forecasts_created.
It returns 404 for unknown/non-Staff targets, 403 for Staff/Travelers and 401
signed out. Separate aggregate subqueries avoid a flight-by-forecast join and
serve the detail in one data query, with auth resolved. No password, token,
last_login, role, Traveler or other Head details are exposed.

Existing POST /api/accounts/staff/assign/ and staff/revoke/ retain message-only
responses and their rules. Revoking Staff sets Traveler without deleting the
account; revoking a pending assignment deletes only that assignment. Authentication,
profile and Head promotion/removal behavior remains unchanged.

## Sample SQL and efficient recalculation

backend/database/sample_flights.sql runs in one transaction with setseed(0.42).
It requires predictbook.seed_staff_username as a session setting (Staff or Head),
and uses the session TimeZone, set to Django's actual UTC zone by the runner.
It inserts ten airports/five airlines without changing conflicts, replaces only
the configured seed user's flights with 7,300 invented 2026 departures (20/day),
and replaces historical records with 3,650 invented 2025 airport/dates. It never
changes another user's flights or any manual forecast. See README for the psql
runner using runtime settings without printing credentials. SQL does not invoke
Python services: run recalculate_forecasts afterward. The older ten-flight
seed_sample_data command is unchanged.

Recalculation reads flight aggregates and history in bulk, locks airports and
forecast rows, bulk-creates/updates calculated rows and deletes stale calculated
IDs in the same transaction. Query counts scale with bulk batches, not one read
and write per airport/date. No signals or schema changes were added.

## Date insight endpoints

Both GET /api/traffic/explanation/?airport=<id>&date=YYYY-MM-DD and
GET /api/traffic/recommendations/?airport=<id>&date=YYYY-MM-DD allow every signed-in
role, return 401 signed out, field-level 400 for missing/invalid parameters and
404 for unknown airports. Neither returns user details.

Explanation response fields: airport {id,code,name}, date, weekday, has_data,
flights {count,departing_count,arriving_count,seats_total,seats_booked,occupancy_percent},
history {used_dates,records:[{date,weekday,seats_booked,seats_total,occupancy_percent}],
average_occupancy_percent}, weights {flights,history}, thresholds {medium_from,high_from},
crowd_score, crowd_level, history_available, open_seats and sentences.
It calls calculate_pairs, the same function as stored forecasts. Percentages are
rounded for display only; the blend uses unrounded values. No flights/zero seats
returns 200 with has_data=false and null score/level. Manual records are preserved;
this endpoint explains the computed blend independently of their stored levels.

Recommendations return selected {date,has_data,crowd_score,crowd_level}, selected_status {state,message},
recommendations [{date,weekday,crowd_level,crowd_score,score_difference,open_seats,
flight_count,history_average_occupancy_percent,reasons,flights}], route and message.
Optional destination=<airport id> restricts qualifying departures to that route;
equal airport/destination is 400 and an unknown destination is 404. route is
{origin_code,destination_code} or null. flights contains up to two positive-seat
qualifying departures in time/id order, each with airline_name, airline_code,
flight_number, origin_code, destination_code, departure_time and available_seats.
Stored Low and Medium dates qualify when an upcoming Manila departure has open
seats. Missing manual scores use matching 2025 history without changing the
forecast. Counts and open seats describe qualifying departures. A missing selected
score leaves score differences null. The selected status describes the flights for
that date. Empty windows beyond the schedule report the last departure date. Ranking,
window, missing/manual-score behavior and exact numerical reason conditions are
specified in [date suggestions](features/date-suggestions.md). Backend templates
build all sentences/reasons from measured values; no results are padded.
Query guards hold explanations at four data queries and recommendations with
results at six (seven with destination lookup), with authentication resolved.
An empty recommendation window can add a single query for the last departure.

The airport-filtered flight list includes direction=departing or arriving relative
to that airport, counting origin/departure dates and destination/arrival dates in
settings.TIME_ZONE. Existing filters remain; list responses now use the paginated envelope above.
The summary adds comparison with average_occupancy_2026_percent,
average_occupancy_2025_percent, difference_points, days_busier_than_2025,
days_quieter_than_2025 and days_compared; see the
[dashboard contract](features/staff-dashboard.md) for missing-data semantics.


## Route dates, daily series, and indexes

GET /api/flights/route-dates/?origin=<id>&destination=<id>&month=YYYY-MM permits
all signed-in roles and returns {dates:[{date,flight_count,open_seats}]} for only
that route's monthly departures. Date grouping is project-local UTC. Missing,
invalid or equal route parameters return 400; an unknown airport returns 404;
signed-out requests return 401. Airport existence and grouped flight counts use
two data queries regardless of the number of days, with auth resolved.

The dashboard summary keeps all previous fields and adds days, each with date,
weekday, crowd_level, crowd_score, seats_booked, seats_total and flight_count.
Only dates with a forecast appear; the UI supplies the missing-day slots. Flight
aggregates are shared with comparison, avoiding queries per day. Null manual
scores fall back to matching 2025 history for this read only; stored manual
forecasts and their levels remain untouched. No history leaves score null.

The summary adds weekday_ranges, exactly seven rows ordered Sunday to Saturday:
weekday, day_count, min_score, min_date, max_score, max_date,
max_day_seats_booked, max_day_seats_total and max_day_flight_count. It groups
usable daily scores from the same bulk result, including the read-only history
fallback; empty groups have day_count=0 and null numeric/date fields. Tied extrema
choose the earlier date. The busiest/max date's flight numbers are live and
reuse the existing aggregates; an explicit-airport request still takes five data
queries with authentication resolved.

Migration flights.0003_flight_filter_indexes adds only flight_departure_idx,
flight_origin_departure_idx and flight_dest_arrival_idx. They support ordered
upcoming reads, route/departure date filters and airport/arrival date filters.
Existing FK and forecast/history unique airport/date indexes are retained.
This redesign did not modify or recalculate application data.

## Measured performance

Django test-client measurements used the existing PostgreSQL dataset (7,300
flights, 3,614 forecasts, 3,650 historical rows), authenticated requests, rendered
JSON, and medians of three runs. Values exclude browser/network transfer and DOM
rendering. The original ten-second browser delay was not reproduced locally.

| Call | Before | After Step 1 | Before size | After size |
|---|---:|---:|---:|---:|
| Flights list | 1,121.8 ms | 18.8 ms | 3,226,043 B | 21,967 B |
| Forecast list | 370.6 ms | 22.0 ms | 1,128,756 B | 15,736 B |
| Seed user's flights mine=true | 1,084.2 ms | 10.6 ms | 3,218,743 B | 536 B |
| Seed user's forecasts mine=true | 489.0 ms | 18.5 ms | 1,128,473 B | 432 B |
| Default dashboard summary | 19.2 ms | 19.4 ms | 2,095 B | 2,095 B |

The main confirmed cost was serializing/transferring whole lists and rendering
thousands of rows, including fetching whole lists merely to count own records.
There was no per-row query explosion: before pagination the flight/forecast
lists used 2/4 queries with JWT authentication; pagination adds one COUNT query
to each but sharply reduces serialization and payload size. Access gates add
serial requests, but locally took only a few milliseconds. Head/calendar data
calls were already small/fast in the baseline; browser causes remain unverified.
Development StrictMode repeats effects; the API client now shares identical
pending GETs, removing the entry after completion. This is not response caching.
There was no short client timeout; a regression test permits a 16-second response
and a retry after failure. The measured local data calls meet the two-second
target, not a claim about full browser rendering. Browser access was unavailable
for the attempted visual check.


## Screenshot bug diagnosis and read-only verification

Multiple development-server processes shared port 8000. A November 16 no-reload
backend process served obsolete code while the
checkout contained the newer endpoints/filters. Its live Home route response was
an unpaginated 727 flights (643 wrong-route rows); the BKK/date response returned
19 rows including 16 unrelated flights. Recommendations and dashboard summary
returned non-JSON 404 responses, and airport rows omitted forecast_count. The
frontend's legacy array compatibility and count-or-zero display concealed that
backend mismatch. Stop the stale development server and run the current checkout;
the transport now rejects obsolete unpaginated lists with a clear restart error.

After stopping the verified duplicate workspace servers and restarting one current
server, live HTTP checks confirmed the new summary/recommendation response fields.
On November 18, 2026, read-only checks on the existing PostgreSQL data found seven
upcoming CEB-to-BKK flights, four BKK flights on November 17, 2026 with no unrelated
routes, HTTP 200 recommendations/summary, seven weekday ranges, and airport counts
summing to all 3,614 forecasts. Flights remain 7,300. No application rows were
edited, deleted or recalculated. The bulb PNG, import and asset HTTP response were
valid; the reported broken-image symptom was not reproduced and no icon was
replaced. Explicit UTC/Manila labels retain the owner's chosen date policy.
