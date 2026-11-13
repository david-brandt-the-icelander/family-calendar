# Design: the redesigned client and calendar import

The owner approved this design on 2026-11-13. It covers the whole client in `public/`: the week (desktop and phone),
the schedule editor, the household, signing in from an invite, and a new **import from other calendars**.
The working canvas is the owner's private Claude Design artifact
<https://claude.ai/artifact/BtPQ1415M5wDsweMLamUMi>. This folder holds a copy for whoever implements it.

| Screen | Picture | Source |
|---|---|---|
| Week, desktop: people × days | [screens/Main.png](screens/Main.png) | [source/Main.dc.html](source/Main.dc.html) |
| Week, phone: one day at a time | [screens/WeekPhone.png](screens/WeekPhone.png) | [source/WeekPhone.dc.html](source/WeekPhone.dc.html) |
| Schedule editor, desktop | [screens/Schedule.png](screens/Schedule.png) | [source/Schedule.dc.html](source/Schedule.dc.html) |
| Household, phone | [screens/Household.png](screens/Household.png) | [source/Household.dc.html](source/Household.dc.html) |
| Signing in from an invite, phone | [screens/SignIn.png](screens/SignIn.png) | [source/SignIn.dc.html](source/SignIn.dc.html) |
| Import a calendar, desktop | [screens/Import.png](screens/Import.png) | [source/Import.dc.html](source/Import.dc.html) |

The pictures are the spec. The `.dc.html` files are design mockups, not code to copy: they are written in the
canvas's component format (`{{holes}}`, `<sc-for>`, `<sc-if>`, a `DCLogic` class). `source/support.js` is a
small stand-in for that runtime, there only so a file opens in a browser (serve the folder, e.g.
`npx http-server design/source`). Read them for exact colours, sizes and copy. The people and schedules in them
(Davíð, Anna, Óli, Sóley) are sample data.

**Every rule in `AGENTS.md` still holds.** In particular: light mode only, no build step, text through
`textContent` only (never `innerHTML`), every string in `public/i18n.js` in both languages, nothing hidden
inside a household, and a browser test in `test/ui/` for every change to `public/`.

## Visual language

Fonts: **Bricolage Grotesque** 700 for headings and big numbers (week title, day numbers, screen titles),
**Inter** 400/500/600 for everything else. Times use `font-variant-numeric: tabular-nums`. Vendoring the two
woff2 files into `public/fonts/` is better than linking Google Fonts: it avoids a third-party request and needs
no build step. Either works with the design.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#F4F3EF` | page ground (warm paper) |
| `--panel` | `#FFFFFF` | cards, grid, inputs |
| `--line` | `#E3E1DA` | borders; `#EEECE6` inner dividers; `#D6D3CA` input borders |
| `--text` | `#1C1E24` | text, active nav pill, "Allir" chip |
| `--dim` | `#5F6470` | secondary text (passes 4.5:1 on white and on `--bg`) |
| `--label` | `#4A4E57` | form labels |
| `--accent` | `#2251CC` | primary buttons, links, today |
| `--today-tint` | `#F2F5FE` header / `#F7F9FE` cells | today's column |
| `--bad` | `#A32A1F` | delete, leave, revoke |

Status tags (small pill, 11–12 px, weight 600, radius 4–6 px):

| Tag | Background | Text |
|---|---|---|
| Fellur niður / Cancelled | `#FDE8E6` | `#A32A1F` |
| Færðist / Moved | `#FFF3D6` | `#7A5200` |
| Aukalega / Extra | `#E3F1FF` | `#1A4FA0` |
| ↻ 2 vikur / every 2 weeks | `#F1EEE6` | `#4A4E57` |
| Ready (import) | `#E4F3EA` | `#145C33` |

**Person colours.** Every person has one colour, used for the avatar, the chip, the left edge of each item,
and a pale tint behind it. The default palette, given in order to people who have no colour of their own,
replaces `PALETTE` in `app.js`:

| Colour | Tint |
|---|---|
| `#2F6FED` blue | `#E8EFFD` |
| `#D9711C` orange | `#FCEEE2` |
| `#1F8A4C` green | `#E4F3EA` |
| `#8E4FE0` purple | `#F1E9FC` |

Pick further colours of similar strength, different enough in lightness as well as hue (blue/orange before
red/green). Text is never set in a person colour on white; white text on the avatar colours is fine.

Shape: cards have radius 16 and a 1 px `--line` border, no shadows. Buttons and inputs are at least 44 px tall
with radius 10–12. Chips are pills. Page content has a max width of 1280 px and 32 px side padding (16 px on
a phone). The logo is four rounded squares in the first four person colours.

## Screens

### Shell

The header holds the logo, "Dagatal", "· <household name>", then the nav (Vika / Stundaskrár / Heimilið),
with the current item as a dark pill. On the right are a language toggle (`IS · EN`, which writes
`localStorage.lang`, the key `app.js` already reads) and the user's avatar (its menu holds Skrá út). Below
720 px the nav moves into a bottom tab bar with icons (see the phone screens).

### Week, desktop (≥ 720 px): `Main.png`

- Title block: "VIKA 46" (ISO week number, worked out on the client) over "9.–15. nóvember" (spanning months:
  "30. nóv – 6. des"). On the right: ‹, Í dag, ›.
- Person chips: "Allir", then one chip per person with a colour dot. A chip toggles that person, and "Allir"
  clears the choice. This is the existing `state.picked` behaviour with a new look. A picked chip fills with
  the person's colour.
- **The grid is people × days.** The first column is 168 px wide (avatar, name, role: "Stjórnandi · þú",
  "Meðlimur", "Án aðgangs"). Then come seven equal day columns, with a header of the weekday abbreviation over
  the date number. Today's column is tinted and its number is in `--accent`.
- Each cell starts with a **day bar**: 6 px tall, covering 06:00–22:00, with a segment in the person's colour
  for each occurrence that isn't cancelled (clamped to the range). Below it come the day's items, by start
  time: time on top (12 px, dim), title (13 px, 600), then a tag if any. Cancelled items stay visible, struck
  through and grey, with the cancellation note after the title.
- The grid scrolls sideways in its own box below 1040 px. Under the grid there is a one-line legend of the
  four tags.

### Week, phone (< 720 px): `WeekPhone.png`

The grid becomes one day at a time.

- Strip of seven day buttons (abbreviation, number, and a row of small colour dashes for who has something
  that day). The chosen day is dark. It defaults to today.
- The same person chips, in a row that scrolls sideways.
- The day's heading ("Föstudagur 13. nóvember · í dag"), then one card per item: start over end on the left,
  a colour bar, title over the person's name, and a tag on the right. After the chosen day, the next day
  follows in the same form.
- Bottom tab bar.

### Schedule editor: `Schedule.png`

- Desktop: on the left, a sidebar with "Ný stundaskrá" (primary) and **"Flytja inn úr öðru dagatali"**
  (secondary, which opens the import), then schedules grouped by person, each with a summary line
  ("Mán–fös · 08:30–16:30"). The chosen one is a white card with an inset left edge in the person's colour.
  Below 720 px the sidebar is the screen, and choosing a schedule opens the editor on its own.
- Editor: the title "Vinna · Anna" with Eyða and Vista. The details card holds Heiti, Hver, Tegund (a
  segmented control of the four kinds), Gildir frá, and Gildir til (valfrjálst).
- **Weekly pattern**, a table: Dagur, Byrjar, Endar, Endurtekur ("Í hverri viku" / "Á 2 vikna fresti" … up to
  8), Fyrsta vika (shown only when repeating every n > 1 weeks, which the API already requires), and ✕. A row
  that repeats every n weeks gets a pale tint. "+ Bæta við tíma" is under the table.
- **Next weeks preview** under the table: when a row repeats every n > 1 weeks, six tiles for the coming weeks
  show whether it falls in each one ("09:00–13:00" or "frí", and a moved week in the "moved" colours). Work
  it out with the same logic as `src/expand.js`. Don't call the server for it.
- **Exceptions**: a list of date · tag · detail · ✕, then a row for adding one (Dagsetning, Hvað gerist, and
  the start and end times when moving or adding). Removing an exception uses the existing
  `DELETE /schedules/:id/exceptions/:eid`, which the client doesn't call yet.
- Adding a dependant moves from this screen to Household.

### Household: `Household.png`

- Household name with "Breyta nafni" (admin only).
- **Fólk á heimilinu** lists members and dependants together: avatar, name, a line saying their role or, for
  a dependant, "Án aðgangs · n stundaskrár", and a colour button that opens a small swatch picker. Then
  "+ Barn eða einhver án aðgangs".
- **Bjóða einhverjum** (admin only): a read-only link field with Afrita (clipboard), "Rennur út 20. nóv · 1
  virkt boð", and Afturkalla. This is the existing `GET` / `DELETE /household/invites`.
- "Yfirgefa heimilið" at the bottom, in red.

### Signing in from an invite: `SignIn.png`

This is the signed-out screen. When the page was reached through `/calendar/join/<token>`, it shows who invited
you, to which household, and until when. That needs a small public lookup of the token's household name,
inviter and expiry, and it must say nothing about a token that is unknown or expired. Without an invite it
shows the plain sign-in. The button reads "Skrá inn með Google", in text only with no Google logo. Under it:
"Sama innskráning og annars staðar á icelander.net".

### Import a calendar (desktop): `Import.png`

Import is a one-time copy of a file. The owner decided against subscribing to calendar links.

1. **File.** A drop area plus "Velja skrá" (`accept=".ics,.zip"`). Google Calendar exports a .zip with one .ics
   file per calendar, and Outlook and Apple export .ics. Under it are short instructions for Google, Outlook,
   Apple, and schools or sports clubs, in `<details>` elements. **Check the menu names against the real apps**
   (and their Icelandic versions) before shipping. The texts in the mockup are a first draft.
2. **Review.** "Þetta er dagatal hjá …" sets who the schedules belong to, defaulting to the signed-in user.
   Then a table with one row per series found: a checkbox, the title with its raw rule in monospace
   (`WEEKLY · MO,TU,TH`), what it becomes ("Mán, þri, fim 09:00–17:00 · í hverri viku"), a Tegund select, and
   a tag. Rows that can't be imported are disabled and unticked, with the reason as their tag. A yellow
   notice appears when an imported title matches an existing schedule of that person. The button says how
   many schedules it will make: "Flytja inn 4 stundaskrár".
3. **Done.** Not drawn. Go to the schedules list with the new schedules picked out, or back to the week, and
   show a one-line summary.

#### How .ics maps to schedules

Parse on the client, in a new `public/ics.js` with no dependencies, so the file never reaches the server.
Unfold lines (CRLF followed by a space or tab), undo text escapes (`\,` `\;` `\n` `\\`), and group `VEVENT`s
by `UID`. For a .zip, read the central directory and inflate each `.ics` entry with
`DecompressionStream('deflate-raw')`. Then send the reviewed result to the server as **normalized JSON, never
the raw file**, through one new atomic endpoint (proposal: `POST /schedules/import`, which writes everything
with one `DB.batch`, so a half-done import can't happen, and checks every rule exactly as the existing
endpoints do).

| In the .ics | Becomes |
|---|---|
| `RRULE:FREQ=WEEKLY` with `BYDAY` (no ordinal) | one rule row per weekday; no `BYDAY` → `DTSTART`'s weekday |
| `INTERVAL=n`, 2 ≤ n ≤ 8 | `every_n_weeks = n`, `anchor_date` = `DTSTART`'s date |
| `FREQ=DAILY`, no `INTERVAL` | seven rows (or the `BYDAY` days) |
| `DTSTART` date | `valid_from` |
| `UNTIL` (inclusive) or `COUNT` (date of the last occurrence) | `valid_until` |
| `DTSTART`/`DTEND` times | `start_time`/`end_time` as wall-clock in the schedule's `tz` (Atlantic/Reykjavik): convert `TZID=` and `Z` times with `Intl` |
| `EXDATE` | a `cancel` exception |
| an override (`RECURRENCE-ID`) on the same date, other times | a `move` exception |
| an override with `STATUS:CANCELLED` | a `cancel` exception |
| an override moved to another date | `cancel` on the old date plus `add` on the new one |
| `SUMMARY` | `title` (trimmed, at most what `title` allows) |
| `X-WR-CALNAME` | shown as the calendar's name when a zip holds several |

Not imported. Show these rows disabled, with their reason:

- a one-off event: "Einstakir viðburðir koma síðar". It becomes importable when the `events` backlog item
  lands.
- `MONTHLY`, `YEARLY`, ordinal `BYDAY` (`1MO`), `BYSETPOS`, `INTERVAL` > 8: "… ekki stutt".
- all-day events, and events that end after midnight (the API requires end after start): "Heilsdags… / Nær
  yfir miðnætti".
- series that ended before today: "Liðið". Tick them only if they're asked for.

Kind defaults to `other`, and the person chooses on the review screen. Exceptions dated before today may be
dropped. Limit the file size (say 5 MB) and show a plain error for a file that isn't a calendar.

**Matching an existing schedule** means the same owner and the same title (ignoring case). The default is to
merge: the imported weekly pattern replaces the existing one, `valid_from`/`valid_until` are taken from the
import, and imported exceptions are added while existing ones are kept. "Búa frekar til nýja stundaskrá"
switches that row to creating a new schedule.

Tests: unit tests for `ics.js`. Use small hand-written .ics fixtures in `test/fixtures/` that cover each row of
both lists above, including folded lines, a `TZID` other than UTC, and a Google-style zip. Add an itest for
the import endpoint, including a second household that must stay untouched. Add a browser test that drops a
fixture file, sees the review table, imports, and finds the schedule in the week.

## What the API needs

The design needs these changes. They are listed as items in `.dev/backlog.json` (`redesign-client`,
`occurrence-status`, `person-colours`, `ics-import`, `invite-preview`).

1. **Occurrences carry their status.** `expand()` currently drops cancelled dates and doesn't say an
   occurrence was moved, added or alternating. The week needs all of that. Return every occurrence with
   `status: 'normal' | 'cancelled' | 'moved' | 'extra'`, the exception's `note`, and `every_n_weeks` from its
   rule. A cancelled one keeps the rule's original times. Anything that counts busy time (the `free-time`
   backlog item) must skip `cancelled`. Update `test/unit-expand.mjs`.
2. **A colour for every person.** Members have no `colour` column, and dependants can only get a colour when
   they are added. Add a migration for `members.colour`, plus `PATCH /people/:id` (name, colour) and a colour
   on `PATCH /household/members/:id`. A member changes their own colour and their dependants', and an admin
   changes anyone's, matching the rule for schedules. `/people` returns `colour` for everyone, and the client
   falls back to the palette when it's empty.
3. **Import endpoint** as above.
4. **Invite preview** for the sign-in screen: `GET /calendar/api/invites/:token` without signing in, which
   returns only the household name, the inviter's first name and the expiry, or 404.

## New strings

Every new string goes into `public/i18n.js` in both languages. These are the ones the design adds, with keys
as suggestions:

| Key | is | en |
|---|---|---|
| `weekNo` | Vika {n} | Week {n} |
| `everyNWeeks` | Á {n} vikna fresti | Every {n} weeks |
| `everyWeek` | Í hverri viku | Every week |
| `altTag` | ↻ {n} vikur | ↻ {n} weeks |
| `tagCancelled` / `tagMoved` / `tagExtra` | Fellur niður / Færðist / Aukalega | Cancelled / Moved / Extra |
| `legendAlt` / `legendCancel` / `legendMove` / `legendExtra` | aðra hverja viku / undantekning / annar tími þessa viku / bara þennan dag | alternate weeks / exception / different time this week / this day only |
| `roleYou` / `roleMember` / `roleNoLogin` | þú / Meðlimur / Án aðgangs | you / Member / No sign-in |
| `nextWeeks` | Næstu vikur | Coming weeks |
| `off` | frí | off |
| `optional` | valfrjálst | optional |
| `import` | Flytja inn úr öðru dagatali | Import from another calendar |
| `importTitle` | Flytja inn dagatal | Import a calendar |
| `importDrop` | Dragðu .ics eða .zip skrá hingað | Drop an .ics or .zip file here |
| `importPick` | Velja skrá | Choose file |
| `importWhose` | Þetta er dagatal hjá | This calendar belongs to |
| `importHelp` | Endurteknir viðburðir verða stundaskrár. Felldar og færðar dagsetningar verða undantekningar. Engu er breytt fyrr en þú staðfestir. | Repeating events become schedules. Cancelled and moved dates become exceptions. Nothing changes until you confirm. |
| `importFound` | Fannst í skránni | Found in the file |
| `importGo` | Flytja inn {n} stundaskrár | Import {n} schedules |
| `importMerge` | „{title}“ er nú þegar til hjá {name}. … | "{title}" already exists for {name}. … |
| `skipOneOff` / `skipUnsupported` / `skipAllDay` / `skipPast` | Einstakir viðburðir koma síðar / … ekki stutt / Heilsdagsviðburður / Liðið | One-off events come later / … not supported / All-day event / Ended |
| `inviteBanner` | Þér er boðið á heimilið {name} | You're invited to the household {name} |
| `signinWithGoogle` | Skrá inn með Google | Sign in with Google |
| `copy` / `revoke` / `expires` | Afrita / Afturkalla / Rennur út {date} | Copy / Revoke / Expires {date} |

Icelandic genitive forms of names ("hjá Önnu") can't be generated from the name. Use the nominative in
`{name}`, or rephrase so the name stays in the nominative ("Anna er nú þegar með „Vinna“").

## Accessibility

Use real `<button>`, `<a href>`, `<input>` and `<label>`. Chips and day tabs use `aria-pressed` /
`aria-selected`, and icon-only buttons have an `aria-label`. Touch targets are at least 44 px. Statuses are
told apart by text as well as colour.
