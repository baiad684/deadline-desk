// 统计页「日常任务打卡」面板视觉探针：预置一个月混合打卡数据 → 截图 + 输出聚合结果
// 用法：node scripts/stats-visual-probe.js [输出前缀]
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const projectDir = path.resolve(__dirname, '..');
const dataDir = path.join(projectDir, 'test-output', 'stats-visual-data');
const outputDir = path.join(projectDir, 'test-output');
const prefix = process.argv[2] || 'stats-habit';

const localDate = offsetDays => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// created_at 是 UTC 串；用 UTC 4:00 写，避免本地日与 UTC 日错位
const utcStamp = offsetDays => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} 04:00:00`;
};

async function launch() {
  return electron.launch({
    args: ['.'],
    cwd: projectDir,
    env: { ...process.env, DEADLINE_DESK_DATA_DIR: dataDir }
  });
}

async function seed() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: file => path.join(projectDir, 'node_modules', 'sql.js', 'dist', file) });
  const dbPath = path.join(dataDir, 'deadline-desk.db');
  const db = new SQL.Database(fs.readFileSync(dbPath));
  db.run('DELETE FROM habit_checkins; DELETE FROM habit_tasks;');

  const tasks = [
    ['背 20 个单词', -45],
    ['跑步 3 公里', -45],
    ['读书 20 页', -9]
  ];
  const ids = {};
  for (const [title, offset] of tasks) {
    db.run('INSERT INTO habit_tasks (title, note, created_at, updated_at) VALUES (?, ?, ?, ?)', [title, '', utcStamp(offset), utcStamp(offset)]);
    ids[title] = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
  }

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  let checkins = 0;
  for (let day = 1; day <= now.getDate(); day += 1) {
    const dateValue = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (day % 7 === 0) continue;                       // 整天空缺 → 未打卡
    const targets = day % 3 === 0 ? ['背 20 个单词']
      : day % 5 === 0 ? ['背 20 个单词', '跑步 3 公里']
        : ['背 20 个单词', '跑步 3 公里', '读书 20 页'];
    for (const title of targets) {
      db.run('INSERT OR IGNORE INTO habit_checkins (task_id, checkin_date, created_at) VALUES (?, ?, ?)', [ids[title], dateValue, utcStamp(0)]);
      checkins += 1;
    }
  }
  // 创建日之前的补卡（读书任务创建 9 天前，补 12 天前）→ 应判为中性 stray
  db.run('INSERT OR IGNORE INTO habit_checkins (task_id, checkin_date, created_at) VALUES (?, ?, ?)', [ids['读书 20 页'], localDate(-12), utcStamp(0)]);

  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  console.log(`seeded: ${tasks.length} tasks / ${checkins} checkins / ${daysInMonth} days in month`);
}

(async () => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  let app = await launch();
  await (await app.firstWindow()).waitForLoadState('domcontentloaded');
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close().catch(() => {});
  await new Promise(r => setTimeout(r, 800));

  await seed();

  app = await launch();
  const page = await app.firstWindow();
  page.on('pageerror', error => console.log('PAGEERROR:', error.message));
  page.on('console', msg => { if (msg.type() === 'error') console.log('CONSOLE:', msg.text()); });
  await page.waitForLoadState('domcontentloaded');
  await page.locator('[data-page="stats"]').click();
  await page.waitForTimeout(900);

  const info = await page.evaluate(() => {
    const grid = document.querySelector('#habitCalendarGrid');
    const cells = [...grid.querySelectorAll('.habit-day')];
    const panel = document.querySelector('#habitCalendarGrid').closest('.stats-panel');
    return {
      rate: document.querySelector('#habitMonthRate')?.textContent,
      caption: document.querySelector('#habitStatsCaption')?.textContent,
      meta: document.querySelector('#habitMonthMeta')?.textContent ?? null,
      panelWidth: Math.round(panel.getBoundingClientRect().width),
      cellSize: Math.round(cells[7]?.getBoundingClientRect().width || 0),
      rows: Math.round(grid.getBoundingClientRect().height / (cells[7]?.getBoundingClientRect().height || 1)),
      tally: cells.reduce((acc, cell) => {
        const key = [...cell.classList].filter(c => c.startsWith('level-') || c === 'future' || c === 'other' || c === 'today').join('+') || 'none';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
      samples: cells.filter(c => c.classList.contains('level-2')).slice(0, 3).map(c => c.title)
    };
  });
  console.log(JSON.stringify(info, null, 2));

  const shot = async (name, width, height) => {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outputDir, `${prefix}-${name}.png`) });
    await page.locator('#habitCalendarGrid').locator('..').locator('..').screenshot({ path: path.join(outputDir, `${prefix}-${name}-panel.png`) }).catch(() => {});
  };
  await page.setViewportSize({ width: 1260, height: 860 });
  await shot('1260', 1260, 860);
  await shot('920', 920, 800);

  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close().catch(() => {});
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
