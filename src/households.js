// Households, their members and invites. A household is the isolation boundary: it is created for
// somebody the first time they open the calendar, and anybody else gets in by an invite link.

import { json, fail, uuid, randomToken } from './lib.js';

const INVITE_DAYS = 7;
export const INVITE_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Keep the name and picture we show for a person current: the login service is the authority. */
export async function touchMember(env, user) {
  await env.DB
    .prepare('UPDATE members SET name = ?, picture = ?, email = ? WHERE user_id = ?')
    .bind(user.name || user.email || 'Someone', user.picture ?? null, user.email ?? null, user.id)
    .run();
}

export async function myHouseholds(env, userId) {
  // created_at has whole seconds; rowid keeps two made in the same second in the order they were made.
  const rows = await env.DB
    .prepare(
      `SELECT h.id, h.name, m.role FROM members m JOIN households h ON h.id = m.household_id
        WHERE m.user_id = ? ORDER BY h.created_at ASC, h.rowid ASC`
    )
    .bind(userId).all();
  return rows.results ?? [];
}

/** First visit: a household of one, and that person its admin. */
export async function createHouseholdFor(env, user) {
  const id = uuid();
  const name = String(user.name || user.email || 'Family').slice(0, 80);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO households (id, name, created_by) VALUES (?,?,?)').bind(id, name, user.id),
    env.DB
      .prepare(`INSERT INTO members (household_id, user_id, name, picture, email, role) VALUES (?,?,?,?,?,'admin')`)
      .bind(id, user.id, name, user.picture ?? null, user.email ?? null),
  ]);
  return { id, name, role: 'admin' };
}

export function membership(env, householdId, userId) {
  return env.DB
    .prepare('SELECT role FROM members WHERE household_id = ? AND user_id = ?')
    .bind(householdId, userId).first();
}

export async function members(env, householdId) {
  const rows = await env.DB
    .prepare('SELECT user_id AS id, name, picture, role FROM members WHERE household_id = ? ORDER BY name')
    .bind(householdId).all();
  return rows.results ?? [];
}

export async function renameHousehold(env, householdId, body) {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  if (!name) return fail('name_required', 400, 'name is required');
  await env.DB.prepare('UPDATE households SET name = ? WHERE id = ?').bind(name, householdId).run();
  return json({ ok: true });
}

export async function createInvite(env, user, householdId, origin) {
  const token = randomToken(24);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM invites WHERE expires_at <= datetime('now')`),
    env.DB
      .prepare(`INSERT INTO invites (token, household_id, created_by, expires_at)
                VALUES (?,?,?, datetime('now', '+${INVITE_DAYS} days'))`)
      .bind(token, householdId, user.id),
  ]);
  return json({ token, url: `${origin}/calendar/join/${token}`, days: INVITE_DAYS }, 201);
}

export async function listInvites(env, householdId) {
  const rows = await env.DB
    .prepare(`SELECT token, created_at, expires_at FROM invites
               WHERE household_id = ? AND expires_at > datetime('now') ORDER BY created_at DESC`)
    .bind(householdId).all();
  return json({ invites: rows.results ?? [] });
}

export async function revokeInvite(env, householdId, token) {
  await env.DB.prepare('DELETE FROM invites WHERE household_id = ? AND token = ?').bind(householdId, token).run();
  return json({ ok: true });
}

/**
 * Spend an invite: the person joins that household, and the link is gone. Single use, so a link
 * pasted into a group chat lets in exactly one person. Returns the household id, or null.
 */
export async function acceptInvite(env, user, token) {
  const inv = await env.DB
    .prepare(`DELETE FROM invites WHERE token = ? AND expires_at > datetime('now') RETURNING household_id`)
    .bind(token).first();
  if (!inv) return null;
  await env.DB
    .prepare(`INSERT INTO members (household_id, user_id, name, picture, email, role) VALUES (?,?,?,?,?,'member')
              ON CONFLICT(household_id, user_id) DO NOTHING`)
    .bind(inv.household_id, user.id, user.name || user.email || 'Someone', user.picture ?? null, user.email ?? null)
    .run();
  await dropEmptyOwnHouseholds(env, user.id, inv.household_id);
  return inv.household_id;
}

/**
 * Whoever opens the calendar before following an invite already has a household of one, made on
 * their first visit; the client shows only the first household, so they would never see the one
 * they joined. A household of theirs with nobody else, no people and no schedules holds nothing:
 * it goes. One with anything in it stays.
 */
async function dropEmptyOwnHouseholds(env, userId, joinedId) {
  const empty = (await env.DB
    .prepare(
      `SELECT h.id FROM households h JOIN members m ON m.household_id = h.id AND m.user_id = ?1
        WHERE h.id <> ?2 AND h.created_by = ?1
          AND NOT EXISTS (SELECT 1 FROM members o   WHERE o.household_id = h.id AND o.user_id <> ?1)
          AND NOT EXISTS (SELECT 1 FROM people p    WHERE p.household_id = h.id)
          AND NOT EXISTS (SELECT 1 FROM schedules s WHERE s.household_id = h.id)`
    )
    .bind(userId, joinedId).all()).results ?? [];
  if (!empty.length) return;
  await env.DB.batch(empty.flatMap(({ id }) => [
    env.DB.prepare('DELETE FROM invites WHERE household_id = ?').bind(id),
    env.DB.prepare('DELETE FROM members WHERE household_id = ?').bind(id),
    env.DB.prepare('DELETE FROM households WHERE id = ?').bind(id),
  ]));
}

/** An admin removes anybody else; anybody may leave. Their own schedules go with them. */
export async function removeMember(env, actor, role, householdId, userId) {
  if (userId !== actor.id && role !== 'admin') return fail('forbidden', 403, 'only an admin removes somebody else');
  const target = await membership(env, householdId, userId);
  if (!target) return fail('not_found', 404, 'not in this household');
  if (target.role === 'admin') {
    const admins = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM members WHERE household_id = ? AND role = 'admin'`).bind(householdId).first();
    if (admins.n <= 1) return fail('last_admin', 409, 'a household needs an admin');
  }
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM schedules WHERE household_id = ? AND owner_kind = 'user' AND owner_id = ?`).bind(householdId, userId),
    env.DB.prepare('DELETE FROM members WHERE household_id = ? AND user_id = ?').bind(householdId, userId),
  ]);
  return json({ ok: true });
}
