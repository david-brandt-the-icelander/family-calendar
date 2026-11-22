# Family calendar

**https://icelander.net/apps/z-calendar** (the old addresses, https://icelander.net/calendar and https://icelander.net/apps/calendar, redirect there)

A shared calendar for a household. Everybody keeps weekly schedules (work hours, school hours, a piano
lesson), including children and others who have no sign-in of their own, and the household sees them one
person at a time or all together. Everyone in a household sees everything in it. Beside the schedules it shows the
family's birthdays, anniversaries, death dates, events and pets, which come from
[z-friends-and-family](https://icelander.net/apps/z-friends-and-family/) (z-faf), and an **Upcoming** list of them.

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

### Family dates

| | |
|---|---|
| **Where from** | z-friends-and-family, through the service binding `FAF` (Worker `z-friends-and-family`, entrypoint `Internal`), method `dates(viewer, opts)` with `viewer = { id, email }` and `opts = { from, to, types?, kinds? }`. z-faf decides what each viewer may see; nothing about these people is stored here, and none is in this repository. |
| **What it asks** | For the week, that week; for Upcoming, from today to the end of the range, and for *all time* `to: '9999-12-31'`. Each answer row is one date at its **next occurrence on or after `from`** (`nextDate`). |
| **Shown as** | All-day items, a dashed tag with an icon per type, apart from schedules; an age or a years count when the year is known; each links to the person's page in z-faf. |
| **Filters** | A checkbox per type (birthdays on by default) and a chip per circle. Both, and the Upcoming range (1 month, 3 months by default, 1 year, all time), are the person's own (`user_prefs`), kept across devices. |
| **When z-faf is missing or fails** | The binding absent, throwing, slower than 3 s or answering nonsense all give `available: false`: the calendar works as before, with a small notice. Sign-in still fails closed. |
| **Contacts** | Imported in z-faf, at `/apps/z-friends-and-family/import`; the Upcoming screen links there. |

## Deploying

Live since 2026-11-13. The app is registered with the login service (the `calendar` entry of `APPS` in the
`icelander.net` repository's `accounts/wrangler.jsonc`, callback `https://icelander.net/apps/z-calendar/auth/callback`),
and its database `family-calendar` exists. Nothing deploys on merge; from the repository root:

```bash
npx wrangler d1 migrations apply family-calendar --remote
```

```bash
npx wrangler deploy
```

The routes need nothing in DNS, and Google nothing new: its redirect URI is the login service's own. The `FAF`
binding names the Worker `z-friends-and-family`, which must be deployed first (see the order below).

## Tests

```bash
npm install
scripts/ci-test.sh
```

Unit tests of the weekly-pattern expansion, the base path and redirects, and the family dates and preferences
with a mocked binding; a check that `vendor/icelander-auth` is unedited; then the API against `wrangler dev`
using the library's stand-in sign-in, with a made-up z-friends-and-family (`test/faf-mock/`, run in the same
`wrangler dev` so the `FAF` binding reaches it); then the client in headless Chromium (`test/ui/`;
`npx playwright install chromium` once): every screen draws, a schedule shows in the week, an invite lets a
second person in, the old addresses redirect, family dates in the week and in Upcoming with every filter and
range, the range remembered, z-faf down, phone width, Icelandic. Every name and date in the tests is invented.

## API

All under `/apps/z-calendar/api`, for a signed-in user (`?household=<id>` picks one; the default is the first).

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
| `GET /family-dates?from=&to=&types=&circles=&kinds=` | the viewer's family dates from z-faf, `{ available, dates, circles }` (`circles`: every circle seen, for the filter) |
| `GET /prefs` · `PUT` | the person's own settings: `upcomingRange`, `familyTypes`, `familyCircles`, `upcomingSchedules` |

Sign-in routes (`/apps/z-calendar/auth/sign-in`, `/callback`, `/sign-out`, `/me`) are the library's.
`/apps/z-calendar/join/<token>` spends an invite.

## Moved to /apps/z-calendar (2026-11-22)

The calendar first moved from `/calendar` to `/apps/calendar` (2026-11-21, both served side by side), and then, before the
old path was ever switched off, to `/apps/z-calendar`, next to the family's other private app, z-friends-and-family.
The Worker (`family-calendar`) and its database are the same, so every household and schedule is untouched.

- It signs in only at `/apps/z-calendar`: callback `https://icelander.net/apps/z-calendar/auth/callback`, cookie
  `calendar_session` on Path `/apps/z-calendar`, app id `calendar`. Everyone signs in once more after the deploy.
- `/calendar*` and `/apps/calendar*` answer a **301** to the same path under `/apps/z-calendar`, query kept, for GET and
  HEAD; other methods get a 405 (`moved`). Old invite links and bookmarks land in the right place. The old sign-in
  callbacks redirect too, so a sign-in begun at an old address before the deploy fails once and is simply retried.
- The `OLD_PATH_REDIRECTS` switch is gone.

Deploy order (nothing is deployed by merging):

1. icelander.net's `accounts` Worker with `https://icelander.net/apps/z-calendar/auth/callback` added to the `calendar`
   entry of `APPS` (the old two may stay until step 4).
2. The `z-friends-and-family` Worker, with its `Internal` entrypoint: Cloudflare refuses a deploy whose service binding
   names a Worker that does not exist. (If z-faf is not ready, this one can go out with the `FAF` entry taken out of
   `wrangler.jsonc`: it then shows the "family dates can't be shown" notice and nothing else changes.)
3. This repository: `npx wrangler d1 migrations apply family-calendar --remote` (adds `user_prefs`), then
   `npx wrangler deploy`.
4. Once nobody signs in at the old addresses (the redirects make that immediate), remove the `/calendar/auth/callback` and
   `/apps/calendar/auth/callback` callbacks from `APPS`, and point the site's apps list at `/apps/z-calendar`.

Rollback: redeploy the previous commit (`/apps/calendar` and `/calendar` served, no redirects); the new table is unused by
it and harmless.
