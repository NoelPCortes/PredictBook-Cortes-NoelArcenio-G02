# Database

This file describes the PostgreSQL tables for PredictBook: what each table stores, its fields, and how the tables connect.
It is the single source of truth for the schema. Codex must follow it and must not add, remove, or rename tables or fields without asking the owner (see `PROMPTING_RULES.md`).

Django names each table `<app>_<model>` (for example `accounts_user`). This file uses plain names.

---

## 1. Overview

| Table | Django app | Purpose |
|---|---|---|
| `users` | `accounts` | Accounts for Travelers, Staff, and Heads |
| `staff_assignments` | `accounts` | Pending Staff assignments for emails without user accounts |
| `airports` | `flights` | Airports used by flights, forecasts, and history |
| `airlines` | `flights` | Airlines that operate flights |
| `flights` | `flights` | Flight details and open seats (no passenger data) |
| `crowd_forecasts` | `traffic` | Expected crowd level (Low, Medium, High) per airport and date |
| `historical_records` | `traffic` | Past daily totals used to calculate forecasts |

These features have **no table of their own**, because they are calculated from the tables above:

- **Smart date suggestions** (`suggestions` app): read `crowd_forecasts` and `flights`.
- **Staff dashboard and charts** (`dashboard` app): read `crowd_forecasts` and `historical_records`.

## 2. Relationships

All project-defined foreign keys use `on_delete=PROTECT`: `User.promoted_by`,
`StaffAssignment.assigned_by`, `Flight.airline`, `Flight.origin`,
`Flight.destination`, `Flight.created_by`, `CrowdForecast.airport`,
`CrowdForecast.created_by`, and `HistoricalRecord.airport`.
Deleting a referenced user, airport, or airline is blocked. In particular, a user
who promoted other Heads or assigned pending Staff emails cannot be deleted while
those references remain. Role removal never deletes accounts. SimpleJWT's
`token_blacklist` foreign keys retain the library's own deletion behavior.

- One airline has many flights.
- One airport has many departing flights and many arriving flights.
- One airport has many crowd forecasts and many historical records.
- One Head can promote many Staff members to Head. Each promoted Head points back to the Head who promoted them (`promoted_by`).
- One Head can create many Staff assignments.
- One user can create many flights through `Flight.created_by`. This records the author, not a passenger. There are no bookings.
- One user can create many crowd forecasts through `CrowdForecast.created_by`.

---

## 3. Tables

### 3.1 `users`

Uses a **custom Django user model**. This must be set up before the first migration, because changing it later is difficult.

| Field | Type | Required | Notes |
|---|---|---|---|
| id | auto number | yes | Primary key |
| username | CharField (150) | yes | Unique, including case variants |
| email | EmailField (254) | yes | Unique, including case variants |
| password | hashed text | yes | Stored only as a Django hash. Never plain text. Never returned by the API. |
| role | CharField (8), choice: `traveler`, `staff`, `head` | yes | Defaults to `traveler` |
| promoted_by | link to `users` | no | The Head who promoted this user to Head. Empty for Travelers, for Staff, and for Heads created by a Django administrator |
| first_name | CharField (150; blank allowed) | no | Can be added on the profile page |
| last_name | CharField (150; blank allowed) | no | Can be added on the profile page |
| is_active | yes/no | yes | Defaults to yes. If no, the user cannot sign in |
| date_joined | date and time | yes | Set automatically |
| last_login | date and time | no | Set automatically |

Rules:

- **Sign-up creates a Traveler**, unless the email already has a row in `staff_assignments`. In that case the new account gets the Staff role. The sign-up request must not be able to choose the role or `promoted_by`.
- **Heads are created in two ways:** a Django administrator creates the initial Heads (`promoted_by` stays empty), or a Head promotes a Staff member (`promoted_by` is set to that Head).
- **Staff access is assigned by a Head** using an email address. If an account with that email exists, its role becomes `staff`. If not, a row is added to `staff_assignments` and applied when that person signs up.
- A Head keeps Staff access. Heads can open every Staff page.
- **Removing roles:**
  - When removing Head access (including their own), the authorized acting Head chooses role staff or traveler, and promoted_by is cleared.
  - Fully revoking Staff access sets the role to `traveler`.
  - Removing a role never deletes the account.
  - Removing a Head does not change the Heads that person promoted.
- **Who can remove a Head:** a Head can remove Head access only from the Heads they promoted, or from themselves. A Head cannot remove the Head who promoted them. A Head with an empty `promoted_by` (created by a Django administrator) can only be removed by a Django administrator or by that Head.
- Username and email can both be used to sign in. PostgreSQL also enforces unique `Upper(username)` and `Upper(email)` values without changing stored casing.
- Django also has built-in `is_staff` and `is_superuser` flags. `is_staff` means "can open the Django admin site." It is **not** the same as our Staff role. Use `role` for all app logic.
- Phone number, home airport, and similar extras are not included.

### 3.2 `staff_assignments`

Emails that a Head has assigned as Staff. This lets a Head assign Staff access before the person has an account.

| Field | Type | Required | Notes |
|---|---|---|---|
| id | auto number | yes | Primary key |
| email | EmailField (254) | yes | Unique |
| assigned_by | link to `users` | yes | The Head who assigned it |
| assigned_at | date and time | yes | Set automatically |

Rules:

- Keep assignments only for emails that have not signed up. When a person signs up with an assigned email, create the Staff account and delete the pending assignment in the same transaction.
- If an account already exists, change its role directly to staff without creating an assignment row. If it is already Staff or Head, make no change and return a clear message; never downgrade a Head.
- If a Head fully revokes Staff access before the person signs up, the row is deleted.
- Do not add other fields without asking.

### 3.3 `airports`

| Field | Type | Required | Notes |
|---|---|---|---|
| id | auto number | yes | Primary key |
| code | CharField (3 letters) | yes | Unique. Validator requires exactly three uppercase ASCII letters, for example `CEB` |
| name | CharField (150) | yes | |
| city | CharField (100) | yes | |
| country | CharField (100) | yes | |

### 3.4 `airlines`

| Field | Type | Required | Notes |
|---|---|---|---|
| id | auto number | yes | Primary key |
| name | CharField (100) | yes | Unique |
| code | CharField (10) | yes | Unique. Validator requires two to ten uppercase ASCII letters or digits |

### 3.5 `flights`

Flight details only. This is **not** a passenger ticket.

| Field | Type | Required | Notes |
|---|---|---|---|
| id | auto number | yes | Primary key |
| created_by | link to `users` | yes | Set by the server to the signed-in creator; `on_delete=PROTECT` |
| airline | link to `airlines` | yes | |
| flight_number | CharField (10) | yes | Validator requires two to ten uppercase ASCII letters or digits. The API trims and uppercases the input first |
| origin | link to `airports` | yes | |
| destination | link to `airports` | yes | |
| departure_time | date and time | yes | Stored with time zone |
| arrival_time | date and time | yes | Stored with time zone |
| total_seats | PositiveIntegerField | yes | Validators require a whole number from 1 to 1000 |
| available_seats | PositiveIntegerField | yes | |

Rules:

- Origin and destination must be different.
- Arrival must be after departure.
- The API rejects a past departure on create or when the departure changes. Staff and Heads may still make permitted edits to other fields of existing past flights.
- Available seats must be between 0 and total seats.
- The same airline, flight number, and departure time cannot appear twice.
- Any signed-in user can read flights. Staff and Heads can create them. Staff can update or delete only their own flights; Heads can update or delete any flight. Travelers cannot write.
- Requests containing `created_by` are rejected with a field-level 400 error. Ownership cannot be reassigned by clients.
- Traveler responses omit creator information. Staff and Head responses include `created_by_username` and a server-computed `can_edit`; other users' email addresses are never included.
- **No price.** Ticket prices are not stored or shown.
- **No passenger names and no booking reference numbers.** Open seats are a count only.
- Terminal, gate, flight status, and cabin class are not included. Add them only if the owner asks.
- Flight entry, display, and departure-date filtering use Philippine time (`Asia/Manila`, UTC+08:00). Django keeps `TIME_ZONE=UTC` and `USE_TZ=True`; timestamps remain timezone-aware.

### 3.6 `crowd_forecasts`

Expected airport crowd level for each airport and date. This table feeds the traffic calendar, the date suggestions, and the Staff charts.

| Field | Type | Required | Notes |
|---|---|---|---|
| id | auto number | yes | Primary key |
| created_by | link to `users` | yes | Set by the server to the signed-in creator; `on_delete=PROTECT` |
| airport | link to `airports` | yes | |
| date | date | yes | |
| crowd_level | CharField (6), choice: `low`, `medium`, `high` | yes | Must always be set |
| crowd_score | FloatField (null=True, blank=True) | no | Validator and database check allow null or a score from 0 to 100. Calculated scores use the flight/history blend rounded to one decimal |
| calculated_at | date and time | yes | Server sets the current time on create and update; clients cannot send it |
| data_source | CharField (100; null=True, blank=True) | no | `Calculated from 2026 flights and 2025 history` for automatic rows; legacy `Calculated from flights` is also calculated; `Staff entry` for blank API sources; `Sample data` identifies legacy removable fixtures. Other sources are manual |

Rules:

- One forecast per airport per date.
- Any signed-in user can read forecasts. Staff and Heads can create manual entries. Staff can update or delete their own manual records; Heads can update or delete any manual record. Calculated rows are read-only, and Travelers cannot write.
- Requests containing `created_by` or `calculated_at` are rejected with field-level 400 messages.
- Traveler responses omit creator information. Staff and Head responses include `created_by_username` and the server-computed `can_edit`. Other users' email addresses are never included.
- A blank data source is stored as `Staff entry`.
- **The color is not stored.** The frontend picks it from `crowd_level` (see `../frontend/UI_STYLE_GUIDE.md`, traffic calendar).
- Keep forecasts after their date passes. Comparing them with `historical_records` shows whether the 75% accuracy goal is met.
- Automatic calculations count origin/departure-local-date and destination/arrival-local-date flights using `settings.TIME_ZONE` (currently UTC). Sum total seats and booked seats (total minus available) for flight occupancy. History uses dates D minus 371, 364, and 357 days, ignoring missing/zero-total records; average their daily booked percentages equally. `crowd_score = 0.5 * flight occupancy + 0.5 * history average`, falling back to flight occupancy alone when history is absent. Round only the final score to one decimal; Low is below 50, Medium is 50 to below 75, and High is 75 or above. Named constants are defined once in `traffic/calculation.py`.
- No flights or zero total seats produces no calculated row. If a flight change leaves no seats for a pair, remove only its calculated row. Manual entries are preserved even with no flights.
- Every source except exact `Calculated from 2026 flights and 2025 history`, legacy `Calculated from flights`, and `Sample data` is manual. Recalculation upgrades the legacy calculated label while preserving its creator. A manual airport/date entry always takes precedence and is never overwritten or deleted by automatic calculation.
- A calculated row's required creator is the user who first triggers calculation, or the configured seed Staff user for management commands. Preserve that creator on later recalculations. Converting an old Sample data row establishes the current calculator as its calculated creator.
- Calculated rows are read-only for every API role: PATCH and DELETE return 403. Clients cannot create the reserved calculated source. Staff/Head responses use `created_by_username=null`, `is_calculated=true`, and `can_edit=false`; the UI displays Calculated automatically. Traveler responses continue to omit creator fields.
- Every forecast response includes live `flight_count`, `seats_total`, and `seats_booked`. These are response aggregates, not stored columns or new relationships. Two grouped flight queries serve the whole forecast list, guarded by a constant-query-count test. Pagination adds one COUNT query and limits the rows aggregated per response.
- Constants in `traffic/calculation.py` are MEDIUM_THRESHOLD=50, HIGH_THRESHOLD=75, FLIGHT_WEIGHT=0.5, HISTORY_WEIGHT=0.5, HISTORY_DAY_OFFSETS=(371,364,357), RECOMMENDATION_WINDOW=7, and MAX_RECOMMENDATIONS=3. Flight/history reads are grouped or fetched in bulk; recalculation uses bulk writes.
- Raw SQL flight/history changes do not trigger recalculation; run `python manage.py recalculate_forecasts` afterward. Flight create/update/delete and old/new pair recalculation share a transaction and explicit services, without signals. Lookups are locked to serialize calculations and manual writes.
- The approved cleanup deletes only rows whose source is exactly `Sample data`; manual rows are not cleaned up. Sample flight seeding now calls calculation instead of inventing weekday levels.

### 3.7 `historical_records`

Past daily totals per airport. The prediction logic uses these to calculate forecasts.

| Field | Type | Required | Notes |
|---|---|---|---|
| id | auto number | yes | Primary key |
| airport | link to `airports` | yes | |
| date | date | yes | |
| total_flights | PositiveIntegerField | yes | |
| seats_total | PositiveIntegerField | yes | |
| seats_booked | PositiveIntegerField | yes | |

Rules:

- One record per airport per date.
- Database checks require nonnegative `total_flights`, `seats_total`, and `seats_booked`, and enforce `seats_booked <= seats_total`.
- Totals only. No individual passenger or booking data.
- Local invented 2025 history comes from `backend/database/sample_flights.sql` (3,650 rows, ten airports). Production source datasets remain **TBD**. The script replaces all historical rows and only seed-owned flights, preserving manual forecasts and other users' flights.

---

## 4. Privacy and security

- Passwords are hashed by Django's built-in password hashing. They are never stored or logged in plain text.
- API responses never include the `password` field.
- Sign-in uses tokens. The password is only sent at sign-in, and the token is used for later requests.
- Profile details remain self-only except the approved Head Staff views. Heads may read exactly `id`, `username`, `email`, `first_name`, `last_name`, `date_joined`, `flights_created`, and `forecasts_created` about a Staff member. The list returns the subset id/username/email; the detail endpoint returns all eight fields. Never expose passwords, hashes, tokens, last_login, other fields, or details of Travelers/Heads through these endpoints. Pending assignments still expose only `email`, `assigned_by_username`, and `assigned_at`. Assignment/revocation actions still return only result messages. Record counts are aggregate response values, not new user columns.
- The Staff dashboard shows summary charts only, never individual traveler details.
- No table stores passenger names, booking references, payment details, or ticket prices.
- Secrets and database credentials stay in `backend/.env` and are never committed.

## 5. Rules for changing the database

- Every schema change goes through a Django migration.
- Update this file in the same change as the migration.
- Do not add a table, field, or relationship that is not listed here without owner approval.
- Do not store passenger names, booking references, payment data, or prices without owner approval.
- Never delete or rewrite an applied migration without asking.

## 6. Open items (TBD)

- How crowd levels for "All Airports" are combined, since forecasts are stored per airport.
- The dataset for flights, airports, airlines, and historical records.


### Filter indexes

Flight has flight_departure_idx (departure_time) for ordered upcoming/page reads,
flight_origin_departure_idx (origin_id, departure_time) for route/date departures,
and flight_dest_arrival_idx (destination_id, arrival_time) for airport/date arrivals.
Migration flights.0003 adds indexes only. Existing foreign-key indexes and the
forecast/history unique (airport_id, date) indexes are retained without duplication.


### Read-only display and browser route history

The dashboard days series returns stored forecast scores, or the matching 2025
history average when a manual score is null. This display fallback does not
update crowd_score, crowd_level, source, ownership, or calculation timestamps.
Without that history the score remains null. No data was recalculated for the
redesign. Home recent routes are browser-only origin/destination pairs, stored
per signed-in user by the homepage module; there is no bookings/search table,
date, passenger count or seat class.
