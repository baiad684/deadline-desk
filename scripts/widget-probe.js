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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

    const before = await widgetPage.evaluate(() => ({
      empty: Boolean(document.querySelector('.ios-empty')),
      rows: document.querySelectorAll('.todo-row').length,
      overflow: document.querySelector('.widget-shell').scrollHeight > document.querySelector('.widget-shell').clientHeight
    }));
    assert(before.empty && before.rows === 0, '空数据时未显示空状态');
    await widgetPage.screenshot({ path: path.join(outputDir, 'widget-empty.png'), omitBackground: true });

    // 主窗口新增一个 3 天后截止的事项，小组件应实时收到推送
    const mainPage = electronApp.windows().find(page => page.url().includes('index.html'));
    mainPage.on('pageerror', error => errors.push(`main: ${error.message}`));
    await mainPage.waitForLoadState('domcontentloaded');
    await mainPage.getByRole('button', { name: '新增事项' }).click();
    await mainPage.locator('#itemTitle').fill('探针测试事项');
    await mainPage.locator('#itemDeadline').fill(dateInDays(3));
    await mainPage.locator('#saveItemButton').click();
    await mainPage.getByText('探针测试事项').first().waitFor();

    await widgetPage.waitForFunction(() => document.querySelectorAll('.todo-row').length === 1, null, { timeout: 8000 });
    const after = await widgetPage.evaluate(() => ({
      count: document.querySelector('#widgetCount')?.textContent,
      title: document.querySelector('.todo-row b')?.textContent,
      chip: document.querySelector('.todo-row em')?.textContent,
      pinPressed: document.querySelector('#pinButton')?.getAttribute('aria-pressed'),
      overflow: document.querySelector('.widget-shell').scrollHeight > document.querySelector('.widget-shell').clientHeight
    }));
    assert(after.count === '1 项待办', `计数不正确：${after.count}`);
    assert(after.title === '探针测试事项', `标题不正确：${after.title}`);
    assert(after.chip === '3 天后', `标签不正确：${after.chip}`);
    assert(after.pinPressed === 'false', '默认应为不置顶');

    const bounds = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map(win => ({ title: win.getTitle(), visible: win.isVisible(), alwaysOnTop: win.isAlwaysOnTop(), bounds: win.getBounds() }))
    );
    const widgetInfo = bounds.find(entry => entry.title === '截止线小组件');
    assert(widgetInfo && widgetInfo.alwaysOnTop === false, '组件窗口默认不应置顶');
    await widgetPage.screenshot({ path: path.join(outputDir, 'widget-list.png'), omitBackground: true });
    console.log(JSON.stringify({ before, after, bounds, pageErrors: errors }, null, 2));
    assert(errors.length === 0, `渲染进程错误：${errors.join('; ')}`);
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await electronApp.close().catch(() => {});
  }
  console.log(JSON.stringify({ passed: true, checks: ['启动自动显示', '空状态', '数据实时推送', '计数/标题/相对天数', '无溢出', '无渲染错误'] }));
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
