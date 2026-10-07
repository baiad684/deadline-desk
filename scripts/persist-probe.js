const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const projectDir = path.resolve(__dirname, '..');
const dataDir = path.join(projectDir, 'test-output', 'probe-data');

(async () => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  const electronApp = await electron.launch({
    args: ['.'],
    cwd: projectDir,
    env: { ...process.env, DEADLINE_DESK_DATA_DIR: dataDir }
  });
  const page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  const created = await page.evaluate(async () => window.deadlineDesk.items.create({
    kind: 'assignment', title: '探针事项', description: '', deadline: '2026-09-05', status: 'not_started', workType: 'personal'
  }));
  console.log('created:', JSON.stringify(created));

  await page.waitForTimeout(1500);
  const dbPath = path.join(dataDir, 'deadline-desk.db');
  const size = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  console.log('db on disk:', fs.existsSync(dbPath), 'size:', size);

  const SQL = await initSqlJs({ locateFile: file => path.join(projectDir, 'node_modules', 'sql.js', 'dist', file) });
  const db = new SQL.Database(fs.readFileSync(dbPath));
  console.log('items in disk db:', JSON.stringify(db.exec('SELECT id, title, deadline FROM items')));
  db.close();

  await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => {});
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
