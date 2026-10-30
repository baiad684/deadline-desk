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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T14:30`;
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

    // isVisible 不等待渲染，启动慢一拍会假失败；改为显式等待空状态出现
    await page.getByText('从第一条截止日期开始').first().waitFor({ timeout: 15000 });
    await page.screenshot({ path: path.join(outputDir, '01-empty-home.png'), fullPage: true });

    await page.getByRole('button', { name: '新增事项' }).click();
    await page.locator('#itemTitle').fill('数据库课程设计');
    await page.locator('#itemDescription').fill('完成实验结果整理和课程报告');
    const deadline = dateInDays(5);
    await page.locator('#itemDeadlineDate').fill(deadline.slice(0, 10));
    await page.locator('#itemDeadlineTime').fill(deadline.slice(11));
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
    const deadlineSoon = dateInDays(2);
    await page.locator('#itemDeadlineDate').fill(deadlineSoon.slice(0, 10));
    await page.locator('#itemDeadlineTime').fill(deadlineSoon.slice(11));
    await page.locator('#saveItemButton').click();
    await page.waitForFunction(() => document.querySelector('#activityCount')?.textContent === '1', null, { timeout: 10000 });
    assert(await page.locator('#activityCount').textContent() === '1', '新增后活动计数不正确');

    // 再建一条活动，供今天页删除用例使用（新建后仍停在大作业页，先切到活动页）
    await page.locator('[data-page="activities"]').click();
    await page.getByRole('button', { name: '新增活动' }).click();
    await page.locator('#itemTitle').fill('临时删除验证事项');
    const deadlineTemp = dateInDays(4);
    await page.locator('#itemDeadlineDate').fill(deadlineTemp.slice(0, 10));
    await page.locator('#itemDeadlineTime').fill(deadlineTemp.slice(11));
    await page.locator('#saveItemButton').click();
    await page.waitForFunction(() => document.querySelector('#activityCount')?.textContent === '2', null, { timeout: 10000 });
    await page.locator('[data-page="today"]').click();
    await page.screenshot({ path: path.join(outputDir, '02-home-with-items.png'), fullPage: true });

    await page.locator('[data-page="assignments"]').click();
    await page.locator('#assignmentList').getByText('数据库课程设计').waitFor();
    assert((await page.locator('#assignmentResultCount').textContent()).includes('1'), '大作业列表数量不正确');
    await page.screenshot({ path: path.join(outputDir, '03-assignments.png'), fullPage: true });

    await page.locator('[data-page="activities"]').click();
    // 临时事项也在列表中，用 data-id 圈定校园摄影赛（全新数据库：1=大作业 2=摄影赛 3=临时事项）
    const statusButton = page.locator('#activityList [data-action="status"][data-id="2"]');
    await statusButton.click();
    await page.getByText('状态已更新').waitFor();
    // 状态按钮带 aria-label，getByRole 会按可访问名子串匹配到别的行；直接读该行按钮文本
    assert((await page.locator('#activityList [data-action="status"][data-id="2"]').textContent()).includes('已完成'), '活动状态切换失败');

    // 今天页行内删除：取消不动行，确认后行消失且不影响其他事项与计数
    await page.locator('[data-page="today"]').click();
    await page.locator('#deadlineList').getByText('临时删除验证事项').waitFor();
    assert(await page.locator('#deadlineList [data-action="delete"]').count() === 2, '今天页每行应有删除按钮');
    const tempRow = page.locator('#deadlineList article', { hasText: '临时删除验证事项' });
    await tempRow.locator('[data-action="delete"]').click();
    await page.locator('#confirmModal.open').waitFor();
    assert((await page.locator('#confirmMessage').textContent()).includes('临时删除验证事项'), '确认弹窗未指明事项');
    await page.locator('#confirmCancel').click();
    // 关闭态弹窗本身是隐藏元素，不能等 :not(.open) 可见，要等 open 类消失
    await page.waitForFunction(() => !document.querySelector('#confirmModal')?.classList.contains('open'), null, { timeout: 10000 });
    assert(await tempRow.isVisible(), '取消删除后行应保留');
    await tempRow.locator('[data-action="delete"]').click();
    await page.locator('#confirmAccept').click();
    await page.waitForFunction(() => !document.querySelector('#deadlineList')?.textContent.includes('临时删除验证事项'), null, { timeout: 10000 });
    assert(await page.locator('#deadlineList').getByText('数据库课程设计').isVisible(), '删除不应影响其他事项');
    assert(await page.locator('#activityCount').textContent() === '1', '删除后活动计数未回落');
    await page.screenshot({ path: path.join(outputDir, '03b-today-after-delete.png'), fullPage: true });

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
    assert(await relaunchPage.getByText('临时删除验证事项').count() === 0, '已删除事项重启后不应复活');
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
      '今天页行内删除（取消保留/确认删除/计数回落/不复活）',
      '统计完成率',
      '重启后数据持久化',
      '渲染进程无异常'
    ]
  }, null, 2));
})().catch(async error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
