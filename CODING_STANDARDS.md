# CODING_STANDARDS

This file tells Codex how to write code in this project.
Follow `PROMPTING_RULES.md` for how to handle requests, `frontend/UI_STYLE_GUIDE.md` for everything the user sees, and `docs/database.md` for the database. Ask the owner whenever a standard here does not cover the situation.

**Stack:**

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript (Vite), Vitest, Oxlint, Prettier |
| Backend | Python, Django, Django REST Framework, Ruff, pytest-django |
| Database | PostgreSQL |
| Authentication | Token-based (JWT), djangorestframework-simplejwt with token_blacklist |

---

## Readability first

- Write code that explains itself through clear names and small functions.
- Prefer simple and obvious over clever and short.
- One function does one job. If a function needs a long explanation, split it.
- Avoid deep nesting. Use early returns to keep the main path flat.
- Remove dead code, unused imports, and leftover debug output (`print`, `console.log`) before finishing.

## Naming

| Item | Style | Example |
|---|---|---|
| Python variables, functions | `snake_case` | `get_pending_requests` |
| Python classes, Django models | `PascalCase` | `ServiceRequest` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_UPLOAD_SIZE` |
| Files and modules | `snake_case` | `request_views.py` |
| JS/React variables, functions | `camelCase` | `fetchRequests` |
| React components | `PascalCase` | `RequestList` |
| Frontend feature folders | lowercase with hyphens | `staff-dashboard` |

- Names must describe purpose. Avoid `data`, `temp`, `x`, `obj`, `stuff`.
- Booleans read like questions: `is_active`, `has_permission`.
- Do not use unclear abbreviations.

## Comments: only where needed

Default is **no comment**. Good names and structure should make code clear.

Add a comment only when:

- The logic is confusing or non-obvious.
- There is a business rule that cannot be seen from the code.
- A workaround exists and the reason would otherwise be lost.
- A decision looks wrong but is intentional.

Comments explain **why**, not **what**.

```python
# Bad: repeats the code
# Loop through users
for user in users:
    ...

# Good: explains a reason
# Staff accounts are excluded because they are managed in a separate report.
active_users = users.filter(role="traveler")
```

- Do not comment every line, every function, or every import.
- Do not leave commented-out code.
- Keep comments short and up to date. Delete a comment if the code changes and it no longer applies.
- Docstrings are for public functions or classes whose purpose is not obvious from the name.
- A `TODO` comment is allowed only to mark a connection point the owner has described (for example where an API call will be added later). Say what is missing.

## Python / Django

- Follow PEP 8. Keep lines at a readable length.
- Keep views thin. Put business logic in services or model methods, not in views or templates.
- Use Django's ORM. Do not write raw SQL unless there is a clear reason, and explain that reason.
- Use `select_related` and `prefetch_related` to avoid repeated queries in loops.
- Validate input in serializers, not scattered across views.
- Always use migrations for schema changes. Never edit the database by hand. Never rewrite or delete an applied migration without asking.
- Set the custom user model (`AUTH_USER_MODEL`) before the first migration.
- Use `get_object_or_404` instead of unguarded `.get()` in views.
- Check permissions on every view that touches protected data.
- Handle expected errors with specific exceptions. Never use a bare `except:`.
- Use type hints on new functions when they add clarity.

## Frontend structure: one folder per feature

- Every feature lives in its own folder inside `frontend/src/features/`, such as `signin`, `signup`, `homepage`, `flights`, `calendar`, `suggestions`, `profile`, and `staff-dashboard`.
- A feature folder holds that feature's own components, API calls, and types. A feature must not reach into another feature's folder. If two features need the same thing, move it to `src/components` or `src/types`.
- Shared pieces go in `src/components` (shared UI), `src/api` (shared API client), and `src/types` (shared types).
- Icons live only in `src/assets/icons`. Do not add an icon library or new icon files without asking. Do not draw icons or logos inline as SVG.
- Design reference images live in `src/references`. Never import them or render them on a page.
- Whether `src/pages` is used alongside `src/features` is TBD. Ask before creating files there.
- Do not create a new feature folder, or rename one, without asking the owner.

## Frontend code

- Use small, reusable components with a single purpose.
- Use TypeScript types. Avoid `any`.
- Keep API calls out of components. Put them in the feature's own API file, using the shared API client.
- Do not hardcode URLs or ports. Read them from configuration.
- Handle loading and error states.
- Sample data used before the backend exists lives in typed constants, never inside component markup, and is clearly labeled as sample data on screen.

## UI/UX: always follow `frontend/UI_STYLE_GUIDE.md`

- Every screen, page, component, and style you create or change must follow `frontend/UI_STYLE_GUIDE.md`. This is not optional.
- Use only the colors, spacing, sizes, icons, and component looks defined there. Do not invent new ones.
- Use each icon for the label or purpose the guide gives it.
- Keep colors and sizes in shared variables in the global stylesheet. Do not hardcode them inside components or templates.
- Every clickable element needs default, hover, pressed, and focus looks as described in the guide.
- The traffic calendar picks its colors from the crowd level, as described in the guide. Never store a color in the database.
- If the guide does not cover a design need, or you think a different style is better, stop, explain why, and wait for approval (see `PROMPTING_RULES.md`).

## Authentication and privacy

- Passwords are hashed with Django's built-in hashing. Never store, log, print, or return a plain text password or a password hash.
- Public sign-up does not allow users to set `role` or `promoted_by`. Users register as Travelers, unless their email was previously assigned Staff access by a Head. In that case they receive Staff access when they register.
- Staff access is assigned by Heads using an email address, whether the account exists or not. Public sign-up must not allow users to choose Staff or Head access.
- Django administrators create initial Heads. Heads can promote Staff members to Head.
- Heads can remove Head access only from Heads they promoted or themselves, and cannot remove the Head who promoted them.
- Admin-created Heads can have Head access removed only by Django administrators or themselves.
- When an authorized Head removes Head access (including their own), the acting Head chooses Staff or full revocation to Traveler. Clear promoted_by on the removed user. Fully revoking Staff access returns a user to Traveler.
- Removing a Head must not affect the Heads they previously promoted.
- Role changes must not delete user accounts.
- Staff can update or delete their own flights. Heads can update or delete any flight. Travelers have read access.
- Staff and Heads can edit any forecast and delete manual forecasts. Editing a calculated forecast converts it to `Staff entry` while preserving its airport, date, and creator. Deleting a manual forecast recalculates its airport/date pair in the same transaction.
- Check the user's role on every protected page and endpoint, on the backend as well as the frontend.
- Use the token flow for sign-in. Send passwords only when required for sign-up, sign-in, or authorized password changes. Never include passwords in unrelated requests, logs, or responses.
- Use djangorestframework-simplejwt and its token_blacklist app for JWT authentication.
- Access tokens last 15 minutes; refresh tokens last 7 days. Rotate refresh tokens and blacklist the replaced token. Logout requires the signed-in user's own refresh token and blacklists it. Existing access tokens expire normally.
- Apply Django's default password validators to sign-up and password changes and return their validation messages. Password changes require the current password.
- Head management API responses contain only a result message; profile details remain private. Role permissions read the current database role on every request, not a role cached in a JWT.
- Never store passenger names, booking reference numbers, payment details, or ticket prices.
- Keep personal details private. Never show one user's details to another user, and never put them in logs or error messages.

## Configuration and secrets

- Never hardcode secrets, passwords, API keys, or database credentials.
- Read them from environment variables (`.env`), and keep `.env` out of version control.
- When a new variable is needed, add it to `.env.example` with a placeholder value and tell the owner.
- Do not invent values for variables. Use `TBD` or ask.

## Database (PostgreSQL)

- `docs/database.md` is the source of truth for tables, fields, and relationships. Follow it exactly.
- Do not add, remove, or rename a table or field that is not in `docs/database.md` without asking.
- Update `docs/database.md` in the same change as any approved schema change.
- Use clear, singular model names and descriptive field names.
- Set field constraints (`null`, `blank`, `unique`, `max_length`) on purpose, as described in `docs/database.md`.
- Add indexes only when there is a reason.
- Never run destructive operations (drop, truncate, bulk delete) without explicit approval.

## Security

- Never trust user input. Validate and sanitize it.
- Do not disable CSRF protection or other built-in safeguards to make something work.
- Do not expose stack traces or secrets to users.
- Keep `DEBUG` off outside local development.

## Testing

- Add or update tests for any behavior you change or add.
- Test names describe the behavior: `test_staff_cannot_delete_request`.
- Run the tests before reporting that work is done. If you cannot run them, say so.

## Git and change hygiene

- Keep changes small and focused on one purpose.
- Use clear commit messages in the imperative form: `Add request status filter`.
- Do not commit generated files, virtual environments, or `.env`.
- Do not run `git commit` or `git push` unless the owner asks.

## Before you finish

- [ ] Code is readable, with comments only where the logic is confusing.
- [ ] Each feature stays inside its own folder, and shared code is in the shared folders.
- [ ] Any UI work follows `frontend/UI_STYLE_GUIDE.md`, including its icons.
- [ ] Any database work matches `docs/database.md`.
- [ ] No passwords, secrets, or hardcoded config values.
- [ ] No unused code, imports, or debug output.
- [ ] Tests were added or updated, and run (or I said I could not run them).
