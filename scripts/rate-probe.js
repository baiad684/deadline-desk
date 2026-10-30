// 本月打卡率取整与边界探针：用极端数据验证 0% / 1% / 99% / 100% / 「—」五种读数
// 用法：node scripts/rate-probe.js
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const projectDir = path.resolve(__dirname, '..');
const baseDir = path.join(projectDir, 'test-output', 'rate-probe');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function localDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86400000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// created_at 是 UTC 串；写 UTC 04:00，本地东八区即当天 12:00，不会跨日
function utcStamp(offsetDays) {
  const date = new Date(Date.now() + offsetDays * 86400000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')} 04:00:00`;
}

async function launch(dataDir) {
  return electron.launch({
    args: ['.'],
    cwd: projectDir,
    env: { ...process.env, DEADLINE_DESK_DATA_DIR: dataDir }
  });
}

async function stop(app) {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close().catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 900));
}

// 先跑一次空应用建库，再离线写数据
async function withData(name, build) {
  const dataDir = path.join(baseDir, name);
  fs.rmSync(dataDir, { recursive: true, force: true });
  let app = await launch(dataDir);
  await (await app.firstWindow()).waitForLoadState('domcontentloaded');
  await stop(app);

  if (build) {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs({ locateFile: file => path.join(projectDir, 'node_modules', 'sql.js', 'dist', file) });
    const dbPath = path.join(dataDir, 'deadline-desk.db');
    const db = new SQL.Database(fs.readFileSync(dbPath));
    build(db);
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
  }

  app = await launch(dataDir);
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  await page.locator('[data-page="stats"]').click();
  await page.waitForFunction(() => document.querySelector('#habitCalendarGrid')?.children.length > 0, null, { timeout: 8000 });
  const view = await page.evaluate(async () => ({
    data: await window.deadlineDesk.habits.calendar(),
    rate: document.querySelector('#habitMonthRate').textContent,
    meta: document.querySelector('#habitMonthMeta').textContent,
    range: document.querySelector('#habitRateRange').textContent,
    fill: document.querySelector('#habitMonthFill').style.width,
    empty: document.querySelector('#habitMonthRate').classList.contains('is-empty')
  }));
  await stop(app);
  assert(pageErrors.length === 0, `${name} 渲染进程报错：${pageErrors.join('; ')}`);
  return view;
}

const insertTask = (db, title, createdOffset) => {
  db.run('INSERT INTO habit_tasks (title, note, created_at, updated_at) VALUES (?, ?, ?, ?)', [title, '', utcStamp(createdOffset), utcStamp(createdOffset)]);
  return db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
};

(async () => {
  const results = [];
  const step = message => console.log(`· ${message}`);
  const today = new Date();
  const dayOfMonth = today.getDate();
  const monthDays = dayOfMonth; // 本月聚合天数 = 1 号到今天

  step('A 极低打卡比例 → 1%');
  // A. 10 个任务 / 只有 1 次打卡 → 1/300 = 0.33%，应钳制为 1% 而不是 0%
  {
    const view = await withData('clamp-min', db => {
      const ids = [];
      for (let index = 0; index < 10; index += 1) ids.push(insertTask(db, `任务 ${index + 1}`, -40));
      db.run('INSERT INTO habit_checkins (task_id, checkin_date) VALUES (?, ?)', [ids[0], localDate(-(dayOfMonth - 1))]);
    });
    assert(view.data.monthExpected === 10 * monthDays && view.data.monthChecked === 1, `A 期望 1/${10 * monthDays}，实际 ${view.data.monthChecked}/${view.data.monthExpected}`);
    assert(view.data.monthRate === 1, `A 月率应为 1（钳制），实际 ${view.data.monthRate}`);
    assert(view.rate === '1%', `A 界面应显示 1%，实际 ${view.rate}`);
    results.push(`A 有打卡但比例极低：${view.data.monthChecked}/${view.data.monthExpected} → ${view.rate}（钳制，不显示 0%）`);
  }

  step('B 差一格全勤 → 99%');
  // B. 7 个任务 / 只差最后一次打卡 → 209/210 = 99.5%，应钳制为 99% 而不是 100%
  {
    const view = await withData('clamp-max', db => {
      const ids = [];
      for (let index = 0; index < 7; index += 1) ids.push(insertTask(db, `任务 ${index + 1}`, -40));
      for (let offset = -(dayOfMonth - 1); offset <= 0; offset += 1) {
        for (const id of ids) db.run('INSERT INTO habit_checkins (task_id, checkin_date) VALUES (?, ?)', [id, localDate(offset)]);
      }
      db.run('DELETE FROM habit_checkins WHERE task_id = ? AND checkin_date = ?', [ids[0], localDate(0)]);
    });
    assert(view.data.monthExpected === 7 * monthDays && view.data.monthChecked === 7 * monthDays - 1, `B 期望 ${7 * monthDays - 1}/${7 * monthDays}，实际 ${view.data.monthChecked}/${view.data.monthExpected}`);
    assert(view.data.monthRate === 99, `B 月率应为 99（钳制），实际 ${view.data.monthRate}`);
    assert(view.rate === '99%', `B 界面应显示 99%，实际 ${view.rate}`);
    results.push(`B 差一格全勤：${view.data.monthChecked}/${view.data.monthExpected} → ${view.rate}（钳制，不显示 100%）`);
  }

  step('C 有任务没打卡 → 0%');
  // C. 今天才建任务、没打卡 → 0/1 = 0%，且三档只有「未打卡」
  {
    const view = await withData('zero', db => {
      insertTask(db, '刚建的任务', 0);
    });
    assert(view.data.monthExpected === 1 && view.data.monthChecked === 0, `C 期望 0/1，实际 ${view.data.monthChecked}/${view.data.monthExpected}`);
    assert(view.data.monthRate === 0 && view.rate === '0%', `C 月率应为 0%，实际 ${view.data.monthRate} / ${view.rate}`);
    assert(view.data.summary.missedDays === 1 && view.data.summary.fullDays === 0, `C 三档天数应为未打卡 1，实际 ${JSON.stringify(view.data.summary)}`);
    results.push(`C 有任务没打卡：0/1 → ${view.rate}（三档天数 ${JSON.stringify(view.data.summary)}）`);
  }

  step('D 没有任何任务 → —');
  // D. 没有任何任务 → null / 「—」/ 空态提示
  {
    const view = await withData('empty', null);
    assert(view.data.monthRate === null && view.data.monthExpected === 0, `D 无任务时月率应为 null，实际 ${view.data.monthRate}`);
    assert(view.rate === '—' && view.empty, `D 界面应显示「—」并带 is-empty，实际 ${view.rate}`);
    assert(view.meta === '本月还没有应打卡的日子', `D 空态提示不对：${view.meta}`);
    assert(view.range === '', `D 无数据时不显示统计区间，实际「${view.range}」`);
    results.push(`D 无任务：${view.rate}（${view.meta}）`);
  }

  step('E 建任务后天天打卡 → 100%');
  // E. 3 天前建任务 + 连打 4 天 → 4/4 = 100%，三档全是「全部完成」
  {
    const view = await withData('full', db => {
      const id = insertTask(db, '连打 4 天', -3);
      for (const offset of [-3, -2, -1, 0]) db.run('INSERT INTO habit_checkins (task_id, checkin_date) VALUES (?, ?)', [id, localDate(offset)]);
    });
    assert(view.data.monthExpected === 4 && view.data.monthChecked === 4, `E 期望 4/4，实际 ${view.data.monthChecked}/${view.data.monthExpected}`);
    assert(view.data.monthRate === 100 && view.rate === '100%', `E 月率应为 100%，实际 ${view.data.monthRate} / ${view.rate}`);
    assert(view.data.summary.fullDays === 4 && view.data.summary.activeDays === 4, `E 应 4 天全勤，实际 ${JSON.stringify(view.data.summary)}`);
    results.push(`E 建任务后天天打卡：4/4 → ${view.rate}（区间 ${view.range}）`);
  }

  step('F 归档当日不再计入应打卡');
  // F. 5 天前建任务、今天归档、且归档当天被写入一条打卡（UI 会拦，这里直接写库模拟脏数据）
  //    预期：归档当天既不算应打卡也不算已打卡，checked ≤ expected 恒成立
  {
    const archivedUtc = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const archivedLocal = new Date(archivedUtc.replace(' ', 'T') + 'Z');
    const archivedLocalDate = `${archivedLocal.getFullYear()}-${String(archivedLocal.getMonth() + 1).padStart(2, '0')}-${String(archivedLocal.getDate()).padStart(2, '0')}`;
    const view = await withData('archived', db => {
      const id = insertTask(db, '归档前建的任务', -5);
      db.run('UPDATE habit_tasks SET archived_at = ? WHERE id = ?', [archivedUtc, id]);
      db.run('INSERT INTO habit_checkins (task_id, checkin_date) VALUES (?, ?)', [id, archivedLocalDate]);
    });
    const todayValue = localDate(0);
    const expectedDays = view.data.days.filter(day => day.date >= localDate(-5) && day.date < archivedLocalDate && day.expected > 0).length;
    assert(view.data.monthExpected === expectedDays, `F 应打卡次数应只落在归档日之前（${expectedDays}），实际 ${view.data.monthExpected}`);
    assert(view.data.monthChecked === 0, `F 归档当天的打卡不应计入，实际 checked ${view.data.monthChecked}`);
    assert(!view.data.days.some(day => day.checked > day.expected), 'F 不应出现 checked > expected 的日子');
    const todayEntry = view.data.days.find(day => day.date === todayValue);
    assert(!todayEntry || todayEntry.expected === 0, `F 归档当天不应有应打卡数，实际 ${todayEntry && todayEntry.expected}`);
    results.push(`F 归档当天：应打卡 ${view.data.monthExpected} 次（不含归档日 ${archivedLocalDate}）、已打卡 ${view.data.monthChecked} 次 → ${view.rate}`);
  }

  console.log(JSON.stringify({ passed: true, results }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
