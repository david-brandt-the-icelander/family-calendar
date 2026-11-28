// The client, in a real browser: every screen draws (no "[object HTMLDivElement]"), and the main flows
// work end to end. The API tests (test/itest.sh) never render a page, which is how a client that drew
// nothing but text once reached production.
import { test, expect } from '@playwright/test';

const run = Date.now().toString(36);
const BASE = '/apps/z-calendar';
const signIn = (page, who, name) =>
  page.goto(`${BASE}/auth/dev?email=${who}-${run}@x.test&name=${name}&return=${BASE}/`);

/** Nothing on the page is an element printed as text, and the browser logged no error. */
async function drawsProperly(page) {
  await expect(page.locator('#app')).not.toContainText('[object');
  await expect(page.locator('#app')).not.toContainText('undefined');
}

// Any script error or console error in any page of a test fails it.
let errors = [];
test.beforeEach(async ({ context }) => {
  errors = [];
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(String(e)));
    // A signed-out page asks /api/me and is told 401: that is how it knows to offer sign-in.
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('status of 401')) errors.push(m.text()); });
  };
  context.pages().forEach(watch);
  context.on('page', watch);
});
test.afterEach(() => expect(errors, 'errors in the browser').toEqual([]));

test('signed out: a sign-in button and nothing else', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', /^\/apps\/z-calendar\/auth\/sign-in/);
  await drawsProperly(page);
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
});

test('a household: schedule, week, invite, a second person joins', async ({ page, browser }) => {
  await signIn(page, 'anna', 'Anna');

  // Week: seven days, nobody's schedules yet.
  await expect(page.locator('.day')).toHaveCount(7);
  await expect(page.locator('.day').first()).toContainText('Nothing scheduled');
  await drawsProperly(page);

  // Schedules: add one, give it a Monday time, save.
  await page.getByRole('link', { name: 'Schedules' }).click();
  await expect(page.getByText('No schedules yet.')).toBeVisible();
  await drawsProperly(page);
  await page.getByPlaceholder('Title').fill('Piano');
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await page.getByRole('button', { name: 'Add a time' }).click();
  await page.locator('.card').nth(1).locator('input[type=time]').nth(0).fill('16:00');
  await page.locator('.card').nth(1).locator('input[type=time]').nth(1).fill('16:45');
  await page.getByRole('button', { name: 'Save' }).click();
  await drawsProperly(page);

  // It is on Monday of this week, and nowhere else.
  await page.getByRole('link', { name: 'Week' }).click();
  await expect(page.locator('.day').first().locator('.occ')).toContainText('Piano');
  await expect(page.locator('.day').first().locator('.occ')).toContainText('16:00–16:45');
  await expect(page.locator('.day .occ')).toHaveCount(1);
  await drawsProperly(page);

  // Household: an invite link stays on screen once made.
  await page.getByRole('link', { name: 'Household' }).click();
  await drawsProperly(page);
  await expect(page.getByText('People in the household')).toBeVisible();
  await page.getByRole('button', { name: 'Invite someone' }).click();
  const link = page.locator('input[readonly]');
  await expect(link).toHaveValue(/\/apps\/z-calendar\/join\/[A-Za-z0-9_-]{16,}$/);
  const url = new URL(await link.inputValue());

  // Bjorn follows it in a browser of his own, and is in Anna's household.
  const other = await browser.newContext();
  const bjorn = await other.newPage();
  await signIn(bjorn, 'bjorn', 'Bjorn');
  await bjorn.goto(url.pathname);
  await expect(bjorn.locator('.occ').first()).toContainText('Piano');
  await bjorn.getByRole('link', { name: 'Household' }).click();
  await expect(bjorn.locator('.card').nth(1)).toContainText('Anna');
  await expect(bjorn.locator('.card').nth(1)).toContainText('Bjorn');
  await drawsProperly(bjorn);
  await other.close();

  // Back with Anna: a chip per person, and the selected one can be read.
  await page.getByRole('link', { name: 'Week' }).click();
  await expect(page.locator('.chips .chip')).toHaveCount(3);
  await expect(page.locator('.chips .chip.on')).toHaveText('Everyone');
  await expect(page.locator('.chips .chip.on')).not.toHaveCSS('background-color', 'rgb(223, 227, 232)');
});

test('phone width: nothing scrolls sideways', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await signIn(page, 'phone', 'Phone');
  for (const tab of ['Week', 'Upcoming', 'Schedules', 'Household']) {
    await page.getByRole('link', { name: tab }).click();
    await drawsProperly(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), tab).toBeLessThanOrEqual(375);
  }
  // The longest Upcoming list there is: every kind of date, all time.
  await page.getByRole('link', { name: 'Upcoming' }).click();
  for (const t of ['anniversary', 'death', 'event', 'pet']) await tick(page, t);
  await page.getByRole('button', { name: 'All time' }).click();
  await expect(page.locator('.upcoming .fam')).toHaveCount(7);
  expect(await page.evaluate(() => document.documentElement.scrollWidth), 'all time').toBeLessThanOrEqual(375);
  await page.getByRole('link', { name: 'Week' }).click();
  await expect(page.locator('.fam').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth), 'week with dates').toBeLessThanOrEqual(375);
  await ctx.close();
});

test('Icelandic when the browser asks for it', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'is-IS' });
  const page = await ctx.newPage();
  await signIn(page, 'is', 'Sigga');
  await expect(page.getByRole('link', { name: 'Vika' })).toBeVisible();
  await drawsProperly(page);
  await ctx.close();
});

// ------------------------------------------------------------------ the move to /apps/z-calendar
test('the old addresses land on /apps/z-calendar, path and query kept', async ({ page }) => {
  for (const old of ['/calendar', '/apps/calendar']) {
    await page.goto(`${old}/?invite=invalid`);
    expect(new URL(page.url()).pathname + new URL(page.url()).search, old).toBe(`${BASE}/?invite=invalid`);
    await expect(page.getByText('That invite is no longer valid.')).toBeVisible();
  }
});

// ------------------------------------------------------------------ family dates (test/faf-mock/, made up, relative to today)
/** Tick or untick one kind of family date, and wait for the screen to be drawn again. */
async function tick(page, type) {
  const box = page.locator(`input[type=checkbox][data-type=${type}]`);
  const was = await box.isChecked();
  await box.click();
  await expect(page.locator(`input[type=checkbox][data-type=${type}]`)).toBeChecked({ checked: !was });
}
const names = (page) => page.locator('.upcoming .fam b').allTextContents();

test('family dates: on the week as all-day items, apart from schedules, linking to friends-and-family', async ({ page }) => {
  await signIn(page, 'fam', 'Fam');
  const today = page.locator('.day.today');
  const ari = today.locator('a.fam', { hasText: 'Ari Prófason' });
  await expect(ari).toBeVisible();
  await expect(ari).toContainText('turns 40');
  await expect(ari).toHaveAttribute('href', 'https://icelander.net/apps/friends-and-family/person/p-ari');
  await expect(today.locator('.allday .fam-birthday')).toHaveCount(1);
  await expect(page.locator('.day .occ')).toHaveCount(0);   // a date is not a schedule
  // Birthdays only, by default.
  await expect(page.locator('input[data-type=birthday]')).toBeChecked();
  for (const t of ['anniversary', 'death', 'event', 'pet']) await expect(page.locator(`input[data-type=${t}]`)).not.toBeChecked();
  await expect(page.locator('.notice')).toHaveCount(0);
  await drawsProperly(page);
});

test('upcoming: the ranges, the type and circle filters, and the range remembered', async ({ page, browser }) => {
  await signIn(page, 'up', 'Up');
  await page.getByRole('link', { name: 'Upcoming' }).click();
  await expect(page.getByRole('button', { name: '3 months' })).toHaveAttribute('aria-pressed', 'true');   // the default
  await expect(page.getByRole('link', { name: 'Import contacts' })).toHaveAttribute('href', '/apps/friends-and-family/import');

  // Birthdays only: Ari (today) and Dísa (in 20 days, year unknown, so no age).
  await expect.poll(() => names(page)).toEqual(['Ari Prófason', 'Dísa Vinkona']);
  await expect(page.locator('.fam', { hasText: 'Dísa Vinkona' })).not.toContainText('turns');

  // Every kind: the anniversary (10 days), the pet (3 days) and the death date (45 days) join in.
  for (const t of ['anniversary', 'death', 'event', 'pet']) await tick(page, t);
  await expect.poll(() => names(page)).toEqual(['Ari Prófason', 'Snati', 'Bára Dæmadóttir', 'Dísa Vinkona', 'Gamli Jón']);
  await expect(page.locator('.fam', { hasText: 'Bára Dæmadóttir' })).toContainText('12 years');
  await expect(page.locator('.fam', { hasText: 'Gamli Jón' })).toContainText('30 years ago');

  // The ranges: a month leaves out the death date; a year adds Kári's event (200 days); all time Lóa's (500 days).
  await page.getByRole('button', { name: '1 month' }).click();
  await expect.poll(() => names(page)).toEqual(['Ari Prófason', 'Snati', 'Bára Dæmadóttir', 'Dísa Vinkona']);
  await page.getByRole('button', { name: '1 year' }).click();
  await expect.poll(() => names(page)).toEqual(['Ari Prófason', 'Snati', 'Bára Dæmadóttir', 'Dísa Vinkona', 'Gamli Jón', 'Kári Kollegi']);
  await page.getByRole('button', { name: 'All time' }).click();
  await expect.poll(() => (names(page))).toHaveLength(7);
  await expect(page.locator('.fam', { hasText: 'Lóa Langtburt' })).toBeVisible();

  // Circles: Friends only, then Friends and Work, then all again.
  await page.locator('.chip[data-circle=Friends]').click();
  await expect.poll(() => names(page)).toEqual(['Dísa Vinkona', 'Lóa Langtburt']);
  await page.locator('.chip[data-circle=Work]').click();
  await expect.poll(() => names(page)).toEqual(['Dísa Vinkona', 'Kári Kollegi', 'Lóa Langtburt']);
  await expect(page.locator('.chip[data-circle]')).toHaveCount(3);   // Family, Friends, Work: never 'unset'
  await page.getByRole('button', { name: 'All circles' }).click();
  await expect.poll(() => names(page)).toHaveLength(7);

  // Unticking a kind hides it.
  await tick(page, 'birthday');
  await expect(page.locator('.upcoming .fam-birthday')).toHaveCount(0);
  await drawsProperly(page);

  // The range (and the boxes) are the person's: kept on reload, and in another browser of theirs.
  await page.reload();
  await expect(page.getByRole('button', { name: 'All time' })).toHaveAttribute('aria-pressed', 'true');
  const other = await browser.newContext();
  const again = await other.newPage();
  await signIn(again, 'up', 'Up');
  await again.getByRole('link', { name: 'Upcoming' }).click();
  await expect(again.getByRole('button', { name: 'All time' })).toHaveAttribute('aria-pressed', 'true');
  await expect(again.locator('input[data-type=birthday]')).not.toBeChecked();
  await other.close();
});

test('upcoming: schedules too, when asked, for a month or three', async ({ page }) => {
  await signIn(page, 'withsched', 'Sched');
  await page.getByRole('link', { name: 'Schedules' }).click();
  await page.getByPlaceholder('Title').fill('Swimming');
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await page.getByRole('button', { name: 'Add a time' }).click();
  await page.locator('.card').nth(1).locator('input[type=time]').nth(0).fill('17:00');
  await page.locator('.card').nth(1).locator('input[type=time]').nth(1).fill('18:00');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();

  await page.getByRole('link', { name: 'Upcoming' }).click();
  await expect(page.locator('.upcoming .occ')).toHaveCount(0);
  await page.getByLabel('Show schedules too').check();
  // Every Monday in the next three months (asked for in two pieces: the agenda answers 62 days at a time).
  await expect.poll(() => page.locator('.upcoming .occ').count()).toBeGreaterThanOrEqual(12);
  await expect(page.locator('.upcoming .occ').first()).toContainText('Swimming');
  await page.getByRole('button', { name: '1 year' }).click();
  await expect(page.locator('.upcoming .occ')).toHaveCount(0);
  await expect(page.getByText('Schedules show for 1 or 3 months only')).toBeVisible();
  await drawsProperly(page);
});

test('friends-and-family down: the calendar still works, with a small notice', async ({ page }) => {
  await signIn(page, 'faf-down', 'Fafless');   // the stand-in throws for this viewer
  await expect(page.locator('.day')).toHaveCount(7);
  await expect(page.locator('.notice')).toHaveText("Family dates can't be shown right now. The calendar still works.");
  await expect(page.locator('.fam')).toHaveCount(0);
  await page.getByRole('link', { name: 'Upcoming' }).click();
  await expect(page.locator('.notice')).toBeVisible();
  await expect(page.getByText('Nothing coming up in this range.')).toBeVisible();
  await page.getByRole('link', { name: 'Schedules' }).click();
  await expect(page.getByText('No schedules yet.')).toBeVisible();
  await drawsProperly(page);
});
