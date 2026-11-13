# Family calendar

**https://icelander.net/calendar**

A shared calendar for a household. Everybody keeps weekly schedules (work hours, school hours, a piano
lesson), including children and others who have no sign-in of their own, and the household sees them one
person at a time or all together. Everyone in a household sees everything in it.

One Cloudflare Worker, one D1 database, a static client with no build step. Icelandic and English, light mode
only. Sign-in is **icelander.net's login service** (Google, and whatever it adds): this repository only holds
the vendored client library and a service binding, and never sees a password or a provider's token.

## How it works

| | |
|---|---|
| **Household** | Created for somebody the first time they open the calendar, who is its admin. Anybody else joins by an invite link (single use, 7 days). |
| **Person** | A household member who signs in, or a *dependant* an admin or member adds by name. |
| **Schedule** | Belongs to one person: a title, a kind, an optional valid-from and valid-until, a weekly pattern and exceptions. |
| **Weekly pattern** | Rows of weekday + start + end, each optionally every *n* weeks from an anchor week (alternating weeks). Occurrences are expanded for the dates asked for and never stored. |
| **Exception** | On one date: cancel it, move it to another time, or add an extra. |

A member edits their own schedules and those of dependants; an admin edits anyone's.

## Setup (the owner does this; nothing here is run for you)

1. **Register the app with the login service** (a change in the `icelander.net` repository: the `calendar` entry
   of `APPS` in `accounts/wrangler.jsonc`, then deploy `accounts`).
2. **Create the database** and put its id in `wrangler.jsonc`:

   ```bash
   npx wrangler d1 create family-calendar
   npx wrangler d1 migrations apply family-calendar --remote
   ```

3. **Deploy:**

   ```bash
   npx wrangler deploy
   ```

The route `icelander.net/calendar*` needs nothing in DNS. Google needs nothing new: its redirect URI is the
login service's own.

## Tests

```bash
npm install
scripts/ci-test.sh
```

Unit tests of the weekly-pattern expansion, a check that `vendor/icelander-auth` is unedited, then the API
against `wrangler dev` using the library's stand-in sign-in.

## API

All under `/calendar/api`, for a signed-in user (`?household=<id>` picks one; the default is the first).

| | |
|---|---|
| `GET /me` | the user and their households |
| `GET /household` · `PATCH` | members / rename (admin) |
| `GET /household/invites` · `POST` · `DELETE /:token` | invite links (admin) |
| `DELETE /household/members/:userId` | remove (admin) or leave |
| `GET /people` · `POST` · `DELETE /:id` | household people / add or remove a dependant |
| `GET /schedules` · `POST` · `PATCH /:id` · `DELETE /:id` | schedules |
| `PUT /schedules/:id/rules` | replace the weekly pattern |
| `GET` · `POST /schedules/:id/exceptions` · `DELETE /:eid` | exceptions |
| `GET /agenda?from=&to=&people=a,b` | occurrences, at most 62 days |

Sign-in routes (`/calendar/auth/sign-in`, `/callback`, `/sign-out`, `/me`) are the library's.
`/calendar/join/<token>` spends an invite.
