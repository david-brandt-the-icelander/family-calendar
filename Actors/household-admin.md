# Household admin

**Kind:** person in a role
**Evidence:** `migrations/0001_init.sql` (`members.role = 'admin'`), `src/households.js` (`createHouseholdFor`, `createInvite`, `removeMember`), `src/schedules.js` (`mayEdit`)

## What they want from the system

- To have a household made for them the first time they open the calendar, and to bring the rest of the family in with an invite link.
- To fix anyone's schedule, and to remove somebody who should not be there.

## How they reach it

The same browser app as a [household member](household-member.md). The first person in a household is its admin, and a household always keeps one.
