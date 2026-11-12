# QA Exploratory Checklist

> [!NOTE]
> Exploration is a throwaway Playwright script, not a CLI. Write it under `~/.konoha/tmp/qa/`, never into the project tree.
> This document specifies Konoha-specific invariants and token-efficient constraints.

## Exploration Script Shape

```js
const { chromium } = require('playwright');
const browser = await chromium.launch();
const context = await browser.newContext({ storageState: process.env.QA_STATE });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
page.on('requestfailed', (r) => console.log('REQFAIL', r.url(), r.failure()?.errorText));
await page.goto(url);
const scope = (await page.locator('#main').count()) ? page.locator('#main') : page.locator('body');
console.log(await scope.ariaSnapshot());
await browser.close();
```

## Konoha Exploration Invariants

1. **Pre-Flight Scoping**:
   - Only probe routes, form controls, and test IDs previously identified by Genin with explicit `file:line` source citations.
   - Never browse unverified arbitrary endpoints.

2. **Scoped Snapshot Protocol**:
   - Begin with `page.locator('#main').ariaSnapshot()` when the route has `#main`; otherwise fall back to `page.locator('body')`. Verify the container exists (`locator(sel).count()`) before snapshotting; a missing selector silently times out.
   - For state transitions (e.g. form submission, dialog opening), re-query the locator (`isVisible`, `textContent`, `waitFor`) instead of snapshotting again.
   - Never call `ariaSnapshot()` on the page root.

3. **Console & Network Error Triage**:
   - Collect `pageerror`, `console` (type `error`), and `requestfailed` listeners from the first navigation.
   - Log failed responses (`response.status() >= 400`) to identify unhandled backend API failures.

4. **Termination Criteria**:
   - Cease exploration within an area after 15 actions if no defect or regression is found.
   - Cap maximum captured output at 4,000 characters per interaction.
