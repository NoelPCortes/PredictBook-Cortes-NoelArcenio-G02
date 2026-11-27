# Date suggestions

[Documentation index](../README.md) ? [Traffic Calendar](traffic-calendar.md)

## Implemented rule

GET /api/traffic/recommendations/?airport=<id>&date=YYYY-MM-DD requires a signed-in
user of any role. It lives with the shared calculation in traffic/insights.py;
there is no recommendation table or new frontend feature folder.

For selected airport A and date S, consider S minus seven through S plus seven,
excluding S and dates before today in Asia/Manila. A candidate must have a stored
Low or Medium forecast and a departure from A on that Manila date with positive
available seats and a departure time after now. Optional `destination=<airport id>`
restricts departures to the saved booking's To airport.

Use the stored numeric `crowd_score`. For a manual forecast without a score,
use its matching 2025 history average when available. A date with neither score
is excluded. Rank Low dates first, then Medium. Within each group, sort by score
ascending, qualifying open seats descending, then date ascending. Return up to
three dates. The window and limit are named constants in `traffic/calculation.py`.

## Response and reasons

`selected` retains date, has_data, crowd_score and crowd_level. A missing selected
forecast/score leaves score_difference null. Each recommendation keeps date,
weekday, crowd_level, crowd_score, score_difference, open_seats, flight_count,
history_average_occupancy_percent and reasons. Difference may be zero or negative
because candidates no longer need a lower score than S. Counts and open seats
refer only to qualifying positive-seat departures, restricted to the route when
provided. flights adds up to two departures ordered by departure time then id,
with airline_name, airline_code, flight_number, origin_code, destination_code,
departure_time and available_seats. Top-level route is {origin_code,
destination_code} or null. `selected_status` contains `state` and `message`.

| State | Selected-date message |
| --- | --- |
| `bookable` | Empty when an upcoming flight has open seats |
| `full` | All flights on this date are full. |
| `departed` | All flights on this date have already departed. |
| `no_flights` | No flights are scheduled for this date. |

`message` describes fewer than three results. When none qualify, it says
“No flights with open seats were found within 7 days of {date}.” If the chosen
date is beyond the last scheduled departure for that airport or route, it also
says “Scheduled flights end on {last flight date}.” Dates use `YYYY-MM-DD`.

Backend reasons use these number-backed templates:

- This day has a Low crowd level (score {S}).
- This day has a Medium crowd level, moderate congestion (score {S}).
- {N} flights from {F} to {T} depart on this date, with {S} open seats. (route)
- {N} flights depart from {F} on this date, with {S} open seats. (no route)
- In 2025, the same weekday around this date averaged {P}% seats booked.
  (only with history)

Every signed-in role may read, with no user details returned. Signed out is 401;
missing/invalid parameters or destination equal to airport is field-level 400;
unknown airport or destination is 404. Forecasts/history and flight aggregates
are read in bulk, plus one related-object-loaded departure query for all previews.
Returns with recommendations use six data queries (seven with a destination)
after authentication. Empty windows can add one query for the last departure.

## Calendar presentation

Only `/calendar` shows Recommended best date to travel beside its date panels.
Narrow screens show pickers, the calendar and panel, then recommendations. The
selected-date status appears under the date before the alternatives. Cards use
bulbIcon, a Low or Medium text chip, the date, score, open seats, flight previews
with ClockIcon and SeatIcon, and backend reasons. A positive score difference is
shown when available.
Clicking selects the date and refreshes requests. Loading, error/retry,
fewer/none and missing selected-date data states remain explicit.
Home shows neither recommendations nor Why this level; tests guard exclusions.

Landing's separate marketing preview remains unchanged. Production datasets,
prediction accuracy evaluation, and All Airports aggregation remain TBD.
