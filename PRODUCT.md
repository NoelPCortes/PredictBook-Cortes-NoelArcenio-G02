# PredictBook: Product Overview

This document describes what PredictBook is meant to do and what it will not do. For setup and run instructions, see [README.md](README.md). For the database tables, see [docs/database.md](docs/database.md).

PredictBook is a web application that helps travelers find the best dates to fly. Crowd levels blend 2026 flights with 2025 history, with manual forecasts still possible. The Traffic Calendar explains the calculated levels and recommends qualifying alternative dates. They are not produced by an AI model.

## Accounts implementation status

The backend provides sign-up, username/email sign-in, token refresh, logout,
self-only profile updates, password changes, and Head role management. JWT access
tokens last 15 minutes; refresh tokens last 7 days and rotate with blacklisting.
Head management actions return result messages. The Head-only list exposes Staff
id/username/email in the list and the approved Staff detail fields, plus limited pending-assignment fields. Existing account forms,
profile, guards, and role dashboards are connected; Head lists, Assign, and Remove
are implemented. See
[accounts API documentation](docs/features/accounts.md) for the contract.

## Problem

Travelers often have a hard time choosing flight dates because of crowded airports, unpredictable crowd levels, and changing seat availability. Most booking sites show flight schedules and open seats, but not one simple view that combines flight searches with expected airport crowd levels and date suggestions. Staff also need an easy way to see upcoming crowd patterns.

## Users

- **Travelers** search for flights, check expected airport crowd levels, and look at recommended Low or Medium dates with bookable flights.
- **Staff** log in to a dashboard with summary charts of busy travel days. Staff access is assigned by a Head using an email address.
- **Heads** manage Staff access, promote Staff to Head, and remove access according to the role-management rules. Heads also retain Staff access.

## Features

- **Flight and crowd forecast management:** Staff can change their own flights and Heads can change any flight. Both roles can edit any forecast and delete manual forecasts. Editing a calculated forecast converts it to a manual Staff entry while preserving the airport, date, and creator. Deleting a manual forecast recalculates the affected pair. Travelers can read stored crowd levels and flights.
- **User accounts and authentication:** sign-up, sign-in, profile updates, and logout, with separate access for Travelers, Staff, and Heads.
  - Sign-up and sign-in connect to the users table in the PostgreSQL database.
  - Passwords are hashed and never stored in plain text.
  - Sign-in is token-based. The frontend uses the token for later requests.
  - Users can sign in with their username or their email address.
  - Public sign-up does not allow users to select Staff or Head access. Staff access is assigned by a Head using an email address, whether an account already exists or not.
- **Home route search:** Travelers choose different From and To airports, optionally filtering departure and arrival dates and inclusive hour ranges in Asia/Manila. Cross-midnight ranges are not supported. Results load four flights at a time with See more. Upcoming applies unless a departure date is specified. A side column holds Your upcoming booking and the last five distinct recent routes, stored per user in this browser with Clear; only From and To are saved. Route dates highlight the From calendar, and Show all crowd levels restores normal colors. There is no booking table, passenger data, recommendation section, or breakdown on Home.
- **Searchable pickers:** every airport/airline picker uses the shared searchable combobox/listbox with code/name matching, city/country airport matching, keyboard and touch support, visible labels, error states, and existing icons.
- **Flight search and details:** search by starting location, destination, and date. View the airline, departure and arrival times, destination, and open seats. Ticket prices are not shown.
- **Traffic calendar:** a color-coded calendar of expected airport crowd levels (Low, Medium, High) for different airports and dates. The color of each date changes with the crowd level stored for that airport and date: Low is light green, Medium is amber, and High is dark orange. Each level is also available as text (in the legend, in the selected date's details, and in each date's accessible label), so color is never the only signal.
- **Forecast calculation:** blend the booked-seat percentage of counted 2026 departures/arrivals equally with the average daily percentage from available 2025 records at 371, 364, and 357 days earlier. Without history, use flights only. Round once to one decimal: below 50 is Low, 50 to below 75 is Medium, and 75 or above is High. Flight changes recalculate affected pairs transactionally; raw SQL requires explicit recalculation. No flights or zero seats gives no calculated row. Manual forecasts remain possible and take precedence.
- **Smart date suggestions and booking picker:** Traffic Calendar keeps the calendar and selected-date flight details beside its pickers and recommendations. A saved booking selects its From airport and limits flights and recommendations to that route. Airline filters the flight list. Recommend up to three Low or Medium dates within seven days either side of the selected date, excluding it, when future Manila departures have open seats. Rank Low first, then by score, open seats, and earlier date. Missing manual scores use matching 2025 history when available. Cards show up to two qualifying flights and reasons based on stored data. Selected-date messages explain full, departed, or absent flights. Empty windows beyond the schedule show its last departure date. Home shows neither explanations nor recommendations.
- **Staff pages:** Crowd overview uses seven Sun-to-Sat range columns over the next 30 days, from each weekday's least to most congested date, with endpoint labels, weekday/weekend brackets, colors from the highest score, 50/75 reference lines, and live busiest-day seat/flight details, retaining all existing summary cards, date lists, seven-day strip, comparison and own-record counts. Missing manual scores use matching 2025 history for the chart without changing stored forecasts. Flights has server-side search and pagination. Crowd forecasts starts with airport counts, with per-airport filters or global search. Each airport forecast row can show its flights and booked seats inline. A separate Charts page remains TBD.
- **Role management:**
  - Django administrators create the initial Heads.
  - A Head can assign Staff access by entering an email address, whether the account already exists or not.
  - A Head can promote Staff members to Head.
  - A Head can remove Staff access, returning the user to Traveler.
  - A Head can remove Head access only from Heads they promoted, or from themselves.
  - A Head cannot remove the Head who promoted them.
  - A Head created by a Django administrator can only have Head access removed by the administrator or themselves.
  - When removing Head access (including their own), the authorized acting Head chooses whether the user returns to Staff or is fully revoked to Traveler. The removed user's promoted_by link is cleared.
  - Fully revoking Staff access returns the user to Traveler.
  - Removing a Head does not affect the Heads they previously promoted.
  - Role removal does not delete the user's account.
- **Profile navigation:** Role top bars link to My Account with UserCircleIcon and the signed-in username. The navy sidebar stays visible, highlights the current section as the page scrolls, and keeps Sign Out at the bottom-left.
- **Head management:** a searchable Staff side list and pending assignments sit beside Assign Staff and the selected Staff details. Heads may read only id, username, email, first_name, last_name, date_joined, flights_created, and forecasts_created for Staff; no Traveler or Head details are exposed. Remove retains confirmation and changes Staff to Traveler without deleting the account. An unchanged assignment is an info alert. Existing Head navigation and promote/remove-Head backend rules remain; those additional management screens remain future work.

## Privacy

- Traveler personal information is kept private.
- The system does not store passenger names, booking reference numbers, or payment details.
- The Staff dashboard shows summary charts only, never individual traveler details.

## Out of Scope

- Processing ticket payments, credit card fees, or sending official airline tickets
- Storing passenger names, booking reference numbers, or ticket prices
- Direct connections to private, real-time airline reservation networks
- Live radar or GPS tracking of aircraft or passengers
- Mobile apps for iPhone or Android
- Guarantees that crowd predictions will match the exact head count at the airport

## Success Criteria (from the Project Charter)

- Account and search features work properly, and searches load in under 2 seconds.
- The traffic calendar shows estimated crowd levels for the next 30 to 60 days, with predictions that are correct at least 75% of the time.
- The recommendation tool checks a week before and after the chosen date and suggests 3 alternative dates with fewer crowds and available seats.
- Staff accounts can log in securely and view summary charts of busy travel days.

## Data Source

The system cannot connect to live, private airline systems, so it relies on public or sample flight data. Local development has invented 2026 flights and 2025 history from backend/database/sample_flights.sql. These are not real schedules. Production datasets remain TBD.
