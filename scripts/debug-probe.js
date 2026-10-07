const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const projectDir = path.resolve(__dirname, '..');
const dataDir = path.join(projectDir, 'test-output', 'debug-data');

(async () => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  const electronApp = await electron.launch({ args: ['.'], cwd: projectDir, env: { ...process.env, DEADLINE_DESK_DATA_DIR: dataDir } });
  const page = await electronApp.firstWindow();
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  page.on('console', msg => { if (msg.type() === 'error') console.log('CONSOLE:', msg.text()); });
  await page.waitForLoadState('domcontentloaded');

  await page.locator('[data-page="assignments"]').click();
  await page.getByRole('button', { name: '新增大作业' }).first().click();
  const buttons = await page.getByRole('button', { name: '活动' }).all();
  console.log('buttons named 活动:', buttons.length);
  await page.getByRole('button', { name: '活动' }).last().click();
  await page.locator('#itemTitle').fill('校园摄影赛投稿');
  await page.locator('#itemDeadline').fill('2026-08-31');
  await page.locator('#saveItemButton').click();
  await page.waitForTimeout(800);

  const debug = await page.evaluate(() => ({
    modalOpen: document.querySelector('#itemModal').classList.contains('open'),
    activeNav: document.querySelector('.nav-item.active')?.dataset.page,
    activePage: document.querySelector('.page.active')?.dataset.pageView,
    activityCount: document.querySelector('#activityCount')?.textContent,
    activityListHTML: document.querySelector('#activityList')?.innerHTML.slice(0, 300),
    pages: [...document.querySelectorAll('.page')].map(p => ({ id: p.dataset.pageView, active: p.classList.contains('active') }))
  }));
  console.log(JSON.stringify(debug, null, 2));
  await page.screenshot({ path: path.join(projectDir, 'test-output', 'debug-save-activity.png') });
  await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await electronApp.close().catch(() => {});
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
