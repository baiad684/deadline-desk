const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const projectDir = path.resolve(__dirname, '..');
const dataDir = path.join(projectDir, 'test-output', 'data');
const outputDir = path.join(projectDir, 'test-output');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function dateInDays(days) {
  const date = new Date(Date.now() + days * 86400000);
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
  // 等进程完全退出，避免下一次启动撞上单实例锁
  await new Promise(resolve => setTimeout(resolve, 1200));
}

(async () => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  let electronApp = await launchApp();
  try {
    const page = await electronApp.firstWindow();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.waitForLoadState('domcontentloaded');

    assert(await page.getByText('从第一条截止日期开始').isVisible(), '首次启动未显示空白状态');
    await page.screenshot({ path: path.join(outputDir, '01-empty-home.png'), fullPage: true });

    await page.getByRole('button', { name: '新增事项' }).click();
    await page.locator('#itemTitle').fill('数据库课程设计');
    await page.locator('#itemDescription').fill('完成实验结果整理和课程报告');
    await page.locator('#itemDeadline').fill(dateInDays(5));
    await page.locator('#itemWorkType').selectOption('team');
    await page.locator('#itemStatus').selectOption('in_progress');
    await page.locator('#saveItemButton').click();
    await page.getByText('数据库课程设计').first().waitFor();
    assert(await page.locator('#assignmentCount').textContent() === '1', '新增后大作业计数不正确');

    await page.locator('[data-page="assignments"]').click();
    await page.getByRole('button', { name: '新增大作业' }).click();
    await page.getByRole('button', { name: '活动' }).last().click();
    await page.locator('#itemTitle').fill('校园摄影赛投稿');
    await page.locator('#itemDescription').fill('提交三张摄影作品');
    await page.locator('#itemDeadline').fill(dateInDays(2));
    await page.locator('#saveItemButton').click();
    await page.waitForFunction(() => document.querySelector('#activityCount')?.textContent === '1', null, { timeout: 10000 });
    assert(await page.locator('#activityCount').textContent() === '1', '新增后活动计数不正确');
    await page.locator('[data-page="today"]').click();
    await page.screenshot({ path: path.join(outputDir, '02-home-with-items.png'), fullPage: true });

    await page.locator('[data-page="assignments"]').click();
    await page.locator('#assignmentList').getByText('数据库课程设计').waitFor();
    assert((await page.locator('#assignmentResultCount').textContent()).includes('1'), '大作业列表数量不正确');
    await page.screenshot({ path: path.join(outputDir, '03-assignments.png'), fullPage: true });

    await page.locator('[data-page="activities"]').click();
    const statusButton = page.locator('#activityList [data-action="status"]');
    await statusButton.click();
    await page.getByText('状态已更新').waitFor();
    assert(await page.locator('#activityList').getByRole('button', { name: '已完成' }).isVisible(), '活动状态切换失败');

    await page.locator('[data-page="stats"]').click();
    assert(await page.locator('#activityCompletionRate').textContent() === '100%', '活动统计完成率不正确');
    assert(await page.locator('#assignmentCompletionRate').textContent() === '0%', '大作业统计完成率不正确');
    await page.screenshot({ path: path.join(outputDir, '04-stats.png'), fullPage: true });

    assert(pageErrors.length === 0, `渲染进程错误：${pageErrors.join('; ')}`);
  } finally {
    await stopApp(electronApp);
  }

  electronApp = await launchApp();
  try {
    const relaunchPage = await electronApp.firstWindow();
    await relaunchPage.waitForLoadState('domcontentloaded');
    await relaunchPage.locator('#deadlineList').getByText('数据库课程设计').waitFor();
    assert(await relaunchPage.locator('#assignmentCount').textContent() === '1', '重启后大作业未持久化');
    assert(await relaunchPage.locator('#activityCount').textContent() === '1', '重启后活动未持久化');
    await relaunchPage.screenshot({ path: path.join(outputDir, '05-after-restart.png'), fullPage: true });
  } finally {
    await stopApp(electronApp);
  }

  console.log(JSON.stringify({
    passed: true,
    checks: [
      '首次启动空白状态',
      '新增大作业',
      '新增活动',
      '列表与导航计数',
      '活动状态切换',
      '统计完成率',
      '重启后数据持久化',
      '渲染进程无异常'
    ]
  }, null, 2));
})().catch(async error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
