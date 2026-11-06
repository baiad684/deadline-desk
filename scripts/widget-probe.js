const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const projectDir = path.resolve(__dirname, '..');
const dataDir = path.join(projectDir, 'test-output', 'widget-data');
const outputDir = path.join(projectDir, 'test-output');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function dateInDays(days) {
  const date = new Date(Date.now() + days * 86400000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T14:30`;
}

async function widgetBounds(electronApp) {
  return electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(entry => entry.getTitle() === '截止线小组件');
    return win ? win.getBounds() : null;
  });
}

async function waitStableWidgetBounds(electronApp) {
  // 连续两次采样一致才认为 widget:resize 的高度上报已落定
  let previous = null;
  let stable = 0;
  for (let i = 0; i < 20 && stable < 2; i++) {
    const current = await widgetBounds(electronApp);
    stable = previous && current
      && previous.x === current.x && previous.y === current.y
      && previous.width === current.width && previous.height === current.height
      ? stable + 1 : 0;
    previous = current;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!previous) return null;
  if (stable < 2) throw new Error('小组件窗口在 2 秒内未稳定，无法做 bounds 断言');
  return previous;
}

async function hideMainWindow(electronApp) {
  const hidden = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(entry => entry.getTitle() === '截止线');
    if (!win) return false;
    win.hide();
    return true;
  });
  assert(hidden, '未找到主窗口，无法验证隐藏入口');
}

async function mainWindowVisible(electronApp) {
  return electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(entry => entry.getTitle() === '截止线');
    return win ? win.isVisible() : false;
  });
}

async function assertWidgetJump(electronApp, widgetPage, mainPage, title, pageId) {
  await hideMainWindow(electronApp);
  await widgetPage.locator('#widgetRows .todo-row', { hasText: title }).click();
  await mainPage.waitForFunction(({ title, pageId }) => {
    const modal = document.querySelector('#itemDetailModal');
    return modal?.getAttribute('aria-hidden') === 'false'
      && document.querySelector('#detailTitle')?.textContent.trim() === title
      && document.querySelector(`.nav-item[data-page="${pageId}"]`)?.classList.contains('active');
  }, { title, pageId }, { timeout: 15000, polling: 100 });

  assert(await mainWindowVisible(electronApp), '跳转后主窗口未显示');
  assert(await mainPage.locator('#searchInput').inputValue() === '', '跳转后搜索未清空');
  assert(await mainPage.locator('#detailBackButton').evaluate(el => el.classList.contains('hidden')), '小组件来源应隐藏返回键');
  if (pageId === 'activities') {
    assert(await mainPage.locator('#activityFilters [data-filter="all"]').getAttribute('aria-pressed') === 'true', '活动筛选未重置为全部');
  }

  await mainPage.locator('#itemDetailModal .detail-close').click();
  await mainPage.waitForFunction(
    () => document.querySelector('#itemDetailModal')?.getAttribute('aria-hidden') === 'true',
    null, { timeout: 5000, polling: 100 }
  );
}

async function dragWidgetBy(widgetPage, dx, dy) {
  // 直接派发带屏幕坐标的合成 PointerEvent：CDP 鼠标事件的 screenX 由窗口当前位置换算，
  // 窗口移动时坐标会漂移；真鼠标拖动的抖动回归正是这个坐标系差异造成的
  await widgetPage.evaluate(async ({ dx, dy }) => {
    const handle = document.querySelector('.widget-heading');
    const fire = (type, x, y, target) => (target || document).dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, isPrimary: true,
      clientX: x, clientY: y, screenX: 500 + x, screenY: 500 + y
    }));
    fire('pointerdown', 10, 8, handle);
    fire('pointermove', 10 + dx, 8 + dy);
    await new Promise(resolve => requestAnimationFrame(resolve));
    fire('pointerup', 10 + dx, 8 + dy);
  }, { dx, dy });
  await new Promise(resolve => setTimeout(resolve, 200));
}

(async () => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const electronApp = await electron.launch({ args: ['.'], cwd: projectDir, env: { ...process.env, DEADLINE_DESK_DATA_DIR: dataDir } });
  const errors = [];
  try {
    // 主窗口 + 自动显示的小组件
    for (let i = 0; i < 2; i++) await electronApp.waitForEvent('window', { timeout: 15000 });
    await new Promise(resolve => setTimeout(resolve, 1200));

    const widgetPage = electronApp.windows().find(page => page.url().includes('widget.html'));
    assert(widgetPage, '小组件窗口未自动显示');
    widgetPage.on('pageerror', error => errors.push(`widget: ${error.message}`));
    // 等首帧渲染完成再断言，不依赖固定睡眠（慢机上 render 可能尚未执行）
    await widgetPage.waitForFunction(() => document.querySelector('#widgetRows .widget-empty, #widgetRows .todo-row') !== null, null, { timeout: 15000 });

    // 空数据：默认停在截止 tab，打卡角标隐藏
    const before = await widgetPage.evaluate(() => ({
      empty: Boolean(document.querySelector('#widgetRows .widget-empty')),
      rows: document.querySelectorAll('#widgetRows .todo-row').length,
      deadlinesSelected: document.querySelector('#tabDeadlines')?.getAttribute('aria-selected'),
      habitsSelected: document.querySelector('#tabHabits')?.getAttribute('aria-selected'),
      habitsBadgeHidden: document.querySelector('#tabHabitsBadge')?.hidden
    }));
    assert(before.empty && before.rows === 0, '空数据时未显示空状态');
    assert(before.deadlinesSelected === 'true' && before.habitsSelected === 'false', '默认应停在截止提醒 tab');
    assert(before.habitsBadgeHidden === true, '无任务时打卡角标应隐藏');
    await widgetPage.screenshot({ path: path.join(outputDir, 'widget-empty.png'), omitBackground: true });

    // 主窗口新增一个 3 天后截止的事项，小组件应实时收到推送
    const mainPage = electronApp.windows().find(page => page.url().includes('index.html'));
    mainPage.on('pageerror', error => errors.push(`main: ${error.message}`));
    await mainPage.waitForLoadState('domcontentloaded');
    await mainPage.getByRole('button', { name: '新增事项' }).click();
    await mainPage.locator('#itemTitle').fill('探针测试事项');
    const deadline = dateInDays(3);
    await mainPage.locator('#itemDeadlineDate').fill(deadline.slice(0, 10));
    await mainPage.locator('#itemDeadlineTime').fill(deadline.slice(11));
    await mainPage.locator('#saveItemButton').click();
    await mainPage.getByText('探针测试事项').first().waitFor();

    await widgetPage.waitForFunction(() => document.querySelectorAll('#widgetRows .todo-row').length === 1, null, { timeout: 8000 });
    const after = await widgetPage.evaluate(() => ({
      badge: document.querySelector('#tabDeadlinesBadge')?.textContent,
      title: document.querySelector('.todo-row b')?.textContent,
      chip: document.querySelector('.todo-row em')?.textContent,
      pinPressed: document.querySelector('#pinButton')?.getAttribute('aria-pressed')
    }));
    assert(after.badge === '1', `角标不正确：${after.badge}`);
    assert(after.title === '探针测试事项', `标题不正确：${after.title}`);
    assert(after.chip === '3 天后', `标签不正确：${after.chip}`);
    assert(after.pinPressed === 'false', '默认应为不置顶');

    // 小组件点击事项：主窗口显示、落到大作业页并打开详情，搜索与筛选复位
    await mainPage.locator('.nav-item[data-page="assignments"]').click();
    await mainPage.locator('#assignmentFilters [data-filter="not_started"]').click();
    await mainPage.locator('#searchInput').fill('不存在的关键词');
    await hideMainWindow(electronApp);
    const boundsBefore = await waitStableWidgetBounds(electronApp);
    assert(boundsBefore, '跳转前未找到小组件窗口');

    await widgetPage.locator('#widgetRows .todo-row').first().click();
    await mainPage.waitForFunction(() => {
      const modal = document.querySelector('#itemDetailModal');
      return modal?.getAttribute('aria-hidden') === 'false'
        && document.querySelector('#detailTitle')?.textContent.trim() === '探针测试事项';
    }, null, { timeout: 15000, polling: 100 });

    assert(await mainWindowVisible(electronApp), '跳转后主窗口未显示');
    assert(await mainPage.locator('#detailTitle').textContent() === '探针测试事项', '详情标题不正确');
    assert(await mainPage.locator('#detailBackButton').evaluate(el => el.classList.contains('hidden')), '小组件来源应隐藏返回键');
    assert(await mainPage.locator('.nav-item[data-page="assignments"]').evaluate(el => el.classList.contains('active')), '未落在大作业页');
    assert(await mainPage.locator('#searchInput').inputValue() === '', '跳转后搜索未清空');
    assert(await mainPage.locator('#assignmentFilters [data-filter="all"]').getAttribute('aria-pressed') === 'true', '大作业筛选未重置为全部');

    const boundsAfter = await waitStableWidgetBounds(electronApp);
    assert(boundsAfter, '跳转后未找到小组件窗口');
    assert(Math.abs(boundsAfter.x - boundsBefore.x) <= 2
      && Math.abs(boundsAfter.y - boundsBefore.y) <= 2
      && Math.abs(boundsAfter.width - boundsBefore.width) <= 2
      && Math.abs(boundsAfter.height - boundsBefore.height) <= 2,
      `小组件 bounds 在跳转后发生变化：${JSON.stringify({ boundsBefore, boundsAfter })}`);

    // 详情内直接改状态：未开始 → 进行中
    assert(await mainPage.locator('#detailFooter [data-action="edit"]').count() === 1, '详情内应有编辑入口');
    assert(await mainPage.locator('#detailFooter [data-action="status"]').count() === 0, '底部不应再有状态切换按钮');
    assert(await mainPage.locator('#detailStatusSelect').count() === 1, '详情状态字段应可直接修改');
    assert(await mainPage.locator('#detailStatusSelect option').count() === 3, '大作业应有三个状态选项');
    await mainPage.screenshot({ path: path.join(outputDir, 'widget-detail.png'), fullPage: true });
    await mainPage.locator('#detailStatusSelect').selectOption('in_progress');
    await mainPage.waitForFunction(() => {
      const select = document.querySelector('#detailStatusSelect');
      return select?.value === 'in_progress'
        && document.querySelector('#itemDetailBody')?.textContent.includes('进行中');
    }, null, { timeout: 8000 });

    // 详情内改内容：复用编辑表单，保存后详情与小组件同步
    await mainPage.locator('#detailFooter [data-action="edit"]').click();
    await mainPage.locator('#itemModal.open').waitFor();
    assert(await mainPage.locator('#itemTitle').inputValue() === '探针测试事项', '编辑表单未带入原内容');
    await mainPage.locator('#itemTitle').fill('探针测试事项（已编辑）');
    await mainPage.locator('#saveItemButton').click();
    await mainPage.locator('#itemModal').waitFor({ state: 'hidden' });
    await mainPage.waitForFunction(() => document.querySelector('#detailTitle')?.textContent === '探针测试事项（已编辑）', null, { timeout: 8000 });
    assert(await mainPage.locator('#detailStatusSelect').inputValue() === 'in_progress', '编辑后状态字段未保持最新值');
    await widgetPage.waitForFunction(() => document.querySelector('#widgetRows .todo-row b')?.textContent === '探针测试事项（已编辑）', null, { timeout: 8000 });

    await mainPage.locator('#itemDetailModal .detail-close').click();
    await mainPage.waitForFunction(
      () => document.querySelector('#itemDetailModal')?.getAttribute('aria-hidden') === 'true',
      null, { timeout: 5000, polling: 100 }
    );
    await mainPage.locator('.nav-item[data-page="today"]').click();
    await mainPage.locator('[data-page-view="today"]').waitFor({ state: 'visible' });

    // 主窗口今天页删除该事项，小组件角标应实时归零；主窗口今天列表同时落到空态
    await mainPage.locator('#deadlineList [data-action="delete"]').first().click();
    await mainPage.locator('#confirmAccept').click();
    await widgetPage.waitForFunction(() => document.querySelector('#tabDeadlinesBadge')?.textContent === '0', null, { timeout: 8000 });
    await mainPage.locator('#deadlineList .empty-state').waitFor({ timeout: 8000 });

    // 逾期 / 活动夹具：验证非大作业分支的落点
    // 今天页空态按钮固定创建大作业
    await mainPage.getByRole('button', { name: '新增事项' }).click();
    await mainPage.locator('#itemTitle').fill('探针逾期事项');
    await mainPage.locator('#itemDeadlineDate').fill(dateInDays(-1).slice(0, 10));
    await mainPage.locator('#itemDeadlineTime').fill(dateInDays(-1).slice(11));
    await mainPage.locator('#saveItemButton').click();
    await mainPage.locator('#itemModal').waitFor({ state: 'hidden' });

    // 活动必须从活动页「新增活动」入口创建
    await mainPage.locator('.nav-item[data-page="activities"]').click();
    await mainPage.locator('.new-kind-button[data-kind="activity"]').click();
    await mainPage.locator('#itemTitle').fill('探针活动事项');
    await mainPage.locator('#itemDeadlineDate').fill(dateInDays(3).slice(0, 10));
    await mainPage.locator('#itemDeadlineTime').fill(dateInDays(3).slice(11));
    await mainPage.locator('#saveItemButton').click();
    await mainPage.locator('#itemModal').waitFor({ state: 'hidden' });

    await widgetPage.waitForFunction(() => {
      const rows = [...document.querySelectorAll('#widgetRows .todo-row')];
      return rows.some(row => row.textContent.includes('探针逾期事项'))
        && rows.some(row => row.textContent.includes('探针活动事项'));
    }, null, { timeout: 8000 });

    await assertWidgetJump(electronApp, widgetPage, mainPage, '探针逾期事项', 'overdue');
    await assertWidgetJump(electronApp, widgetPage, mainPage, '探针活动事项', 'activities');

    // 当天待办 → 详情 → 返回：确认详情来源切换与 aria-hidden 配对未回归
    await mainPage.locator('.nav-item[data-page="today"]').click();
    await mainPage.locator('#weekStrip .week-day.has-item').first().waitFor({ timeout: 8000 });
    await mainPage.locator('#weekStrip .week-day.has-item').first().click();
    await mainPage.locator('#dayItemsModal.open').waitFor();
    await mainPage.locator('#dayItemsList .day-item-button').first().click();
    await mainPage.waitForFunction(
      () => document.querySelector('#itemDetailModal')?.getAttribute('aria-hidden') === 'false',
      null, { timeout: 5000, polling: 100 }
    );
    assert(await mainPage.locator('#detailBackButton').evaluate(el => !el.classList.contains('hidden')), '当天待办来源应显示返回键');
    await mainPage.locator('#detailBackButton').click();
    await mainPage.waitForFunction(() => {
      const modal = document.querySelector('#dayItemsModal');
      return modal?.classList.contains('open') && modal?.getAttribute('aria-hidden') === 'false';
    }, null, { timeout: 5000, polling: 100 });
    await mainPage.locator('#dayItemsModal .day-items-close').click();

    // tab 切换：视图互斥 + 打卡空态入口
    await widgetPage.locator('#tabHabits').click();
    await widgetPage.locator('#tabHabits[aria-selected="true"]').waitFor();
    const tabState = await widgetPage.evaluate(() => ({
      deadlinesActive: document.querySelector('#widgetRows').classList.contains('active'),
      habitsActive: document.querySelector('#widgetHabits').classList.contains('active'),
      emptyAction: Boolean(document.querySelector('#widgetHabits .widget-empty-action'))
    }));
    assert(!tabState.deadlinesActive && tabState.habitsActive, 'tab 切换后视图应互斥显示');
    assert(tabState.emptyAction, '打卡 tab 空态应提供去主应用入口');
    await widgetPage.screenshot({ path: path.join(outputDir, 'widget-habits-empty.png'), omitBackground: true });
    await widgetPage.locator('#tabDeadlines').click();
    await widgetPage.locator('#tabDeadlines[aria-selected="true"]').waitFor();

    // 页头拖动窗口：位移应与鼠标位移一致（±4 容差吸收 DPI 舍入）
    const dragStart = await widgetBounds(electronApp);
    assert(dragStart, '未找到小组件窗口');
    await dragWidgetBy(widgetPage, 40, 25);
    let bounds = await widgetBounds(electronApp);
    assert(Math.abs(bounds.x - dragStart.x - 40) <= 4 && Math.abs(bounds.y - dragStart.y - 25) <= 4,
      `拖动位移异常：dx=${bounds.x - dragStart.x}, dy=${bounds.y - dragStart.y}`);

    // 视图内部滚动后再拖（原缺陷：滚动后 app-region 命中图失效导致窗口拖不动）
    await widgetPage.evaluate(() => {
      const filler = document.createElement('div');
      filler.style.height = '1200px';
      document.querySelector('#widgetRows').appendChild(filler);
      document.querySelector('#widgetRows').scrollTop = 600;
    });
    const dragStartScrolled = await widgetBounds(electronApp);
    await dragWidgetBy(widgetPage, -30, 15);
    bounds = await widgetBounds(electronApp);
    assert(Math.abs(bounds.x - dragStartScrolled.x + 30) <= 4 && Math.abs(bounds.y - dragStartScrolled.y - 15) <= 4,
      `滚动后拖动位移异常：dx=${bounds.x - dragStartScrolled.x}, dy=${bounds.y - dragStartScrolled.y}`);

    // tab 记忆：写入 habits 后 reload 恢复打卡 tab；清空后回到默认截止 tab
    await widgetPage.evaluate(() => localStorage.setItem('widget-tab', 'habits'));
    await widgetPage.reload();
    await widgetPage.locator('#tabHabits[aria-selected="true"]').waitFor();
    await widgetPage.evaluate(() => localStorage.removeItem('widget-tab'));
    await widgetPage.reload();
    await widgetPage.locator('#tabDeadlines[aria-selected="true"]').waitFor();

    const windows = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map(win => ({ title: win.getTitle(), visible: win.isVisible(), alwaysOnTop: win.isAlwaysOnTop(), bounds: win.getBounds() }))
    );
    const widgetInfo = windows.find(entry => entry.title === '截止线小组件');
    assert(widgetInfo && widgetInfo.alwaysOnTop === false, '组件窗口默认不应置顶');
    await widgetPage.screenshot({ path: path.join(outputDir, 'widget-list.png'), omitBackground: true });
    console.log(JSON.stringify({ before, after, tabState, windows, pageErrors: errors }, null, 2));
    assert(errors.length === 0, `渲染进程错误：${errors.join('; ')}`);
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await electronApp.close().catch(() => {});
  }
  console.log(JSON.stringify({ passed: true, checks: ['启动自动显示与默认 tab', '空状态与角标隐藏', '数据实时推送与角标/标题/相对天数', '小组件点击大作业打开详情并复位搜索/筛选', '详情内状态切换与编辑内容', '小组件点击逾期/活动落到对应页', '当天待办详情返回键未回归', 'tab 切换互斥', '页头拖动窗口', '滚动后仍可拖动', 'tab 记忆与默认恢复', '无渲染错误'] }));
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
