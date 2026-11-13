-- Family calendar — the whole schema.
--
-- Who a person is (and how they sign in) belongs to the icelander.net login service; this database
-- knows a person only by the id it gives them (`a-…`), and keeps the name and picture it last saw.
-- A household is the isolation boundary: every other table carries household_id, and no query
-- touches a row without it.

PRAGMA foreign_keys = ON;

CREATE TABLE households (
  id          TEXT PRIMARY KEY,                 -- uuid v4
  name        TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE members (
  household_id  TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,                  -- the login service's id
  name          TEXT NOT NULL,
  picture       TEXT,
  email         TEXT,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  joined_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (household_id, user_id)
);
CREATE INDEX idx_members_user ON members(user_id);

-- One link, one person, one week. Only a hash of the token would be stronger, but a link
-- that is single-use and short-lived is what the invite is; it is deleted when used.
CREATE TABLE invites (
  token         TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL
);
CREATE INDEX idx_invites_household ON invites(household_id);

-- A person in a household who has no sign-in of their own: a child, a grandparent.
CREATE TABLE people (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  colour        TEXT,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_people_household ON people(household_id);

-- Someone's recurring commitment: work, school, piano. Times are wall-clock in `tz`.
CREATE TABLE schedules (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  owner_kind    TEXT NOT NULL CHECK (owner_kind IN ('user','person')),
  owner_id      TEXT NOT NULL,                  -- a members.user_id, or people.id
  title         TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('work','school','activity','other')),
  colour        TEXT,
  tz            TEXT NOT NULL DEFAULT 'Atlantic/Reykjavik',
  valid_from    TEXT,                           -- YYYY-MM-DD, inclusive
  valid_until   TEXT,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_schedules_household ON schedules(household_id);
CREATE INDEX idx_schedules_owner     ON schedules(household_id, owner_id);

-- The weekly pattern. weekday is ISO, 1 = Monday .. 7 = Sunday. every_n_weeks > 1 needs
-- anchor_date, a date in the first week of the cycle.
CREATE TABLE schedule_rules (
  id             TEXT PRIMARY KEY,
  schedule_id    TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  weekday        INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time     TEXT NOT NULL,                 -- HH:MM
  end_time       TEXT NOT NULL,
  every_n_weeks  INTEGER NOT NULL DEFAULT 1 CHECK (every_n_weeks BETWEEN 1 AND 8),
  anchor_date    TEXT
);
CREATE INDEX idx_rules_schedule ON schedule_rules(schedule_id);

-- A holiday, a sick day, a lesson moved to another time, an extra shift.
--   cancel  nothing on that date
--   move    that date's occurrences are replaced by start_time-end_time
--   add     an extra occurrence of start_time-end_time
CREATE TABLE schedule_exceptions (
  id           TEXT PRIMARY KEY,
  schedule_id  TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('cancel','move','add')),
  start_time   TEXT,
  end_time     TEXT,
  note         TEXT
);
CREATE INDEX idx_exceptions_schedule ON schedule_exceptions(schedule_id, date);
