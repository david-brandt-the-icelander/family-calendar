# Household member

**Kind:** person in a role
**Evidence:** `migrations/0001_init.sql` (`members`, role `member` or `admin`), `src/index.js` (`route`: a user from `auth.currentUser`, then `myHouseholds`), `src/schedules.js` (`mayEdit`)

## What they want from the system

- To sign in with the Google account they use everywhere on icelander.net, and land in their household.
- To keep their own weekly schedules (work, school, a lesson) and those of children who have no sign-in, and see everyone's together or one person's at a time.
- To leave a household.

## How they reach it

A browser, usually a phone, at icelander.net/calendar.

## Not to be confused with

- [Household admin](household-admin.md): a member who also renames the household, invites and removes people, and edits anyone's schedules.
