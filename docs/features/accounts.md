# Accounts and access

[Documentation index](../README.md) · [Sign-in page](../pages/sign-in.md) · [Sign-up page](../pages/sign-up.md)

## Implementation status

The `accounts` backend implements the owner-approved account API, custom User,
pending Staff assignments, JWT authentication, and role permissions. Initial
migrations also create the flights and traffic models from [database.md](../database.md).
Only User is registered in the Django admin, including role and promoted_by on
creation and editing, so Django administrators can create initial Heads.

The existing frontend forms now live in `features/signin` and `features/signup`.
They preserve client validation and call the existing `signin/` and `signup/`
endpoints. Sign-Up displays backend field errors and password validation messages
beside their inputs and focuses the first invalid field. Successful Sign-Up opens
Sign-In with the success alert **Account created. Please sign in.**, using
`successIcon`. Editing the Sign-In form or navigating away clears the message;
the navigation state is consumed so revisiting does not restore it. Sign-In
stores the returned tokens and keeps only safe profile fields in memory, then
opens the landing page for the role returned by the backend.

`features/homepage` reuses the existing Home UI. It displays the signed-in username;
the calendar and flight data come from the API. Home now searches routes and
keeps five browser-only route pairs per user; upcoming booking is a route summary,
not a stored booking.
`profile/` restores the current user's profile after reload. Home is
Traveler-only; Staff and Heads have separate areas as described below. `/` stays
public. Sign out calls `logout/` with the refresh token, then clears the local
session even if the request fails. Sign In reports whether the server ended
the session or sign-out completed only on this device. The Staff dashboard, Head assignment form,
and own-profile/password page are implemented. Head management now lists Staff
and pending assignments and supports assignment/revocation. Charts and
promote/remove-Head management screens remain future work.

## Endpoint contract

All paths below start with `/api/accounts/`. Requests and responses use JSON.
`profile` has exactly `id`, `username`, `email`, `first_name`, `last_name`, and
`role`. A profile response is that object directly; sign-in nests it as `profile`.
Passwords and password hashes are never returned. Protected endpoints require
`Authorization: Bearer <access>`.

Sign-up and profile updates reject duplicate usernames and emails regardless of
case. The database enforces that rule for concurrent requests and keeps entered
casing. The API uses JWT without session authentication or authentication cookies.
Django admin retains its CSRF-protected session flow.

| Path | Method | Request fields | Response fields | Access |
|---|---|---|---|---|
| `signup/` | POST | username, email, password; optional first_name, last_name | profile (201) | Public |
| `signin/` | POST | identifier (username or email), password | access, refresh, profile | Public |
| `token/refresh/` | POST | refresh | access, refresh | Valid refresh token |
| `logout/` | POST | refresh | detail | Authenticated token owner |
| `profile/` | GET | none | profile | Signed-in user |
| `profile/` | PATCH | Any of first_name, last_name, username, email | profile | Signed-in user |
| `password/change/` | POST | current_password, new_password | detail | Signed-in user |
| `head/` | GET | none | detail | Head |
| `staff/` | GET | optional staff_page, pending_page, page_size, search | paginated staff: id/username/email; paginated pending: email/assigned_by_username/assigned_at | Head |
| `staff/<id>/` | GET | none | id, username, email, first_name, last_name, date_joined, flights_created, forecasts_created | Head; target must be Staff |
| `staff/assign/` | POST | email | detail | Head |
| `heads/promote/` | POST | email | detail | Head; target must be Staff |
| `heads/remove/` | POST | email, role (`staff` or `traveler`) | detail | Head; self or Head they promoted |
| `staff/revoke/` | POST | email | detail | Head; existing Staff or pending assignment |

The separate approved endpoint `GET /api/dashboard/` accepts no request fields
and returns `detail` plus `is_sample: true`. It admits Staff and Heads and
provides a legacy server-side access gate. Displayed dashboard figures come
from the real `/api/dashboard/summary/` endpoint. `GET /api/accounts/head/` likewise
provides a Head-only gate and returns only `detail`.

Success responses use 200 except sign-up (201). Invalid fields and invalid role
transitions return 400. Missing/invalid authentication returns 401. Authenticated
callers without required permissions return 403. Revoking an unknown pending
email returns 404. Management action responses include only `detail`. The new Head-only Staff
list is the explicit privacy exception described below. Requests containing unsupported or read-only account fields return 400.

## Role redirects and frontend routes

| Route | Access | Behavior |
|---|---|---|
| `/` | Public, including signed-in visitors | Existing Landing page |
| `/signin`, `/signup` | Signed-out visitors | Signed-in visitors go to their role landing page |
| `/home` | Traveler | Route search, browser recent routes, upcoming-route summary and route calendar |
| `/staff/dashboard` | Staff and Head | Real single-airport 30-day dashboard |
| `/head` | Head | Head landing page; Staff/pending lists, Assign and Remove |
| `/profile` | All authenticated roles | Own profile, password change, Sign Out |

`ROLE_LANDING_PATHS` defines Traveler -> `/home`, Staff -> `/staff/dashboard`,
and Head -> `/head`. `SessionBootstrap` restores the profile from the backend.
`SessionRoute` handles authentication and redirects signed-in visitors away from
credential forms. `RoleRoute` sends signed-out visitors to `/signin` and users
with another role to their own landing page. Heads also pass Staff route guards.
The profile is held in memory, not persisted as a browser role authority.

Frontend guards control navigation, while backend permissions enforce access.
`IsStaffOrHead` and `IsHead` in `accounts/permissions.py` require active,
authenticated users and check the current database role. Both protected area
views also require `IsAuthenticated`. No token gives 401; an authenticated
wrong role gives 403. `is_staff` and `is_superuser` do not bypass app roles;
revoking a role blocks an existing JWT on the next protected backend request.
The Staff and Head pages request their backend access gates before showing
summary content or the assignment form. The backend rechecks Head permission
again when an assignment is submitted. Home calendar/flight APIs independently enforce authenticated read access.

## Profile and password UI

The top-bar username links to `/profile`. Its Navy sidebar links to the user's
role landing page, Profile Information, Password & Security, and Sign Out.
The sidebar stays visible while scrolling, with Sign Out at the bottom-left and
the current section highlighted. Section clicks focus and scroll to the section,
with reduced-motion support. The sidebar is compact and full-width on small screens.
The reference layout is adapted without photo uploads or an edit pencil; the
avatar uses only `UserCircleIcon`. Role is plain read-only text.

Profile Information submits only `username`, `email`, `first_name`, and
`last_name` using `PATCH /api/accounts/profile/`. Success updates the in-memory
profile, and a reload retrieves persisted values from `GET` on the same path.
The endpoint accepts no target ID and always uses the authenticated user. `role`,
`promoted_by`, password, and target-ID fields in the body are rejected with 400.
Duplicate identities return field errors without partial updates. Supplying a
target ID as a query parameter still returns only the caller; user-ID subroutes
do not exist.

Password & Security asks for Current password, New password, and Confirm new
password. Confirmation must match locally and is never sent to the API.
`POST /api/accounts/password/change/` receives only `current_password` and
`new_password`; the backend validates the current password and Django's default
password rules. Failures leave the password unchanged. Success clears the input
fields. Backend validation messages appear beside their fields with
`aria-describedby`, `aria-invalid`, and focus on the first invalid input;
success and general errors appear as text alerts/status messages. Both forms
disable their action while saving. Passwords stay masked; no password is stored
in profile state or browser storage.

## Staff and Head pages

The Staff dashboard uses the real single-airport 30-day summary, dates grouped
by level, the next seven days, and own-record counts. See
[Staff dashboard](staff-dashboard.md). No Charts or All Airports feature is added.

Head navigation always contains Dashboard, Flights, Crowd forecasts and Head
management in that order, including on Staff pages. Staff have no Head link and
Travelers retain Home and Traffic Calendar. The active page is highlighted.

`GET /api/accounts/staff/` returns {staff: page, pending: page}; each page is
{count,next,previous,results}, with 50 rows by default (page_size capped at 50).
staff_page and pending_page select independent pages. Optional search matches
Staff username/email case-insensitively. Staff rows contain id, username and email;
pending rows retain email, assigned_by_username and assigned_at. Heads are not
included as Staff. The list uses related-object loading, not queries per row.

`GET /api/accounts/staff/<id>/` returns exactly id, username, email, first_name,
last_name, date_joined, flights_created and forecasts_created. It is Head-only:
401 signed out, 403 for Staff/Travelers, and 404 for unknown or non-Staff targets.
Separate aggregate subqueries calculate the two counts in one data query and
avoid multiplying flight rows by forecast rows. No password, token, last_login,
role or other user fields are returned.

The responsive two-column page has Staff search/list and pending assignments on
the left, Assign Staff above a selected Staff details card on the right. Selected
Staff is highlighted; no selection shows a hint. Empty names show Not set. Pending
rows have Remove; selected Staff details has Remove Staff access. Confirmation
explains that Staff becomes Traveler and the account is retained. The unchanged
assignment message is an info alert, rather than a success alert. Lists and
details handle loading, errors and retry; assignment/removal refresh the lists.

The existing Assign form posts only email to `/api/accounts/staff/assign/`.
Successful assignment shows the backend result and refreshes both lists. Remove
uses the existing `/api/accounts/staff/revoke/` endpoint after confirmation.
Removing Staff changes the role to Traveler without deleting the account;
removing a pending assignment deletes only that row. Cancel is ghost, Remove is
danger, repeated requests are disabled, and successes refresh both lists.
Backend field and general errors remain visible as text. Empty lists, loading,
errors and retry are handled. The underlying assignment/revocation rules and
existing Head promotion/removal endpoints are unchanged.

## Authentication and passwords

Access tokens last **15 minutes**, refresh tokens **7 days**. Refresh rotates the
refresh token, blacklists the replaced token, and returns both new tokens. The frontend stores both tokens in **localStorage**, exclusively through
`src/api/authStorage.ts`; safe profile fields stay in memory in `authState.ts`.
The shared API client reads `VITE_API_URL`, attaches the access token, and tries
`token/refresh/` once after a protected 401, sharing an in-flight refresh between
concurrent requests. It stores both rotated tokens and retries once. A failed
refresh or another 401 clears tokens and redirects to Sign-In. Public credential
requests do not trigger refresh. Logout reads the current refresh token again on
retry, so a rotated token is blacklisted. Logout verifies refresh-token ownership
before blacklisting. Existing access tokens continue until their expiration.
Password change does not blacklist existing tokens.

Sign-in accepts either the unique username or email in `identifier`; wrong
username, email, password, and inactive accounts receive the same 401 message:
`Invalid username/email or password.` No inactive account can authenticate.
Successful sign-in updates `last_login`. Identity matching uses stored values;
an identifier matching two different accounts fails with the generic error.

Django's default password validators run on sign-up and password change, using
the user's profile for similarity checks. Validation messages are returned under
`password` or `new_password`. Password change also requires the correct current
password. Password fields are write-only and hashed using Django's password API.

## Roles and privacy

- Public sign-up rejects `role` and `promoted_by` with 400, even if null. It creates
  a Traveler unless the email has a pending Staff assignment. Applying that
  assignment, creating the Staff account, and deleting the pending row occur in
  one transaction.
- A Head assigns Staff by email. An existing Traveler becomes Staff immediately,
  with no pending row. Existing Staff/Heads remain unchanged with a clear result
  message. Otherwise a unique pending assignment is created; repeating it is a
  no-op. Revocation deletes a pending row or returns existing Staff to Traveler.
- Only Staff can be promoted to Head. `promoted_by` records the acting Head.
  Initial Heads are created by Django administrators with an empty promoter.
- A Head can remove themselves or a Head they promoted, choosing Staff or
  Traveler. The promoter link is cleared. A Head cannot remove their own promoter,
  another Head's promoted Head, or another administrator-created Head.
- Django administrators handle administrator-only removals through Django admin.
  Management API access always requires the Head application role; `is_staff`
  and `is_superuser` alone do not grant it.
- Role removal never deletes accounts or changes Heads the removed Head promoted.
  Role updates are transactional, lock affected users, and recheck the acting
  Head's current role. JWT authentication reads the current user from the database.
- `IsStaffOrHead` admits both Staff and Heads to the protected dashboard endpoint;
  Travelers are denied. Only authenticated Heads can use management endpoints.
- Profile endpoints always operate on the signed-in user. Role, promoter, password,
  and another user's ID cannot be set through profile updates. Management accepts
  the target email and returns only a result message for actions. The approved
  Head reads are limited to the approved Staff list/detail fields and the three
  pending fields above, never details about Travelers or other Heads.

## Development-only Staff seed

Set `SEED_STAFF_USERNAME`, `SEED_STAFF_EMAIL`, and a non-placeholder
`SEED_STAFF_PASSWORD` in `backend/.env`, then run `python manage.py seed_staff`.
This is a local testing command, available only when `DEBUG=True`. It refuses
missing/empty variables and the placeholder `change-me-staff-password`.
It creates or updates Staff directly using Django password hashing, preserves
any matching Head without changing the password or role, rejects username/email
collisions between different users, and never touches `staff_assignments`.
Success output contains only the username and created/updated status. Passwords
are never printed. This command is separate from the Head assignment flow and
does not grant Django administrator access.

## Verification

Run `python manage.py test` and `pytest` from `backend/`. Tests use PostgreSQL's separate test
database and cover sign-up/password validation, assignment consumption and
rollback, sign-in, token lifetimes/rotation/logout ownership, profile privacy,
password changes, authorization, Head removal chains, Staff access, admin
registration, protected deletion, and database constraints. Profile tests cover
all roles, saved-value reloads, protected-field rejection without partial updates,
identity uniqueness, failed password validation preserving the original password,
and attempts to target another user. Area endpoint tests cover the complete
Traveler/Staff/Head matrix, missing authentication, and revocation with existing
tokens.

Frontend Vitest tests mock the API and cover field error associations, safe
Sign-Up payloads, Sign-In storage/navigation, protected routes, restored sessions,
logout success/failure, and one-attempt refresh behavior. Backend seed tests cover
creation, updates, DEBUG/placeholder/missing-variable refusal, Head preservation,
identity conflicts, password hashing, output privacy, and pending assignment
preservation. Dashboard tests cover real API counts/date lists, project-local period bounds,
airport defaults, permissions, empty data and retries. Head and profile UI tests
cover form payloads, backend errors, authorization gates, and saved-profile
restoration after remounting with a fresh backend response. Automated UI checks
use jsdom and API mocks; the new screens have not been visually verified in a
live browser. These tests do not establish a pixel-perfect reference match.
