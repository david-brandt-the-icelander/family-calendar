-- A person's own settings for the calendar: the Upcoming view's range and which family dates to show (src/prefs.js).
-- Keyed by the login service's user id alone, not by household: they are the person's, not anything a household shares,
-- and hold nothing about anybody else.
CREATE TABLE user_prefs (
  user_id     TEXT PRIMARY KEY,
  prefs       TEXT NOT NULL,                    -- JSON, validated by cleanPrefs() on the way in and out
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
