// Optional real-browser gate. Use only a disposable LOCAL account/database.
// PLAYWRIGHT_MODULE=/tmp/sh-audit-browser/node_modules/playwright \
// AUDIT_STORAGE_STATE=/tmp/sh-audit-browser/state.json node scripts/audit-browser-smoke.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.AUDIT_APP_URL || 'http://127.0.0.1:5681';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local app only');
assert.ok(process.env.AUDIT_STORAGE_STATE, 'Provide disposable local account storage state');
const output = process.env.AUDIT_OUTPUT || '/tmp/sh-audit-browser/smoke-results.json';
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const checks = [];
  const check = (name, condition) => { assert.ok(condition, name); checks.push({ name, passed: true }); fs.writeFileSync(output, JSON.stringify(checks, null, 2)); };
  try {
    const context = await browser.newContext({ storageState: process.env.AUDIT_STORAGE_STATE, viewport: { width: 320, height: 740 } });
    await context.route('**/*', route => {
      const req = route.request();
      if (!['localhost', '127.0.0.1'].includes(new URL(req.url()).hostname) && !['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const routes = ['/', '/scripts', '/boundaries', '/tracker', '/learn', '/support', '/settings', '/safety-wallet', '/crisis-mode', '/finder', '/book-coaching', '/rehearsal-history', '/family-outcomes', '/treatment-action-plan', '/homecoming-week', '/family-visitation-plan', '/diy-intervention-planner', '/enabling-costs', '/letter', '/trajectory', '/community'];
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const path of routes) {
        await page.goto(base + path);
        await page.waitForTimeout(1000);
        await page.waitForFunction(() => document.body.innerText.trim().length > 10 && !document.body.innerText.includes('Signing you in…') && !document.body.innerText.includes("We couldn't load your account"));
        check(`${width}px deep link ${path}`, new URL(page.url()).pathname === path);
        const text = await page.locator('body').innerText();
        check(`${width}px renders ${path}`, text.trim().length > 10 && !text.includes('Something went wrong on our side.'));
        const overflow = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) > innerWidth);
        check(`${width}px page bounds ${path}`, !overflow);
        if (path === '/') {
          const labels = await page.locator('[role=tab]').evaluateAll(tabs => tabs.map(tab => [...tab.querySelectorAll('*')].filter(el => !el.childElementCount && el.textContent).at(-1)).map(el => el.getBoundingClientRect().height));
          check(`${width}px tab labels not clipped`, labels.length === 6 && labels.every(height => height >= 14));
        }
        if (path === '/enabling-costs') {
          const fit = await page.locator('input').evaluateAll(inputs => inputs.length > 0 && inputs.every(input => input.getBoundingClientRect().right <= input.parentElement.getBoundingClientRect().right));
          check(`${width}px currency fields fit`, fit);
        }
      }
    }
    await page.goto(base + '/safety-wallet');
    await page.getByPlaceholder('First name', { exact: true }).fill('Local audit loved one');
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForTimeout(1000);
    check('wallet persists explicit edits through reload', await page.getByPlaceholder('First name', { exact: true }).inputValue() === 'Local audit loved one');
    await page.goto(base + '/');
    await page.waitForTimeout(1000);
    await page.getByRole('radio', { name: 'Mood 4 out of 5', exact: true }).waitFor();
    {
      await page.getByRole('radio', { name: 'Mood 4 out of 5', exact: true }).click();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      check('check-in retains mood on Back', await page.getByRole('radio', { name: 'Mood 4 out of 5', exact: true }).getAttribute('aria-checked') === 'true');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('radio', { name: 'Capacity 4', exact: true }).click();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('radio', { name: 'Pressure 2', exact: true }).click();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('radio', { name: "I'm steady for now", exact: true }).click();
      await page.getByRole('button', { name: 'Complete check-in', exact: true }).click();
      await page.waitForTimeout(1200);
      check('check-in form closes after local database save', await page.getByRole('button', { name: 'Complete check-in', exact: true }).count() === 0);
    }
    check('no uncaught browser exceptions', errors.length === 0);
    console.log(JSON.stringify({ passed: checks.length, errors, output }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
