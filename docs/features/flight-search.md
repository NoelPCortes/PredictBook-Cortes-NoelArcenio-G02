# Flight search and management

[Documentation index](../README.md) | [Home](../pages/home.md)

## Traveler Home route search

/home is Traveler-only. Required From and To searchable airports must differ.
Optional Departure date and Arrival date, plus Departure/Arrival hours groups,
use Philippine time (Asia/Manila). Each group has native From/To selects with
Any first: hour starts 00:00 through 23:00 and hour ends 00:59 through 23:59.
Bounds are inclusive and work with or without dates. A From bound alone means
that hour or later; a To bound alone means through the end of that hour.
Ranges that cross midnight are not supported. Reversed ranges and arrival dates
before departure dates show linked errors, focus an invalid control and block
requests. Clear optional filters clears those values.

With no departure date, upcoming=true limits departure to now or later, including
hours-only and arrival-date-only searches. A departure date disables upcoming.
Results stay on Home, ordered by departure_time then id. Request page_size=4;
See more appends four and Showing {shown} of {total} flights uses the count.
New searches reset the list; loading/errors support retry. Results show airline, flight number,
route, Philippine departure date/time with ClockIcon, and open seats with SeatIcon.
Empty results name the searched route. Loading, errors and Retry are separate.

recentRoutes.ts in src/api is the one route-storage module. It stores
only {origin,destination} pairs (never optional filters) under predictbook:recent-routes:<user id>, retains
five distinct routes newest first, and exposes Clear. It stores no timestamps,
passenger data or booking details and never logs the list. Your upcoming booking
means the most recent saved route with at least one upcoming flight, its total
count and next three departure times. It is not a booking record. Empty state:
No upcoming booking yet. Search flights to get started.

Clicking a recent search or upcoming booking reruns that route and updates the
Home calendar to the From airport. GET /api/flights/route-dates/ supplies monthly
departure counts. Only route days receive crowd colors and a visible ring; other
days are neutral and say No flights on this route. Accessible route-day names
include date, route, flight count and crowd level. Show all crowd levels clears
the active route. Home shows neither recommendations nor Why this level.
Home uses a main column for its header, search, results and calendar, beside an
approximately 340px side column for booking/recent searches. On narrow screens
the order is header, search, side cards, results, calendar. Clicking a saved route
clears optional filters and reruns its upcoming search. Landing's separate
inactive marketing search remains unchanged.

## Flight reads and route dates

Every signed-in role can GET /api/flights/. Responses use
{count,next,previous,results}, default/capped page size 50, page initially 1.
Filters combine: origin, destination, airline (lookup ids), airport, date,
search, upcoming=true, mine=true, departure_date, arrival_date,
departure_hour_from, departure_hour_to, arrival_hour_from and arrival_hour_to.
New date filters are YYYY-MM-DD in Asia/Manila; hour parameters must be whole
numbers 0 through 23. Invalid hours and To below From return field-level 400.
These filters combine with existing filters. page_size is optional, capped at 50;
the count always describes all filtered results, independent of the page size. Search partially matches flight number,
airline name/code and origin/destination code, name or city, case-insensitively.
Default ordering remains departure_time then id.

Without airport, date keeps its existing Philippine departure-date behavior.
With airport, it counts that airport's UTC-local departures and arrivals, matching
forecast dates. Filtered rows include direction=departing or arriving relative
to the airport. Flight timestamp entry/display remains Asia/Manila; TIME_ZONE is
unchanged at UTC. These two date-filter modes are labeled in the UI.

GET /api/flights/route-dates/?origin=<id>&destination=<id>&month=YYYY-MM returns
{dates:[{date,flight_count,open_seats}]}. It groups From-to-To departures only by
project-local UTC departure date, with exclusive next-month bounds. It does not
filter to upcoming flights. Missing/invalid/equal route parameters return 400,
unknown airports 404, signed-out requests 401. A query-count test guards the
single airport existence query plus one aggregate query, with auth resolved.

Airport and airline lookups at /api/flights/airports/ and /api/flights/airlines/
are read-only and paginated. Airport rows add forecast_count from a grouped count.
No lookup write endpoint, price or passenger data is introduced.

## Staff Flights

/staff/flights has a search section above the table: text search, From, To,
Airline, Date, Search and Clear. Lookups use the shared searchable picker; the
text placeholder is Search flight number, airline, or airport. Search/filter
values are reflected in the URL and server query; page controls preserve them.
Existing airport/date View flights links retain a clearable filter notice.
The table still shows airline, number, route, departure/arrival, open/total seats,
creator and permitted actions.

/staff/flights/new and /staff/flights/:id/edit reuse existing forms, now with
searchable airport/airline controls. They submit the same ids and timestamps,
show linked backend field errors, focus the first invalid field, and show success
alerts. Delete retains confirmation with ghost Cancel and danger Delete.
Staff can change only their flights; Heads any flight; Travelers cannot write.
Signed-out reads/writes return 401. Traveler reads omit creator information.
Departure must not precede the current time when the flight is created or rescheduled.
Existing past flights can still receive permitted edits to other fields. Arrival
must follow departure and the airports must differ. The API trims and uppercases
flight numbers before requiring two to ten letters or digits. It enforces integer
total seats from 1 to 1000, integer available seats from zero through total seats,
and a unique airline, flight number, and departure combination. Validation and
attempts to set ownership return field-level 400 responses. Create, PATCH, and
DELETE recalculate affected forecasts in the same transaction. Missing edit
records show **Flight not found.** and a link back to Flights.

## Verification and remaining work

Backend tests cover filters, search, upcoming, ordering, pagination, route month
boundaries/timezones/direction, permissions and query counts. Frontend tests
cover Home searches/storage/highlights and Staff controls alongside form/CRUD
regressions. Tests use mocks/jsdom; browser/network rendering remains unverified.
Dedicated search results/details routes and production datasets remain TBD.
There is no booking persistence or new search table. See [setup](../../README.md)
for the existing invented small seed and large SQL dataset; neither is a real
schedule, and neither was rerun for this redesign.
