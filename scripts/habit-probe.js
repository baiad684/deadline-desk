const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const projectDir = path.resolve(__dirname, '..');
const dataDir = path.join(projectDir, 'test-output', 'habit-data');
const outputDir = path.join(projectDir, 'test-output');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function localDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86400000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function launchApp() {
  return electron.launch({
    args: ['.'],
    cwd: projectDir,
    env: { ...process.env, DEADLINE_DESK_DATA_DIR: dataDir }
  });
}

async function stopApp(electronApp) {
  await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await electronApp.close().catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 1200));
}

// 读取统计页某日的日历格子 class（title 以「M月D日」开头定位，日号无前导零）
function dayCellClass(page, offsetDays) {
  const value = localDate(offsetDays);
  const [, month, day] = value.split('-').map(Number);
  return page.locator(`#habitCalendarGrid [title^="${month}月${day}日"]`).first().getAttribute('class');
}

// 离线预置历史数据：4 天前（UTC 12:00 → 本地 20:00，避开 UTC 16:00 后本地日 +1）创建的任务 + 前 4/3/2 天打卡
async function seedHistory(dataDir) {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: file => path.join(projectDir, 'node_modules', 'sql.js', 'dist', file) });
  const dbPath = path.join(dataDir, 'deadline-desk.db');
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const utcStamp = offsetDays => {
    const date = new Date(Date.now() + offsetDays * 86400000);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')} 12:00:00`;
  };
  db.run('INSERT INTO habit_tasks (title, note, created_at, updated_at) VALUES (?, ?, ?, ?)', ['预置历史任务', '', utcStamp(-4), utcStamp(-4)]);
  const taskId = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
  for (const offset of [-4, -3, -2]) {
    const date = new Date(Date.now() + offset * 86400000);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    db.run('INSERT INTO habit_checkins (task_id, checkin_date, created_at) VALUES (?, ?, ?)', [taskId, value, utcStamp(offset)]);
  }
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

(async () => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const pageErrors = [];
  let electronApp = await launchApp();
  try {
    const page = await electronApp.firstWindow();
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.waitForLoadState('domcontentloaded');

    // 1. 导航与空态
    await page.locator('[data-page="activities"]').waitFor();
    await page.locator('[data-page="today"]').click();
    assert(await page.locator('#habitCardPanel').evaluate(el => el.classList.contains('hidden')), '无任务时今日打卡卡片应隐藏');
    await page.locator('.nav-item[data-nav="workspace"]').click(); await page.locator('.ws-tab[data-page="activities"]').click();
    await page.getByText('还没有日常任务').waitFor();

    // 2. 新建两个任务
    await page.locator('#newHabitButton').click();
    await page.locator('#habitTitle').fill('背 20 个单词');
    await page.locator('#habitNote').fill('睡前完成');
    await page.locator('#habitForm button[type="submit"]').click();
    await page.locator('.habit-row').first().waitFor();
    await page.locator('#newHabitButton').click();
    await page.locator('#habitTitle').fill('锻炼 30 分钟');
    await page.locator('#habitForm button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.habit-row').length === 2);
    assert(await page.locator('#habitProgressLabel').textContent() === '0 / 2', '初始进度应为 0 / 2');
    assert(await page.locator('#habitCount').textContent() === '2', '导航未打卡计数应为 2');

    // 3. 任务一打卡（连续/累计/点阵）
    await page.locator('.habit-row').first().locator('[data-habit-toggle]').click();
    await page.waitForFunction(() => document.querySelector('.habit-row')?.classList.contains('checked'));
    assert(await page.locator('.habit-row').first().locator('.badge.progress').textContent() === '连续 1 天', '连续天数徽标错误');
    assert(await page.locator('.habit-row').first().locator('.habit-total').textContent() === '累计 1 天', '累计天数错误');
    assert(await page.locator('.habit-row').first().locator('.habit-dot.done').count() === 1, '打卡点阵应点亮 1 个');
    assert(await page.locator('#habitProgressLabel').textContent() === '1 / 2', '进度应为 1 / 2');

    // 4. 今天页打卡卡片
    await page.locator('[data-page="today"]').click();
    await page.locator('#habitCardPanel:not(.hidden)').waitFor();
    assert(await page.locator('#habitCardCaption').textContent() === '已打卡 1 / 2', '卡片计数错误');
    assert(await page.locator('.habit-card-row').count() === 1, '应有 1 行待打卡');
    await page.locator('.habit-card-row').click();
    await page.locator('.habit-card-alldone').waitFor();
    assert(await page.locator('#habitCardCaption').textContent() === '已打卡 2 / 2', '全部完成后计数错误');

    // 5. 补卡：任务一补昨天
    await page.locator('.nav-item[data-nav="workspace"]').click(); await page.locator('.ws-tab[data-page="activities"]').click();
    const yesterday = localDate(-1);
    await page.locator('.habit-row').first().locator(`.habit-dot[data-date="${yesterday}"]`).click();
    await page.waitForFunction(() => document.querySelector('.habit-row .habit-total')?.textContent === '累计 2 天');
    assert(await page.locator('.habit-row').first().locator('.badge.progress').textContent() === '连续 2 天', '补卡后连续应为 2 天');

    // 6. 取消今天打卡（开关可反悔，昨天仍在签）
    await page.locator('.habit-row').first().locator('[data-habit-toggle]').click();
    await page.waitForFunction(() => !document.querySelector('.habit-row')?.classList.contains('checked'));
    assert(await page.locator('.habit-row').first().locator('.habit-total').textContent() === '累计 1 天', '取消后应只剩昨天');
    assert(await page.locator('.habit-row').first().locator('.badge.progress').textContent() === '连续 1 天', '昨天未断签应仍计连续');

    // 7. 归档与恢复
    await page.locator('.habit-row').nth(1).locator('[data-habit-archive]').click();
    await page.waitForFunction(() => document.querySelectorAll('.habit-row').length === 1);
    assert(await page.locator('#habitArchivedToggle').textContent() === '已归档（1）', '归档计数错误');
    await page.locator('#habitArchivedToggle').click();
    await page.locator('#habitArchivedList:not(.hidden)').waitFor();
    assert((await page.locator('#habitArchivedList').textContent()).includes('锻炼 30 分钟'), '归档列表缺少任务');
    await page.locator('[data-habit-restore]').click();
    await page.waitForFunction(() => document.querySelectorAll('.habit-row').length === 2);

    // 8. 小组件：双视图切换 + 打卡同步 + 高度约束 + tab 记忆
    await page.locator('[data-page="settings"]').click();
    await page.locator('#widgetToggle').check();
    let widgetPage = null;
    for (let attempt = 0; attempt < 40 && !widgetPage; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      widgetPage = electronApp.windows().find(entry => entry !== page && entry.url().includes('widget.html')) || null;
    }
    assert(widgetPage, '小组件窗口未打开');
    await widgetPage.waitForLoadState('domcontentloaded');
    await widgetPage.locator('#tabDeadlines[aria-selected="true"]').waitFor();
    assert(await widgetPage.locator('#tabDeadlinesBadge').textContent() === '0', '无截止事项时角标应为 0');
    // 显式切到打卡 tab 再断言（不依赖启动默认态）
    await widgetPage.locator('#tabHabits').click();
    await widgetPage.locator('.widget-habit-row').first().waitFor();
    assert(await widgetPage.locator('#tabHabitsBadge').textContent() === '1/2', '小组件打卡计数错误');
    assert(await widgetPage.locator('.widget-habit-row').count() === 2, '小组件应展示全部任务');
    assert(await widgetPage.locator('.widget-habit-row:not(.done)').count() === 1, '应有 1 行待打卡');
    const pendingRow = widgetPage.locator('.widget-habit-row:not(.done)');
    assert(await pendingRow.locator('b').textContent() === '背 20 个单词', '小组件待打卡行错误');
    assert(await pendingRow.locator('em').textContent() === '连 1 天', '连击徽标错误');
    assert(await widgetPage.locator('.widget-habit-row.done').locator('b').textContent() === '锻炼 30 分钟', '已完成行应沉底弱化');
    await pendingRow.click();
    await widgetPage.waitForFunction(() => document.querySelector('#tabHabitsBadge')?.textContent === '2/2', null, { timeout: 8000 });
    assert(await widgetPage.locator('.widget-habit-row.done').count() === 2, '小组件打卡后未同步');
    // 打卡是开关式：再点一次取消，恢复待打卡
    await widgetPage.locator('.widget-habit-row.done').last().click();
    await widgetPage.waitForFunction(() => document.querySelector('#tabHabitsBadge')?.textContent === '1/2', null, { timeout: 8000 });
    const shellHeight = await widgetPage.evaluate(() => document.querySelector('.widget-shell').offsetHeight + 32);
    assert(shellHeight <= 300, `小组件高度 ${shellHeight}px 超过 300px 上限`);
    // 关闭再打开：tab 记忆应恢复到打卡 tab（开关的 input 是零尺寸的，点击外层 label 才能切换）
    await page.locator('label.switch:has(#widgetToggle)').click();
    // 轮询等旧窗口真正消失，避免关闭未完成时 createWidgetWindow 只 show 旧窗、握到死引用
    for (let attempt = 0; attempt < 40; attempt++) {
      if (!electronApp.windows().some(entry => entry !== page && entry.url().includes('widget.html'))) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await page.locator('label.switch:has(#widgetToggle)').click();
    widgetPage = null;
    for (let attempt = 0; attempt < 40 && !widgetPage; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      widgetPage = electronApp.windows().find(entry => entry !== page && !entry.isClosed() && entry.url().includes('widget.html')) || null;
    }
    assert(widgetPage, '重新打开后未找到小组件窗口');
    await widgetPage.waitForLoadState('domcontentloaded');
    await widgetPage.locator('#tabHabits[aria-selected="true"]').waitFor();

    // 8.5 统计页月度打卡日历：当前 task1={昨天(创建前补卡),今天}、task2={} → 今天 1/2
    await page.locator('[data-page="stats"]').click();
    await page.waitForFunction(() => document.querySelector('#habitCalendarGrid')?.children.length > 0, null, { timeout: 8000 });
    const monthRateText = await page.locator('#habitMonthRate').textContent();
    assert(monthRateText === '50%', `月打卡率应为 50%，实际 ${monthRateText}`);
    assert(await page.locator('#habitMonthMeta').textContent() === '已打卡 1 次 / 应打卡 2 次', '月率明细应为「已打卡 1 次 / 应打卡 2 次」');
    const todayCellClass = await page.locator('#habitCalendarGrid .habit-day.today').getAttribute('class');
    assert(todayCellClass.includes('level-1'), `今天格子应为 level-1（部分完成 1/2），实际 ${todayCellClass}`);
    assert(await page.locator('.habit-calendar-legend .legend-sw').count() === 2, '图例应只标两种填色状态（未打卡与无任务都不上色）');
    // 创建前补卡口径：昨天格子中性（但有补卡留痕）+ 提示文案，不影响月率
    const yesterdayValue = localDate(-1);
    const [, yMonth, yDay] = yesterdayValue.split('-').map(Number);
    const yesterdayCell = page.locator('#habitCalendarGrid [title*="任务当天尚未创建"]');
    await yesterdayCell.waitFor();
    assert((await yesterdayCell.getAttribute('title')).startsWith(`${yMonth}月${yDay}日`), '补卡提示应指向昨天');
    const neutralClass = await yesterdayCell.getAttribute('class');
    assert(!neutralClass.includes('level-'), `昨天格子应为中性（创建前补卡不计入），实际 ${neutralClass}`);
    // 取消今天打卡 → level-0 / 0%；恢复 → 50%
    await page.locator('.nav-item[data-nav="workspace"]').click(); await page.locator('.ws-tab[data-page="activities"]').click();
    await page.locator('.habit-row').first().locator('[data-habit-toggle]').click();
    await page.locator('[data-page="stats"]').click();
    await page.waitForFunction(() => document.querySelector('#habitMonthRate')?.textContent === '0%', null, { timeout: 8000 });
    const cancelledClass = await page.locator('#habitCalendarGrid .habit-day.today').getAttribute('class');
    assert(cancelledClass.includes('level-0'), `取消后今天格子应为 level-0，实际 ${cancelledClass}`);
    await page.locator('.nav-item[data-nav="workspace"]').click(); await page.locator('.ws-tab[data-page="activities"]').click();
    await page.locator('.habit-row').first().locator('[data-habit-toggle]').click();
    await page.locator('[data-page="stats"]').click();
    await page.waitForFunction(() => document.querySelector('#habitMonthRate')?.textContent === '50%', null, { timeout: 8000 });

    // 9. 删除（连同打卡记录）
    await page.locator('.nav-item[data-nav="workspace"]').click(); await page.locator('.ws-tab[data-page="activities"]').click();
    await page.locator('.habit-row').nth(1).locator('[data-habit-delete]').click();
    await page.locator('#confirmModal.open').waitFor();
    await page.locator('#confirmAccept').click();
    await page.waitForFunction(() => document.querySelectorAll('.habit-row').length === 1);

    await page.screenshot({ path: path.join(outputDir, 'habit-main.png'), fullPage: true });
    await widgetPage.screenshot({ path: path.join(outputDir, 'habit-widget.png') });
    assert(pageErrors.length === 0, `渲染进程错误：${pageErrors.join('; ')}`);
  } finally {
    await stopApp(electronApp);
  }

  // 10. 重启后持久化
  electronApp = await launchApp();
  try {
    const page = await electronApp.firstWindow();
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.nav-item[data-nav="workspace"]').click(); await page.locator('.ws-tab[data-page="activities"]').click();
    await page.locator('.habit-row').first().waitFor();
    assert(await page.locator('.habit-row').count() === 1, '重启后应剩 1 个任务');
    assert(await page.locator('.habit-row.checked').count() === 1, '小组件端的打卡状态应持久化');
    assert(await page.locator('.habit-total').textContent() === '累计 2 天', '累计打卡应持久化');
    assert(pageErrors.length === 0, `重启后渲染进程错误：${pageErrors.join('; ')}`);
  } finally {
    await stopApp(electronApp);
  }

  // 11. 预置历史数据：离线写入 4 天前创建的任务 + 前 4/3/2 天打卡，验证真实历史格、月率聚合与边界月
  await seedHistory(dataDir);
  electronApp = await launchApp();
  try {
    const page = await electronApp.firstWindow();
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.waitForLoadState('domcontentloaded');
    await page.locator('[data-page="stats"]').click();
    await page.waitForFunction(() => document.querySelector('#habitCalendarGrid')?.children.length > 0, null, { timeout: 8000 });
    // 月率 = Σchecked / Σexpected = 4 / 6（seeded 3 天 + 今天 task1；expected：seeded 4 天 + 昨天 + 今天 2 任务）→ 67%
    const seededRate = await page.locator('#habitMonthRate').textContent();
    assert(seededRate === '67%', `预置后月率应为 67%（4/6），实际 ${seededRate}`);
    for (const offset of [-4, -3, -2]) {
      const cellClass = await dayCellClass(page, offset);
      assert(cellClass.includes('level-2'), `${offset} 天格子应为 level-2（全部完成），实际 ${cellClass}`);
    }
    // 昨天：seeded 任务应打卡未打卡 → level-0（漏卡日）；今天：task1 打卡 task2 未打 → 1/2 → level-1（部分完成）
    const seededYesterday = await dayCellClass(page, -1);
    assert(seededYesterday.includes('level-0'), `昨天格子应为 level-0（漏卡日），实际 ${seededYesterday}`);
    const seededToday = await dayCellClass(page, 0);
    assert(seededToday.includes('level-1'), `今天格子应为 level-1（部分完成 1/2），实际 ${seededToday}`);
    assert(await page.locator('#habitCalendarGrid [title*="已打卡 1 / 1"]').count() >= 3, '历史格 tooltip 应含打卡数');
    // 三档 tooltip 都要写明档位，口径可解释
    assert(await page.locator('#habitCalendarGrid [title*="全部完成"]').count() >= 3, '全勤格 tooltip 应含「全部完成」');
    assert(await page.locator('#habitCalendarGrid [title*="部分完成"]').count() >= 1, '部分完成格 tooltip 应含「部分完成」');
    assert(await page.locator('#habitCalendarGrid [title*="未打卡"]').count() >= 1, '漏卡格 tooltip 应含「未打卡」');
    const seededMeta = await page.locator('#habitMonthMeta').textContent();
    assert(seededMeta === '已打卡 4 次 / 应打卡 6 次', `明细应为「已打卡 4 次 / 应打卡 6 次」，实际 ${seededMeta}`);
    // 边界月 API（无月导航 UI，断言面为 IPC 返回结构；month 为 1-12）
    const january = await page.evaluate(() => window.deadlineDesk.habits.calendar(2026, 1));
    assert(january.days.length === 31, `2026-01 应聚合 31 天，实际 ${january.days.length}`);
    const february = await page.evaluate(() => window.deadlineDesk.habits.calendar(2026, 2));
    assert(february.days.length === 28, `2026-02 应聚合 28 天，实际 ${february.days.length}`);
    const futureMonth = await page.evaluate(() => window.deadlineDesk.habits.calendar(2027, 1));
    assert(futureMonth.days.length === 0 && futureMonth.monthRate === null, '未来月份应无聚合日且月率为 null');
    // 口径自检：三档天数之和 = 有应打卡任务的天数；Σ已打卡 ≤ Σ应打卡；月率由两者算出
    const current = await page.evaluate(() => window.deadlineDesk.habits.calendar());
    const { summary } = current;
    assert(summary.fullDays + summary.partialDays + summary.missedDays === summary.activeDays, `三档天数之和应等于有任务天数，实际 ${JSON.stringify(summary)}`);
    assert(current.monthExpected === 6 && current.monthChecked === 4, `本月应为应打卡 6 / 已打卡 4，实际 ${current.monthExpected} / ${current.monthChecked}`);
    assert(current.monthRate === 67, `67/100 取整后的月率为 67，实际 ${current.monthRate}`);
    assert(pageErrors.length === 0, `预置段渲染进程错误：${pageErrors.join('; ')}`);
  } finally {
    await stopApp(electronApp);
  }

  console.log(JSON.stringify({
    passed: true,
    checks: [
      '侧边栏入口与空态',
      '新建日常任务',
      '打卡开关与连续/累计统计',
      '今天页打卡卡片与全完成态',
      '最近 7 天补卡',
      '取消打卡',
      '归档与恢复',
      '小组件双视图切换与打卡同步',
      '小组件高度约束',
      '小组件 tab 记忆',
      '统计页月度打卡日历（三档色阶/月率/创建前补卡口径）',
      '统计页月率口径自检（三档天数与分子分母）',
      '统计页月历预置历史与边界月聚合',
      '删除任务及记录',
      '重启后持久化',
      '渲染进程无异常'
    ]
  }, null, 2));
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
