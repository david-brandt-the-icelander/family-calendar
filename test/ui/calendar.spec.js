// The client, in a real browser: every screen draws (no "[object HTMLDivElement]"), and the main flows
// work end to end. The API tests (test/itest.sh) never render a page, which is how a client that drew
// nothing but text once reached production.
import { test, expect } from '@playwright/test';

const run = Date.now().toString(36);
const signIn = (page, who, name) =>
  page.goto(`/calendar/auth/dev?email=${who}-${run}@x.test&name=${name}&return=/calendar/`);

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
  await page.goto('/calendar/');
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', /\/calendar\/auth\/sign-in/);
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
  await expect(page.locator('.occ')).toHaveCount(1);
  await drawsProperly(page);

  // Household: an invite link stays on screen once made.
  await page.getByRole('link', { name: 'Household' }).click();
  await drawsProperly(page);
  await expect(page.getByText('People in the household')).toBeVisible();
  await page.getByRole('button', { name: 'Invite someone' }).click();
  const link = page.locator('input[readonly]');
  await expect(link).toHaveValue(/\/calendar\/join\/[A-Za-z0-9_-]{16,}$/);
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
  await expect(page.locator('.chip')).toHaveCount(3);
  await expect(page.locator('.chip.on')).toHaveText('Everyone');
  await expect(page.locator('.chip.on')).not.toHaveCSS('background-color', 'rgb(223, 227, 232)');
});

test('phone width: nothing scrolls sideways', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await signIn(page, 'phone', 'Phone');
  for (const tab of ['Week', 'Schedules', 'Household']) {
    await page.getByRole('link', { name: tab }).click();
    await drawsProperly(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), tab).toBeLessThanOrEqual(375);
  }
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
