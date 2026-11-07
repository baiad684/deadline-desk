const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const http = require('http');

const projectDir = path.resolve(__dirname, '..');
const dataDir = path.join(projectDir, 'test-output', 'assistant-data');
const outputDir = path.join(projectDir, 'test-output');
const dbPath = path.join(dataDir, 'deadline-desk.db');
const model = 'mock-model';
const apiKey = 'sk-test-1234567890abcd';
const expectedKeyMask = 'sk-t••••abcd';

let mockEndpoint = '';

const CHECK_TITLES = {
  1: 'settings:get 默认 AI 配置为空',
  2: '保存 AI 配置并返回掩码',
  3: '空地址保存与旧 Key 保留',
  4: 'AI 配置类型校验',
  5: 'AI 接口地址格式校验',
  6: '缺 Key 或缺地址时前置拦截',
  7: '输入类型与长度校验',
  8: '模型请求报文契约',
  9: '事项摘要排序、截取与 omittedCount',
  10: '围栏与数组内容解析（无 create 块归一为 clarify）',
  11: '多意图归一化为 clarify',
  12: '未知意图归一化为 clarify',
  13: '越界意图 unsupported',
  14: 'HTTP 错误映射',
  15: '空/非法/截断响应',
  16: '请求超时',
  17: '网络失败分类',
  18: '查询：本月已完成统计与两次调用',
  19: '查询：第二次调用失败回落模板',
  20: '查询：缺范围只调用一次',
  21: '助手通道不改动事项数据',
  22: '非主窗口调用被拒绝',
  23: '重启后 Key 掩码与配置保持',
  24: '全流程无页面异常',
  25: '写意图：新增计划字段与默认勾选',
  26: '写意图：修改计划与非法字段',
  27: '写意图：删除计划与同名歧义',
  28: '写意图：清理范围过滤与空结果',
  29: '写意图：计划阶段零写入',
  30: '错误映射：400/404/418',
  31: '助手页：导航、结构、隐私与配置提示',
  32: '新增预览：候选、徽标与默认勾选',
  33: '新增执行：取消勾选与导航/统计同步',
  34: '新增预览：待补全、移除与部分写入',
  35: '修改预览：diff、保存与多目标',
  36: '删除：永久删除、二次确认与已不存在',
  37: '清理：范围过滤、确认与空结果',
  38: '查询：答复、口径与零写入',
  39: '生命周期：输入保留、离开清空与晚到响应',
  40: '错误：未配置、可重试与超长拦截',
  41: '安全：文本转义与替换预览确认'
};

const passed = new Set();

function passCheck(number) {
  passed.add(String(number));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function localDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthDate(offsetMonths, day, time) {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + offsetMonths, day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${time}`;
}

function formatYmd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function launchApp() {
  return electron.launch({
    args: ['.'],
    cwd: projectDir,
    env: { ...process.env, DEADLINE_DESK_DATA_DIR: dataDir, DEADLINE_DESK_AI_TIMEOUT_MS: '800' }
  });
}

async function stopApp(electronApp) {
  await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await electronApp.close().catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 1200));
}

async function mutateDb(statements) {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: file => path.join(projectDir, 'node_modules', 'sql.js', 'dist', file) });
  const db = new SQL.Database(fs.readFileSync(dbPath));
  for (const statement of statements) db.run(statement.sql, statement.params || []);
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
}

function chatCompletion(content, finishReason = 'stop') {
  return {
    id: 'mock',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }]
  };
}

function sendJson(res, status, payload, delayMs = 0) {
  const write = () => {
    try {
      if (res.writableEnded) return;
      const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body);
    } catch {
      // 客户端已断开（超时用例）
    }
  };
  if (delayMs) setTimeout(write, delayMs);
  else write();
}

function createMockServer() {
  return new Promise((resolve, reject) => {
    const requests = [];
    const state = { queryScenario: null };
    const respondQuery = res => {
      if (state.queryScenario === 'this_month') {
        sendJson(res, 200, chatCompletion('按截止时间在本月内：已完成 1 个。'));
        return;
      }
      sendJson(res, 500, { error: { message: 'secret-body' } });
    };
    const respondScenario = (res, key) => {
      switch (key) {
        case 'MOCK_CREATE':
          return sendJson(res, 200, chatCompletion('{"intent":"create","create":{"candidates":[{"title":"数据库课设","kind":"assignment","deadline":"2026-11-13 23:59","status":"not_started","description":"","workType":"personal"},{"title":"校辩论赛报名","kind":"activity","deadline":"2026-11-10 23:59","status":"not_completed","description":"","workType":null}]},"message":"已识别到 2 条候选"}'));
        case 'MOCK_FENCE':
          return sendJson(res, 200, chatCompletion('```json\n{"intent":"create","message":"ok"}\n```'));
        case 'MOCK_ARRAY':
          return sendJson(res, 200, chatCompletion([{ type: 'text', text: '{"intent":"create","message":"ok"}' }]));
        case 'MOCK_MULTI':
          return sendJson(res, 200, chatCompletion('{"intent":"multiple","detectedIntents":["create","delete"],"message":"mixed"}'));
        case 'MOCK_MULTI_EMPTY':
          return sendJson(res, 200, chatCompletion('{"intent":"multiple","message":"mixed"}'));
        case 'MOCK_UNKNOWN':
          return sendJson(res, 200, chatCompletion('{"intent":"whatever"}'));
        case 'MOCK_UNSUPPORTED':
          return sendJson(res, 200, chatCompletion('{"intent":"unsupported","message":"不支持生成周报。"}'));
        case 'MOCK_EMPTY':
          return sendJson(res, 200, chatCompletion(''));
        case 'MOCK_NOT_JSON':
          return sendJson(res, 200, chatCompletion('抱歉，我不能…'));
        case 'MOCK_LENGTH':
          return sendJson(res, 200, chatCompletion('{"intent":"clarify","message":"length"}', 'length'));
        case 'MOCK_NO_CHOICES':
          return sendJson(res, 200, { choices: [] });
        case 'MOCK_401':
          return sendJson(res, 401, { error: { message: 'secret-body' } });
        case 'MOCK_429':
          return sendJson(res, 429, { error: { message: 'secret-body' } });
        case 'MOCK_500':
          return sendJson(res, 500, { error: { message: 'secret-body' } });
        case 'MOCK_SLOW':
          return sendJson(res, 200, chatCompletion('{"intent":"clarify","message":"slow"}'), 1500);
        case 'MOCK_QUERY_THIS_MONTH':
          state.queryScenario = 'this_month';
          return sendJson(res, 200, chatCompletion('{"intent":"query","query":{"range":{"type":"this_month"},"kind":"all","status":"completed","shape":"count"}}'));
        case 'MOCK_QUERY_FALLBACK':
          state.queryScenario = 'fallback';
          return sendJson(res, 200, chatCompletion('{"intent":"query","query":{"range":{"type":"last_month"},"status":"completed"}}'));
        case 'MOCK_QUERY_NO_RANGE':
          return sendJson(res, 200, chatCompletion('{"intent":"query","query":{}}'));
        case 'MOCK_PLAN_CREATE':
          return sendJson(res, 200, chatCompletion(JSON.stringify({
            intent: 'create',
            message: '已整理出候选',
            create: {
              candidates: [
                { title: '数据库课设', kind: 'assignment', deadline: `${localDate(3)} 23:59`, status: 'not_started', workType: 'team' },
                { title: '校园歌手比赛', kind: 'activity', deadline: `${localDate(2)} 20:00`, status: 'not_completed', workType: null },
                { title: '补录旧作业', kind: 'assignment', deadline: `${localDate(-3)} 02:00`, status: 'not_started', workType: 'personal' },
                { title: '缺少时间的作业', kind: 'assignment', deadline: null, workType: null },
                { title: '随手记一下', kind: 'diary', deadline: null }
              ],
              ignored: [{ text: '随手一提', reason: '没有明确标题' }]
            }
          })));
        case 'MOCK_PLAN_UPDATE':
          return sendJson(res, 200, chatCompletion(JSON.stringify({
            intent: 'update',
            message: '已找到目标',
            update: {
              targetIds: [1],
              changes: {
                kind: 'assignment',
                deadline: `${localDate(6)} 23:59`,
                status: 'in_progress',
                title: '数据库课程设计（改）',
                description: '新说明'
              }
            }
          })));
        case 'MOCK_PLAN_UPDATE_INVALID':
          return sendJson(res, 200, chatCompletion(JSON.stringify({
            intent: 'update',
            update: { targetIds: [2], changes: { status: 'in_progress', deadline: '2026-02-31 10:00' } }
          })));
        case 'MOCK_PLAN_DELETE':
          return sendJson(res, 200, chatCompletion(JSON.stringify({ intent: 'delete', delete: { targetIds: [3, 2] } })));
        case 'MOCK_PLAN_CLEANUP':
          return sendJson(res, 200, chatCompletion(JSON.stringify({ intent: 'cleanup', cleanup: { range: { type: 'last_month' } } })));
        case 'MOCK_PLAN_CLEANUP_EMPTY':
          return sendJson(res, 200, chatCompletion(JSON.stringify({ intent: 'cleanup', cleanup: { range: { type: 'next_month' } } })));
        case 'MOCK_UI_CREATE':
          return sendJson(res, 200, chatCompletion(JSON.stringify({
            intent: 'create',
            message: '已整理出候选',
            create: {
              candidates: [
                { title: '数据库课设', kind: 'assignment', deadline: `${localDate(3)} 23:59`, status: 'not_started', workType: 'team' },
                { title: '校园摄影比赛', kind: 'activity', deadline: `${localDate(2)} 20:00`, status: 'not_completed', workType: null },
                { title: '补录旧作业', kind: 'assignment', deadline: `${localDate(-3)} 02:00`, status: 'not_started', workType: 'personal' },
                { title: '缺少时间的作业', kind: 'assignment', deadline: null, status: 'not_started', workType: 'personal' }
              ],
              ignored: [{ text: '随手一提', reason: '没有明确标题' }]
            }
          })));
        case 'MOCK_UI_CREATE_MISSING':
          return sendJson(res, 200, chatCompletion(JSON.stringify({
            intent: 'create',
            message: '已整理出候选',
            create: {
              candidates: [
                { title: '助手正常候选', kind: 'assignment', deadline: `${localDate(4)} 23:59`, status: 'not_started', workType: 'personal' },
                { title: '助手待补全候选', kind: 'assignment', deadline: null, status: 'not_started', workType: 'personal' },
                { title: '助手移除候选', kind: 'assignment', deadline: null, status: 'not_started', workType: 'personal' }
              ],
              ignored: []
            }
          })));
        case 'MOCK_UI_CREATE_BULK': {
          const candidates = [];
          for (let index = 0; index < 60; index += 1) {
            candidates.push({
              title: `批量候选 ${index + 1}`,
              kind: 'assignment',
              deadline: `${localDate(8 + index)} 12:30`,
              status: 'not_started',
              workType: 'personal'
            });
          }
          return sendJson(res, 200, chatCompletion(JSON.stringify({ intent: 'create', create: { candidates, ignored: [] } })));
        }
        case 'MOCK_UI_XSS':
          return sendJson(res, 200, chatCompletion(JSON.stringify({
            intent: 'create',
            create: {
              candidates: [{
                title: '<img src=x onerror="window.__xss=1">X',
                kind: 'assignment',
                deadline: `${localDate(4)} 23:59`,
                status: 'not_started',
                description: '<script>window.__xss=1</script>',
                workType: 'personal'
              }],
              ignored: []
            }
          })));
        case 'MOCK_UI_UPDATE':
          return sendJson(res, 200, chatCompletion(JSON.stringify({
            intent: 'update',
            message: '已找到目标',
            update: { targetIds: [2], changes: { deadline: `${localDate(6)} 23:59` } }
          })));
        case 'MOCK_UI_UPDATE_MULTI':
          return sendJson(res, 200, chatCompletion(JSON.stringify({
            intent: 'update',
            message: '匹配到多个事项',
            update: { targetIds: [3, 4], changes: { status: 'completed' } }
          })));
        case 'MOCK_UI_UPDATE_STATUS_INVALID':
          return sendJson(res, 200, chatCompletion(JSON.stringify({
            intent: 'update',
            update: { targetIds: [2], changes: { status: 'in_progress' } }
          })));
        case 'MOCK_UI_UPDATE_TITLE':
          return sendJson(res, 200, chatCompletion(JSON.stringify({
            intent: 'update',
            update: { targetIds: [1], changes: { title: '数据库课程设计（新）' } }
          })));
        case 'MOCK_UI_DELETE':
          return sendJson(res, 200, chatCompletion(JSON.stringify({
            intent: 'delete',
            delete: { targetIds: [2] }
          })));
        case 'MOCK_UI_DELETE_CREATED':
          return sendJson(res, 200, chatCompletion(JSON.stringify({
            intent: 'delete',
            delete: { targetIds: [8] }
          })));
        case 'MOCK_UI_CLEANUP':
          return sendJson(res, 200, chatCompletion(JSON.stringify({
            intent: 'cleanup',
            cleanup: { range: { type: 'last_month' } }
          })));
        case 'MOCK_UI_CLEANUP_EMPTY':
          return sendJson(res, 200, chatCompletion(JSON.stringify({
            intent: 'cleanup',
            cleanup: { range: { type: 'next_month' } }
          })));
        case 'MOCK_UI_DELAYED':
          return sendJson(res, 200, chatCompletion(JSON.stringify({
            intent: 'create',
            create: {
              candidates: [{ title: '助手延迟候选', kind: 'assignment', deadline: `${localDate(4)} 23:59`, status: 'not_started', workType: 'personal' }],
              ignored: []
            }
          })), 400);
        case 'MOCK_400':
          return sendJson(res, 400, { error: { message: 'secret-body' } });
        case 'MOCK_404':
          return sendJson(res, 404, { error: { message: 'secret-body' } });
        case 'MOCK_418':
          return sendJson(res, 418, { error: { message: 'secret-body' } });
        default:
          return sendJson(res, 200, chatCompletion('{"intent":"clarify","message":"请补充更多信息"}'));
      }
    };
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        let body = {};
        try {
          body = JSON.parse(raw);
        } catch {
          body = {};
        }
        requests.push({ method: req.method, url: `http://${req.headers.host}${req.url}`, headers: req.headers, body });
        const contentText = body && Array.isArray(body.messages) ? body.messages[1]?.content : undefined;
        let parsed = null;
        if (typeof contentText === 'string') {
          try {
            parsed = JSON.parse(contentText);
          } catch {
            parsed = null;
          }
        }
        if (parsed && typeof parsed === 'object' && typeof parsed.question === 'string') {
          respondQuery(res);
          return;
        }
        const input = parsed && typeof parsed === 'object' && typeof parsed.input === 'string' ? parsed.input : '';
        respondScenario(res, input);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        requests,
        endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
        resetMock() {
          requests.length = 0;
          state.queryScenario = null;
        },
        close() {
          return new Promise(done => server.close(() => done()));
        }
      });
    });
  });
}

async function readAi(page) {
  return (await page.evaluate(() => window.deadlineDesk.settings.get())).ai;
}

function saveAi(page, payload) {
  return page.evaluate(input => window.deadlineDesk.settings.saveAi(input), payload);
}

function parse(page, input) {
  return page.evaluate(value => window.deadlineDesk.assistant.parse(value), input);
}

function snapshotItems(page) {
  return page.evaluate(() => JSON.stringify(window.deadlineDesk.items.list()));
}

function snapshotSettings(page) {
  return page.evaluate(() => JSON.stringify(window.deadlineDesk.settings.get()));
}

async function openStagePage(electronApp, pageErrors) {
  const page = await electronApp.firstWindow();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  return page;
}

function itemsOf(page) {
  return page.evaluate(() => window.deadlineDesk.items.list());
}

function assistantInput(page, text) {
  return page.fill('#assistantInput', text);
}

function submitAssistant(page) {
  return page.click('#assistantSubmit');
}

function waitAssistant(page, selector) {
  return page.waitForSelector(selector, { timeout: 5000 });
}

function waitAssistantConfig(page, expected = 'ready') {
  return page.waitForFunction(
    value => document.querySelector('#assistantConfigWarning')?.dataset.config === value,
    expected,
    { timeout: 5000 }
  );
}

function waitAssistantRecordCount(page, count) {
  return page.waitForFunction(
    amount => document.querySelectorAll('.assistant-record').length >= amount,
    count,
    { timeout: 5000 }
  );
}

function waitAssistantText(page, selector, text) {
  return page.waitForFunction(
    args => (document.querySelector(args[0])?.innerText || '').includes(args[1]),
    [selector, text],
    { timeout: 5000 }
  );
}

async function pollAssistant(predicate, timeoutMs = 5000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error('等待助手条件超时');
}

async function resetAssistant(page, expected = 'ready') {
  await page.click('.nav-item[data-page="settings"]');
  await page.click('.nav-item[data-page="assistant"]');
  await waitAssistantConfig(page, expected);
}

function assistantResultText(page) {
  return page.innerText('#assistantResult');
}

async function fillAssistantField(page, selector, value) {
  await page.fill(selector, value);
  await page.evaluate(target => {
    const element = document.querySelector(target);
    if (element) element.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector);
}

async function setAssistantFieldValue(page, selector, value) {
  await page.evaluate(args => {
    const element = document.querySelector(args[0]);
    if (!element) throw new Error(`字段不存在：${args[0]}`);
    const prototype = element instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
    setter.call(element, args[1]);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, [selector, value]);
}

function updateItemThroughIpc(page, id, overrides = {}) {
  return page.evaluate(async args => {
    const items = await window.deadlineDesk.items.list();
    const item = items.find(entry => entry.id === args.id);
    if (!item) throw new Error(`事项 ${args.id} 不存在`);
    await window.deadlineDesk.items.update(args.id, {
      kind: item.kind,
      title: item.title,
      description: item.description,
      deadline: item.deadline,
      status: item.status,
      workType: item.work_type,
      ...args.overrides
    });
  }, { id, overrides });
}

async function runStageA(electronApp, mock, pageErrors) {
  const page = await openStagePage(electronApp, pageErrors);
  const itemsBefore = await snapshotItems(page);

  const initialAi = await readAi(page);
  assert(
    initialAi.configured === false && initialAi.endpoint === '' && initialAi.model === '' && initialAi.keyMask === '',
    `默认 AI 配置应全空，实际 ${JSON.stringify(initialAi)}`
  );
  passCheck(1);

  const saved = await saveAi(page, { endpoint: mockEndpoint, model, apiKey });
  assert(saved.ok === true, '保存完整 AI 配置应成功');
  assert(saved.ai.configured === true, '保存完整配置后 configured 应为 true');
  assert(saved.ai.keyMask === expectedKeyMask, `Key 掩码应为 ${expectedKeyMask}，实际 ${saved.ai.keyMask}`);
  assert(!JSON.stringify(saved).includes(apiKey), '保存返回结果不得包含完整 Key');
  passCheck(2);

  const cleared = await saveAi(page, { endpoint: '', model: '' });
  assert(cleared.ok === true && cleared.ai.configured === false, '清空地址后 configured 应为 false');
  assert(cleared.ai.keyMask === expectedKeyMask, '省略 apiKey 应保留旧 Key 掩码');
  const restoredAi = await saveAi(page, { endpoint: mockEndpoint, model });
  assert(restoredAi.ok === true && restoredAi.ai.configured === true, '恢复地址后 configured 应为 true');
  passCheck(3);

  const invalidPayloads = [
    { endpoint: 123, model },
    { endpoint: mockEndpoint, model: null },
    { endpoint: mockEndpoint, model, apiKey: {} },
    null,
    []
  ];
  for (const payload of invalidPayloads) {
    const result = await saveAi(page, payload);
    assert(result.ok === false && result.message === 'AI 配置格式不正确', `非法 payload 应返回格式错误，实际 ${JSON.stringify(result)}`);
  }
  passCheck(4);

  for (const endpoint of ['ftp://x', 'not a url']) {
    const result = await saveAi(page, { endpoint, model });
    assert(result.ok === false && result.message.includes('http/https'), '非法接口地址应被拒绝');
  }
  const afterInvalidEndpoint = await readAi(page);
  assert(afterInvalidEndpoint.endpoint === mockEndpoint && afterInvalidEndpoint.configured === true, '校验失败的地址不应落库');

  await mock.resetMock();
  await saveAi(page, { endpoint: '', model: '' });
  const withoutConfig = await parse(page, 'MOCK_CREATE');
  assert(withoutConfig.ok === false && withoutConfig.code === 'not_configured' && withoutConfig.retryable === false, '缺配置应返回 not_configured');
  assert(mock.requests.length === 0, '缺配置时不得发起模型请求');
  await saveAi(page, { endpoint: '', model });
  const withoutEndpoint = await parse(page, 'MOCK_CREATE');
  assert(withoutEndpoint.ok === false && withoutEndpoint.code === 'not_configured', '缺地址应返回 not_configured');
  assert(mock.requests.length === 0, '缺地址时不得发起模型请求');
  await saveAi(page, { endpoint: mockEndpoint, model });

  await mock.resetMock();
  for (const value of [null, 123, {}, '', '   ']) {
    const result = await parse(page, value);
    assert(result.ok === false && result.code === 'invalid_input' && result.message === '请输入要处理的内容', `非法输入应返回 invalid_input，实际 ${JSON.stringify(result)}`);
  }
  const tooLong = await parse(page, 'x'.repeat(3001));
  assert(tooLong.ok === false && tooLong.code === 'invalid_input' && tooLong.message.includes('3000'), '超长输入应返回长度提示');
  assert(mock.requests.length === 0, '输入校验失败时不得发起模型请求');
  passCheck(7);

  await mock.resetMock();
  for (const key of ['MOCK_FENCE', 'MOCK_ARRAY']) {
    const result = await parse(page, key);
    assert(result.ok === true && result.intent === 'clarify', `${key} 无 create 块应归一为 clarify，实际 ${JSON.stringify(result)}`);
    assert(result.message === '没有识别到可新增的事项。', `${key} 空计划文案不正确：${result.message}`);
    for (const field of ['create', 'update', 'delete', 'cleanup', 'query']) {
      assert(!(field in result), `${key} clarify 结果不应包含计划字段 ${field}`);
    }
    assert(result.omittedCount === 0, '空数据时 omittedCount 应为 0');
  }
  passCheck(10);

  const multi = await parse(page, 'MOCK_MULTI');
  assert(multi.ok === true && multi.intent === 'clarify', '多意图应归一化为 clarify');
  assert(multi.message.includes('新增') && multi.message.includes('删除') && multi.message.includes('拆开'), `多意图文案不正确：${multi.message}`);
  assert(!('create' in multi) && !('delete' in multi) && !('query' in multi), 'clarify 结果不应包含计划字段');
  const multiEmpty = await parse(page, 'MOCK_MULTI_EMPTY');
  assert(multiEmpty.ok === true && multiEmpty.intent === 'clarify', '无类别多意图应返回 clarify');
  assert(multiEmpty.message.includes('多类操作') && multiEmpty.message.includes('拆开'), `无类别多意图文案不正确：${multiEmpty.message}`);
  assert(!('create' in multiEmpty) && !('query' in multiEmpty), 'clarify 结果不应包含计划字段');
  passCheck(11);

  const unknown = await parse(page, 'MOCK_UNKNOWN');
  assert(unknown.ok === true && unknown.intent === 'clarify', '未知意图应返回 clarify');
  assert(unknown.message === '没有理解这条指令，请换一种说法或补充信息。', `未知意图文案不正确：${unknown.message}`);
  passCheck(12);

  const unsupported = await parse(page, 'MOCK_UNSUPPORTED');
  assert(unsupported.ok === true && unsupported.intent === 'unsupported', '越界意图应返回 unsupported');
  assert(unsupported.message === '不支持生成周报。', `越界文案不正确：${unsupported.message}`);
  passCheck(13);

  for (const [key, code, retryable] of [['MOCK_401', 'http_401', false], ['MOCK_429', 'http_429', true], ['MOCK_500', 'http_5xx', true]]) {
    const result = await parse(page, key);
    assert(result.ok === false && result.code === code && result.retryable === retryable, `${key} 应映射为 ${code}（retryable=${retryable}），实际 ${JSON.stringify(result)}`);
    const text = JSON.stringify(result);
    assert(!text.includes(apiKey) && !text.includes(mockEndpoint) && !text.includes('secret-body'), `${key} 错误对象泄露了敏感信息`);
  }
  passCheck(14);

  for (const [key, code] of [['MOCK_EMPTY', 'empty_response'], ['MOCK_NOT_JSON', 'invalid_response'], ['MOCK_LENGTH', 'invalid_response'], ['MOCK_NO_CHOICES', 'invalid_response']]) {
    const result = await parse(page, key);
    assert(result.ok === false && result.code === code && result.retryable === true, `${key} 应映射为 ${code}，实际 ${JSON.stringify(result)}`);
  }
  passCheck(15);

  await mock.resetMock();
  const startedAt = Date.now();
  const slow = await parse(page, 'MOCK_SLOW');
  const elapsed = Date.now() - startedAt;
  assert(elapsed < 1200, `超时用例应在 1200ms 内返回，实际 ${elapsed}ms`);
  assert(slow.ok === false && slow.code === 'timeout' && slow.retryable === true, `超时应返回 timeout，实际 ${JSON.stringify(slow)}`);
  passCheck(16);

  await saveAi(page, { endpoint: 'http://127.0.0.1:1/v1/chat/completions', model });
  await mock.resetMock();
  const network = await parse(page, 'MOCK_CREATE');
  assert(network.ok === false && network.code === 'network' && network.retryable === true, `连接失败应返回 network，实际 ${JSON.stringify(network)}`);
  await saveAi(page, { endpoint: mockEndpoint, model });
  passCheck(17);

  const hidden = await electronApp.evaluate(async ({ BrowserWindow }, args) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: args.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    await win.loadFile(args.indexPath);
    const parsed = await win.webContents.executeJavaScript('window.deadlineDesk.assistant.parse("MOCK_CREATE")');
    const saved = await win.webContents.executeJavaScript('window.deadlineDesk.settings.saveAi({ endpoint: "", model: "" })');
    win.destroy();
    return { parsed, saved };
  }, { preloadPath: path.join(projectDir, 'preload.js'), indexPath: path.join(projectDir, 'src', 'index.html') });
  assert(hidden.parsed.ok === false && hidden.parsed.code === 'forbidden', `隐藏窗口调用应被拒绝，实际 ${JSON.stringify(hidden.parsed)}`);
  assert(hidden.saved.ok === false && hidden.saved.message === '当前窗口无权执行该操作', `隐藏窗口保存应被拒绝，实际 ${JSON.stringify(hidden.saved)}`);
  const mainStillWorks = await parse(page, 'MOCK_CREATE');
  assert(mainStillWorks.ok === true && mainStillWorks.intent === 'create', '隐藏窗口销毁后主窗口调用应正常');
  passCheck(22);

  const itemsAfter = await snapshotItems(page);
  assert(itemsAfter === itemsBefore, '阶段 A 助手调用改动了事项数据');
}

async function runStageB(electronApp, mock, pageErrors) {
  const page = await openStagePage(electronApp, pageErrors);
  const itemsBefore = await snapshotItems(page);

  const ai = await readAi(page);
  assert(ai.configured === true, '重启后 AI 配置应保持');
  assert(ai.keyMask === expectedKeyMask, '重启后 Key 掩码应保持');
  await mock.resetMock();
  const parsed = await parse(page, 'MOCK_CREATE');
  assert(parsed.ok === true && parsed.intent === 'create', '重启后解析应正常');

  await mock.resetMock();
  const thisMonth = await parse(page, 'MOCK_QUERY_THIS_MONTH');
  assert(thisMonth.ok === true && thisMonth.intent === 'query', '查询意图应返回 query');
  const meta = thisMonth.query.meta;
  const now = new Date();
  const monthEndDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const expectedMonthLabel = `${now.getFullYear()}年${now.getMonth() + 1}月1日–${now.getMonth() + 1}月${monthEndDay}日`;
  assert(thisMonth.query.answer === '按截止时间在本月内：已完成 1 个。', `查询答复不正确：${thisMonth.query.answer}`);
  assert(thisMonth.query.fallback === false, '查询成功时 fallback 应为 false');
  assert(meta.rangeLabel === expectedMonthLabel, `本月范围标签不正确：${meta.rangeLabel}`);
  assert(meta.counts.total === 2, `本月事项总数应为 2，实际 ${meta.counts.total}`);
  assert(meta.counts.assignment.total === 1 && meta.counts.assignment.completed === 1, '大作业统计不正确');
  assert(meta.counts.activity.total === 1 && meta.counts.activity.pending === 1, '活动统计不正确');
  assert(meta.entries.length === 1 && meta.entries[0].id === 1, '已完成条目应只有 id 1');
  assert(mock.requests.length === 2, `查询应调用模型两次，实际 ${mock.requests.length}`);
  passCheck(18);

  await mock.resetMock();
  const fallback = await parse(page, 'MOCK_QUERY_FALLBACK');
  assert(fallback.ok === true && fallback.intent === 'query', '兜底查询应返回 query');
  assert(fallback.query.fallback === true, '第二次调用失败时 fallback 应为 true');
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const expectedLastMonthLabel = `${lastMonthStart.getFullYear()}年${lastMonthStart.getMonth() + 1}月1日–${lastMonthStart.getMonth() + 1}月${lastMonthEnd.getDate()}日`;
  assert(fallback.query.meta.rangeLabel === expectedLastMonthLabel, `上月范围标签不正确：${fallback.query.meta.rangeLabel}`);
  assert(fallback.query.answer.includes('按截止时间'), '兜底答复应说明「按截止时间」');
  assert(fallback.query.answer.includes(expectedLastMonthLabel), '兜底答复应包含上月范围标签');
  assert(fallback.query.meta.counts.total === 1 && fallback.query.meta.counts.assignment.completed === 1, '上月统计不正确');
  assert(mock.requests.length === 2, `兜底查询应调用模型两次，实际 ${mock.requests.length}`);
  passCheck(19);

  await mock.resetMock();
  const noRange = await parse(page, 'MOCK_QUERY_NO_RANGE');
  assert(noRange.ok === true && noRange.intent === 'clarify', '缺范围查询应返回 clarify');
  assert(noRange.message.includes('补充时间范围'), `缺范围文案不正确：${noRange.message}`);
  assert(mock.requests.length === 1, `缺范围查询只应调用模型一次，实际 ${mock.requests.length}`);
  passCheck(20);

  const itemsAfter = await snapshotItems(page);
  assert(itemsAfter === itemsBefore, '阶段 B 助手调用改动了事项数据');
}

async function runStageC(electronApp, mock, pageErrors) {
  const page = await openStagePage(electronApp, pageErrors);
  const itemsBefore = await snapshotItems(page);

  const ai = await readAi(page);
  assert(ai.endpoint === 'ftp://x' && ai.configured === false, `非法地址应以未配置呈现，实际 ${JSON.stringify(ai)}`);
  assert(ai.keyMask === expectedKeyMask, '非法地址不应影响 Key 掩码');
  await mock.resetMock();
  const invalidEndpoint = await parse(page, 'MOCK_CREATE');
  assert(invalidEndpoint.ok === false && invalidEndpoint.code === 'invalid_endpoint' && invalidEndpoint.retryable === false, `非法地址解析应返回 invalid_endpoint，实际 ${JSON.stringify(invalidEndpoint)}`);
  assert(mock.requests.length === 0, '非法地址时不得发起模型请求');
  const restored = await saveAi(page, { endpoint: mockEndpoint, model });
  assert(restored.ok === true, '恢复合法地址应成功');
  passCheck(5);

  const restoredAi = await readAi(page);
  assert(restoredAi.keyMask === expectedKeyMask, '恢复地址后 Key 掩码应保持');
  assert(restoredAi.configured === true, '恢复地址后应为已配置');
  const restoredParse = await parse(page, 'MOCK_CREATE');
  assert(restoredParse.ok === true && restoredParse.intent === 'create', '恢复地址后解析应正常');
  passCheck(23);

  await mock.resetMock();
  const result = await parse(page, 'MOCK_CREATE');
  assert(mock.requests.length === 1, `非查询意图应只调用模型一次，实际 ${mock.requests.length}`);
  const request = mock.requests[0];
  assert(request.method === 'POST', '模型请求方法应为 POST');
  assert(request.url === mockEndpoint, `模型请求地址不正确：${request.url}`);
  assert(request.headers.authorization === `Bearer ${apiKey}`, 'Authorization 头不正确');
  const bodyKeys = Object.keys(request.body).sort();
  assert(bodyKeys.join(',') === 'messages,model,temperature', `请求体顶层字段不正确：${bodyKeys.join(',')}`);
  assert(request.body.model === model && request.body.temperature === 0, '请求体 model/temperature 不正确');
  for (const forbidden of ['stream', 'response_format', 'tools', 'functions', 'max_tokens']) {
    assert(!(forbidden in request.body), `请求体不得包含 ${forbidden}`);
  }
  assert(Array.isArray(request.body.messages) && request.body.messages.length === 2, 'messages 应恰有两条');
  const [systemMessage, userMessage] = request.body.messages;
  assert(systemMessage.role === 'system', '首条消息应为 system');
  assert(systemMessage.content.includes('intent') && systemMessage.content.includes('detectedIntents'), 'system 提示词缺少 intent / detectedIntents');
  assert(userMessage.role === 'user', '次条消息应为 user');
  const userPayload = JSON.parse(userMessage.content);
  assert(Object.keys(userPayload).join(',') === 'now,items,input', `user 消息顶层字段不正确：${Object.keys(userPayload).join(',')}`);
  assert(Object.keys(userPayload.now).join(',') === 'date,weekday,time', 'now 字段不正确');
  assert(/^星期[一二三四五六日]$/.test(userPayload.now.weekday), `weekday 格式不正确：${userPayload.now.weekday}`);
  assert(userPayload.input === 'MOCK_CREATE', 'user 消息 input 不正确');
  assert(userPayload.items.length === 100, `摘要条数应为 100，实际 ${userPayload.items.length}`);
  for (const item of userPayload.items) {
    assert(Object.keys(item).join(',') === 'id,title,kind,deadline,status', `摘要条目字段不正确：${Object.keys(item).join(',')}`);
  }
  for (const word of ['description', 'work_type', 'workType', 'attachments']) {
    assert(!userMessage.content.includes(word), `user 消息不得包含 ${word}`);
  }
  passCheck(8);

  assert(result.ok === true && result.intent === 'create', '阶段 C 解析应成功');
  assert(result.omittedCount === 5, `omittedCount 应为 5，实际 ${result.omittedCount}`);
  const sentItems = userPayload.items;
  assert(sentItems.every(item => item.status !== 'completed'), '前 100 条摘要应全为未完成事项');
  assert(sentItems.map(item => item.id).join(',') === Array.from({ length: 100 }, (_value, index) => index + 1).join(','), '摘要应按 id 升序为 1..100');
  assert(sentItems[0].deadline === `${localDate(1)} 23:59`, `首条摘要截止时间不正确：${sentItems[0].deadline}`);
  passCheck(9);

  const itemsAfter = await snapshotItems(page);
  assert(itemsAfter === itemsBefore, '阶段 C 助手调用改动了事项数据');
}

async function runStageD(electronApp, mock, pageErrors) {
  const page = await openStagePage(electronApp, pageErrors);
  const itemsBefore = await snapshotItems(page);

  const ai = await readAi(page);
  assert(ai.configured === false, '缺少 Key 时应为未配置');
  assert(ai.keyMask === '', `缺少 Key 时掩码应为空，实际 ${ai.keyMask}`);
  await mock.resetMock();
  const result = await parse(page, 'MOCK_CREATE');
  assert(result.ok === false && result.code === 'not_configured' && result.retryable === false, `缺 Key 应返回 not_configured，实际 ${JSON.stringify(result)}`);
  assert(mock.requests.length === 0, '缺 Key 时不得发起模型请求');
  passCheck(6);

  const itemsAfter = await snapshotItems(page);
  assert(itemsAfter === itemsBefore, '阶段 D 助手调用改动了事项数据');
  passCheck(21);
}

async function runStageE(electronApp, mock, pageErrors) {
  const page = await openStagePage(electronApp, pageErrors);
  const now = new Date();

  const ai = await readAi(page);
  assert(ai.configured === true, `阶段 E 前应已恢复配置，实际 ${JSON.stringify(ai)}`);
  assert(ai.keyMask === expectedKeyMask, `阶段 E Key 掩码应为 ${expectedKeyMask}，实际 ${ai.keyMask}`);

  const itemsBefore = await snapshotItems(page);
  const settingsBefore = await snapshotSettings(page);

  const create = await parse(page, 'MOCK_PLAN_CREATE');
  assert(create.ok === true && create.intent === 'create', `新增计划应返回 create，实际 ${JSON.stringify(create)}`);
  assert(create.message === '已整理出候选', `新增计划说明不正确：${create.message}`);
  assert(create.omittedCount === 0, `新增计划 omittedCount 不正确：${create.omittedCount}`);
  assert(create.create.candidates.length === 4, `候选数量应为 4，实际 ${create.create.candidates.length}`);
  assert(
    create.create.candidates.map(item => item.rowId).join(',') === 'c0,c1,c2,c3',
    `rowId 顺序不正确：${create.create.candidates.map(item => item.rowId).join(',')}`
  );
  const [c0, c1, c2, c3] = create.create.candidates;
  assert(c0.duplicate !== null && c0.duplicate.id === 1, `c0 应命中样本 id 1，实际 ${JSON.stringify(c0.duplicate)}`);
  assert(c0.duplicate.title === '数据库课程设计', `c0 命中标题不正确：${c0.duplicate.title}`);
  assert(c0.duplicate.deadline === `${localDate(3)} 23:59`, `c0 命中截止时间不正确：${c0.duplicate.deadline}`);
  assert(c0.selected === false && c0.executable === true && c0.workType === 'team', `c0 勾选/可执行/协作类型不正确：${JSON.stringify(c0)}`);
  assert(c1.selected === true && c1.duplicate === null, `c1 默认勾选或重复判定不正确：${JSON.stringify(c1)}`);
  assert(
    c1.workType === null && c1.deadline === `${localDate(2)} 20:00` && c1.status === 'not_completed' && c1.executable === true,
    `c1 字段不正确：${JSON.stringify(c1)}`
  );
  assert(c2.expired === true && c2.selected === true && c2.duplicate === null && c2.executable === true, `c2 过期用例不正确：${JSON.stringify(c2)}`);
  assert(
    c3.deadlineIssue === 'missing' && c3.deadline === null && c3.executable === false && c3.selected === false && c3.status === 'not_started',
    `c3 缺时间用例不正确：${JSON.stringify(c3)}`
  );
  assert(create.create.ignored.length === 2, `ignored 数量应为 2，实际 ${create.create.ignored.length}`);
  assert(
    create.create.ignored[0].text === '随手一提' && create.create.ignored[0].reason === '没有明确标题',
    `ignored[0] 不正确：${JSON.stringify(create.create.ignored[0])}`
  );
  assert(
    create.create.ignored[1].text === '随手记一下' && create.create.ignored[1].reason === '事项类型无效',
    `ignored[1] 不正确：${JSON.stringify(create.create.ignored[1])}`
  );
  passCheck(25);

  const update = await parse(page, 'MOCK_PLAN_UPDATE');
  assert(update.ok === true && update.intent === 'update', `修改计划应返回 update，实际 ${JSON.stringify(update)}`);
  assert(
    update.update.targets.length === 1 && update.update.applyToId === 1 && update.update.ambiguous === false,
    `修改计划目标解析不正确：${JSON.stringify(update.update)}`
  );
  assert(update.update.changes.deadline === `${localDate(6)} 23:59`, `修改计划截止时间不正确：${update.update.changes.deadline}`);
  assert(
    update.update.changes.status === 'in_progress'
    && update.update.changes.description === '新说明'
    && update.update.changes.title === '数据库课程设计（改）',
    `修改计划字段不正确：${JSON.stringify(update.update.changes)}`
  );
  assert(
    update.update.statusInvalid === false && update.update.deadlineInvalid === false,
    `修改计划不应有非法标记：${JSON.stringify(update.update)}`
  );
  assert(update.message.includes('已找到目标'), `修改计划说明不正确：${update.message}`);
  assert(update.update.message === update.message, '修改计划的 update.message 应与顶层 message 相同');

  const invalidUpdate = await parse(page, 'MOCK_PLAN_UPDATE_INVALID');
  assert(invalidUpdate.ok === true && invalidUpdate.intent === 'update', `非法字段修改应仍返回 update，实际 ${JSON.stringify(invalidUpdate)}`);
  assert(
    invalidUpdate.update.targets.length === 1 && invalidUpdate.update.targets[0].id === 2 && invalidUpdate.update.applyToId === 2,
    `非法字段修改目标不正确：${JSON.stringify(invalidUpdate.update)}`
  );
  assert(
    invalidUpdate.update.deadlineInvalid === true && invalidUpdate.update.changes.deadline === null,
    `非法截止时间应标记 deadlineInvalid：${JSON.stringify(invalidUpdate.update)}`
  );
  assert(
    invalidUpdate.update.statusInvalid === true
    && Object.prototype.hasOwnProperty.call(invalidUpdate.update.changes, 'status') === true
    && invalidUpdate.update.changes.status === null,
    `非法状态应标记 statusInvalid：${JSON.stringify(invalidUpdate.update)}`
  );
  passCheck(26);

  const remove = await parse(page, 'MOCK_PLAN_DELETE');
  assert(remove.ok === true && remove.intent === 'delete', `删除计划应返回 delete，实际 ${JSON.stringify(remove)}`);
  assert(
    remove.delete.targets.map(target => target.id).join(',') === '3,2,4',
    `删除计划目标顺序不正确：${remove.delete.targets.map(target => target.id).join(',')}`
  );
  const [target3, target2, target4] = remove.delete.targets;
  assert(target3.isAmbiguous === true && target3.selected === false, `id 3 同名歧义判定不正确：${JSON.stringify(target3)}`);
  assert(target4.isAmbiguous === true && target4.selected === false, `id 4 同名歧义判定不正确：${JSON.stringify(target4)}`);
  assert(target2.selected === true, `id 2 唯一点名应默认勾选：${JSON.stringify(target2)}`);
  passCheck(27);

  const cleanup = await parse(page, 'MOCK_PLAN_CLEANUP');
  assert(cleanup.ok === true && cleanup.intent === 'cleanup', `清理计划应返回 cleanup，实际 ${JSON.stringify(cleanup)}`);
  assert(
    cleanup.cleanup.targets.length === 1 && cleanup.cleanup.targets[0].id === 5 && cleanup.cleanup.targets[0].selected === true,
    `上月清理目标不正确：${JSON.stringify(cleanup.cleanup)}`
  );
  assert(!cleanup.cleanup.targets.some(target => target.id === 6 || target.id === 7), '上月清理不应包含未完成或本月事项');
  assert(cleanup.message === '', `无说明的清理计划 message 应为空，实际 ${cleanup.message}`);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const expectedLastMonthLabel = `${lastMonthStart.getFullYear()}年${lastMonthStart.getMonth() + 1}月1日–${lastMonthStart.getMonth() + 1}月${lastMonthEnd.getDate()}日`;
  assert(cleanup.cleanup.rangeLabel === expectedLastMonthLabel, `上月范围标签不正确：${cleanup.cleanup.rangeLabel}`);
  assert(
    cleanup.cleanup.range.start === formatYmd(lastMonthStart) && cleanup.cleanup.range.end === formatYmd(lastMonthEnd),
    `上月范围边界不正确：${JSON.stringify(cleanup.cleanup.range)}`
  );

  const emptyCleanup = await parse(page, 'MOCK_PLAN_CLEANUP_EMPTY');
  assert(emptyCleanup.ok === true && emptyCleanup.intent === 'cleanup', `空结果清理应返回 cleanup，实际 ${JSON.stringify(emptyCleanup)}`);
  assert(emptyCleanup.cleanup.targets.length === 0, `下月清理目标应为空，实际 ${JSON.stringify(emptyCleanup.cleanup.targets)}`);
  assert(emptyCleanup.message === '没有符合条件的已完成事项。', `空结果文案不正确：${emptyCleanup.message}`);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  const expectedNextMonthLabel = `${nextMonthStart.getFullYear()}年${nextMonthStart.getMonth() + 1}月1日–${nextMonthStart.getMonth() + 1}月${nextMonthEnd.getDate()}日`;
  assert(emptyCleanup.cleanup.rangeLabel === expectedNextMonthLabel, `下月范围标签不正确：${emptyCleanup.cleanup.rangeLabel}`);
  assert(
    emptyCleanup.cleanup.range.start === formatYmd(nextMonthStart) && emptyCleanup.cleanup.range.end === formatYmd(nextMonthEnd),
    `下月范围边界不正确：${JSON.stringify(emptyCleanup.cleanup.range)}`
  );
  passCheck(28);

  const itemsAfter = await snapshotItems(page);
  const settingsAfter = await snapshotSettings(page);
  assert(itemsAfter === itemsBefore, '阶段 E 写意图计划改动了事项数据');
  assert(settingsAfter === settingsBefore, '阶段 E 写意图计划改动了设置数据');
  passCheck(29);

  for (const [key, code, retryable] of [
    ['MOCK_400', 'http_400', false],
    ['MOCK_404', 'http_404', false],
    ['MOCK_418', 'http_other', true]
  ]) {
    const result = await parse(page, key);
    assert(result.ok === false && result.code === code && result.retryable === retryable, `${key} 应映射为 ${code}（retryable=${retryable}），实际 ${JSON.stringify(result)}`);
    const text = JSON.stringify(result);
    assert(!text.includes(apiKey) && !text.includes(mockEndpoint) && !text.includes('secret-body'), `${key} 错误对象泄露了敏感信息`);
  }
  passCheck(30);
}

async function runStageF(electronApp, mock, pageErrors) {
  const page = await openStagePage(electronApp, pageErrors);
  const now = new Date();
  await page.click('.nav-item[data-page="assistant"]');
  await waitAssistantConfig(page, 'ready');

  const navOrder = await page.evaluate(() => [...document.querySelectorAll('.sidebar-bottom .nav-item[data-page]')].map(button => button.dataset.page));
  assert(navOrder.join(',') === 'assistant,settings', `侧边栏底部导航顺序不正确：${navOrder.join(',')}`);
  const navInfo = await page.evaluate(() => {
    const button = document.querySelector('.sidebar-bottom .nav-item[data-page="assistant"]');
    return { text: button.innerText.trim(), hasCount: Boolean(button.querySelector('.nav-count')) };
  });
  assert(navInfo.text === '助手' && navInfo.hasCount === false, `助手入口文案或角标不正确：${JSON.stringify(navInfo)}`);
  const structure = await page.evaluate(() => ({
    input: Boolean(document.querySelector('#assistantInput')),
    submit: Boolean(document.querySelector('#assistantSubmit')),
    counter: Boolean(document.querySelector('#assistantCounter')),
    result: Boolean(document.querySelector('#assistantResult')),
    records: Boolean(document.querySelector('#assistantRecords')),
    maxlength: document.querySelector('#assistantInput')?.getAttribute('maxlength'),
    privacy: document.querySelector('.assistant-privacy')?.innerText || '',
    searchHidden: document.querySelector('#searchBox')?.classList.contains('hidden'),
    warningHidden: document.querySelector('#assistantConfigWarning')?.classList.contains('hidden')
  }));
  assert(structure.input && structure.submit && structure.counter && structure.result && structure.records, '助手页必需节点缺失');
  assert(structure.maxlength === null, '助手输入框不应设置 maxlength');
  assert(structure.privacy.includes('会发送') && structure.privacy.includes('不会发送'), '隐私说明缺少发送/不发送字段清单');
  assert(structure.searchHidden === true, '助手页应隐藏搜索框');
  assert(structure.warningHidden === true, '已配置时配置提示应隐藏');
  const aiReady = await readAi(page);
  assert(aiReady.configured === true, `助手页前置配置应为已配置，实际 ${JSON.stringify(aiReady)}`);
  passCheck(31);

  await assistantInput(page, 'MOCK_UI_CREATE');
  await submitAssistant(page);
  await waitAssistant(page, '[data-row-id="c0"]');
  const rows32 = await page.evaluate(() => [...document.querySelectorAll('#assistantResult .assistant-row[data-row-id]')].map(row => ({
    rowId: row.dataset.rowId,
    checked: row.querySelector('input[data-assistant-field="selected"]').checked,
    disabled: row.querySelector('input[data-assistant-field="selected"]').disabled,
    duplicate: Boolean(row.querySelector('.assistant-badge.duplicate')),
    expired: Boolean(row.querySelector('.assistant-badge.expired')),
    missing: Boolean(row.querySelector('.assistant-badge.missing'))
  })));
  assert(rows32.map(row => row.rowId).join(',') === 'c0,c1,c2,c3', `可见候选顺序不正确：${rows32.map(row => row.rowId).join(',')}`);
  assert(rows32[0].duplicate === true && rows32[0].checked === false, `c0 应疑似重复且未勾选：${JSON.stringify(rows32[0])}`);
  assert(rows32[1].checked === true && rows32[1].duplicate === false, `c1 应默认勾选且无重复徽标：${JSON.stringify(rows32[1])}`);
  assert(rows32[2].expired === true && rows32[2].checked === true, `c2 应已过期且默认勾选：${JSON.stringify(rows32[2])}`);
  assert(rows32[3].missing === true && rows32[3].disabled === true && rows32[3].checked === false, `c3 应待补全且不可勾选：${JSON.stringify(rows32[3])}`);
  const ignoredCount32 = await page.evaluate(() => document.querySelectorAll('.assistant-ignored-item').length);
  assert(ignoredCount32 === 1, `ignored 数量应为 1，实际 ${ignoredCount32}`);
  const ignoredText32 = await page.innerText('.assistant-ignored');
  assert(ignoredText32.includes('随手一提') && ignoredText32.includes('没有明确标题'), `ignored 文案不正确：${ignoredText32}`);
  const writeText32 = await page.innerText('[data-assistant-action="write-create"]');
  assert(writeText32 === '写入 2 条', `写入按钮文案不正确：${writeText32}`);
  const omittedCount32 = await page.evaluate(() => document.querySelectorAll('.assistant-omitted').length);
  assert(omittedCount32 === 0, 'omittedCount 为 0 时不应渲染省略提示');

  await page.selectOption('[data-row-id="c1"] select[data-assistant-field="kind"]', 'assignment');
  const switchedToAssignment32 = await page.evaluate(() => {
    const row = document.querySelector('[data-row-id="c1"]');
    const status = row.querySelector('select[data-assistant-field="status"]');
    return {
      status: status.value,
      options: [...status.options].map(option => option.textContent),
      adjusted: Boolean(row.querySelector('.assistant-badge.status-adjusted')),
      workTypeHidden: row.querySelector('.assistant-worktype').classList.contains('hidden'),
      workType: row.querySelector('select[data-assistant-field="workType"]')?.value,
      checked: row.querySelector('input[data-assistant-field="selected"]').checked
    };
  });
  assert(switchedToAssignment32.status === 'not_started', `切换为大作业后状态应收敛为 not_started：${JSON.stringify(switchedToAssignment32)}`);
  assert(switchedToAssignment32.options.join(',') === '未开始,进行中,已完成', `切换为大作业后状态选项不正确：${switchedToAssignment32.options.join(',')}`);
  assert(switchedToAssignment32.adjusted === true, '原状态不适用时应显示「状态已重置」徽标');
  assert(switchedToAssignment32.workTypeHidden === false && switchedToAssignment32.workType === 'personal', `切换为大作业应补全个人/团队：${JSON.stringify(switchedToAssignment32)}`);
  assert(switchedToAssignment32.checked === true, '切换类型后原已勾选候选应保持勾选');

  await page.selectOption('[data-row-id="c1"] select[data-assistant-field="kind"]', 'activity');
  const switchedBack32 = await page.evaluate(() => {
    const row = document.querySelector('[data-row-id="c1"]');
    const status = row.querySelector('select[data-assistant-field="status"]');
    return {
      status: status.value,
      options: [...status.options].map(option => option.textContent),
      workTypeHidden: row.querySelector('.assistant-worktype').classList.contains('hidden'),
      adjusted: Boolean(row.querySelector('.assistant-badge.status-adjusted'))
    };
  });
  assert(switchedBack32.status === 'not_completed' && switchedBack32.options.join(',') === '未完成,已完成', `切回活动后状态选项不正确：${JSON.stringify(switchedBack32)}`);
  assert(switchedBack32.workTypeHidden === true, '活动候选应隐藏个人/团队字段');
  assert(switchedBack32.adjusted === true, '切回活动后仍应显示「状态已重置」徽标');

  const longTitle32 = '长'.repeat(121);
  await setAssistantFieldValue(page, '[data-row-id="c1"] input[data-assistant-field="title"]', longTitle32);
  await setAssistantFieldValue(page, '[data-row-id="c2"] input[data-assistant-field="title"]', longTitle32);
  const tooLong32 = await page.evaluate(() => ({
    badges: document.querySelectorAll('[data-row-id="c1"] .assistant-badge.title-too-long, [data-row-id="c2"] .assistant-badge.title-too-long').length,
    text: document.querySelector('[data-assistant-action="write-create"]').textContent.trim(),
    disabled: document.querySelector('[data-assistant-action="write-create"]').disabled,
    reason: document.querySelector('.assistant-reason').innerText.trim()
  }));
  assert(tooLong32.badges === 2, `超长标题应出现「标题过长」徽标，实际 ${tooLong32.badges}`);
  assert(tooLong32.disabled === true && tooLong32.reason === '标题超过 120 字符，请缩短后再保存', `超长标题禁用原因不正确：${JSON.stringify(tooLong32)}`);

  await fillAssistantField(page, '[data-row-id="c1"] input[data-assistant-field="title"]', '校园摄影比赛');
  await fillAssistantField(page, '[data-row-id="c2"] input[data-assistant-field="title"]', '补录旧作业');
  const restoredTitle32 = await page.evaluate(() => ({
    text: document.querySelector('[data-assistant-action="write-create"]').textContent.trim(),
    disabled: document.querySelector('[data-assistant-action="write-create"]').disabled,
    badge: Boolean(document.querySelector('.assistant-badge.title-too-long'))
  }));
  assert(restoredTitle32.badge === false, '恢复标题后应移除「标题过长」徽标');
  assert(restoredTitle32.text === '写入 2 条' && restoredTitle32.disabled === false, `恢复标题后按钮不正确：${JSON.stringify(restoredTitle32)}`);
  passCheck(32);

  const countsBefore33 = await page.evaluate(() => ({
    activity: document.querySelector('#activityCount').innerText,
    activityTotal: document.querySelector('#activityTotalStat').innerText
  }));
  await page.click('[data-row-id="c2"] input[data-assistant-field="selected"]');
  await waitAssistantText(page, '[data-assistant-action="write-create"]', '写入 1 条');
  await page.click('[data-assistant-action="write-create"]');
  await waitAssistantRecordCount(page, 1);
  const after33 = await page.evaluate(() => ({
    busy: document.querySelector('#assistantResult').innerText.includes('正在处理…'),
    inputDisabled: document.querySelector('#assistantInput').disabled,
    submitDisabled: document.querySelector('#assistantSubmit').disabled,
    submitText: document.querySelector('#assistantSubmit').innerText.trim(),
    activity: document.querySelector('#activityCount').innerText,
    activityTotal: document.querySelector('#activityTotalStat').innerText
  }));
  assert(after33.busy === false, '执行结束后结果区不应停留在加载占位');
  assert(after33.inputDisabled === false && after33.submitDisabled === false, '执行结束后输入与提交应解除禁用');
  assert(after33.submitText === '解析', `执行结束后提交按钮文案不正确：${after33.submitText}`);
  const items33 = await itemsOf(page);
  assert(items33.length === 8, `执行后事项数应为 8，实际 ${items33.length}`);
  assert(items33.filter(item => item.title === '校园摄影比赛').length === 1, '应新增「校园摄影比赛」1 条');
  assert(items33.filter(item => item.title === '数据库课程设计').length === 1, '「数据库课程设计」应仍为 1 条');
  assert(!items33.some(item => item.title === '补录旧作业'), '取消勾选的「补录旧作业」不应写入');
  assert(!items33.some(item => item.title === '缺少时间的作业'), '不可执行的「缺少时间的作业」不应写入');
  assert(Number(after33.activity) === Number(countsBefore33.activity) + 1, `活动导航计数应 +1：${countsBefore33.activity} → ${after33.activity}`);
  assert(Number(after33.activityTotal) === Number(countsBefore33.activityTotal) + 1, `活动统计应 +1：${countsBefore33.activityTotal} → ${after33.activityTotal}`);
  const record33 = await page.innerText('#assistantRecords');
  assert(record33.includes('已新增「校园摄影比赛」'), `记录缺少新增明细：${record33}`);
  assert(record33.includes('新增 1 条（成功 1，失败 0）'), `记录缺少汇总：${record33}`);
  passCheck(33);

  await assistantInput(page, 'MOCK_UI_CREATE_MISSING');
  await submitAssistant(page);
  await waitAssistant(page, '[data-row-id="c0"]');
  const c1Before34 = await page.evaluate(() => {
    const input = document.querySelector('[data-row-id="c1"] input[data-assistant-field="selected"]');
    return { disabled: input.disabled, checked: input.checked };
  });
  assert(c1Before34.disabled === true && c1Before34.checked === false, `缺时间候选应不可勾选：${JSON.stringify(c1Before34)}`);
  await page.fill('[data-row-id="c1"] input[data-assistant-field="deadlineDate"]', localDate(4));
  const c1After34 = await page.evaluate(() => {
    const input = document.querySelector('[data-row-id="c1"] input[data-assistant-field="selected"]');
    return { disabled: input.disabled, checked: input.checked };
  });
  assert(c1After34.disabled === false && c1After34.checked === true, `补全日期后应可勾选且自动勾选：${JSON.stringify(c1After34)}`);
  await page.click('[data-row-id="c2"] [data-assistant-action="remove-row"]');
  const c2Removed34 = await page.evaluate(() => !document.querySelector('[data-row-id="c2"]'));
  assert(c2Removed34 === true, '移除后的候选不应继续渲染');
  await waitAssistantText(page, '[data-assistant-action="write-create"]', '写入 2 条');
  await page.click('[data-assistant-action="write-create"]');
  await waitAssistantRecordCount(page, 2);
  const items34 = await itemsOf(page);
  const normal34 = items34.find(item => item.title === '助手正常候选');
  const pending34 = items34.find(item => item.title === '助手待补全候选');
  assert(Boolean(normal34), '应写入「助手正常候选」');
  assert(Boolean(pending34) && pending34.deadline === `${localDate(4)} 23:59`, `「助手待补全候选」截止时间不正确：${JSON.stringify(pending34)}`);
  assert(!items34.some(item => item.title === '助手移除候选'), '移除候选不应写入');
  passCheck(34);

  await assistantInput(page, 'MOCK_UI_UPDATE');
  await submitAssistant(page);
  await waitAssistant(page, '.assistant-diff-row[data-field="deadline"]');
  const targetDate35 = new Date();
  targetDate35.setDate(targetDate35.getDate() + 2);
  const expectedOld35 = `${targetDate35.getMonth() + 1}月${targetDate35.getDate()}日`;
  const updateOld35 = await page.innerText('.assistant-diff-row[data-field="deadline"] .assistant-old');
  assert(updateOld35.includes(expectedOld35), `diff 旧截止日期不正确：${updateOld35}`);
  const dateValue35 = await page.evaluate(() => document.querySelector('.assistant-diff-row[data-field="deadline"] input[data-assistant-field="deadlineDate"]').value);
  assert(dateValue35 === localDate(6), `diff 新截止日期不正确：${dateValue35}`);

  await page.fill('.assistant-diff-row[data-field="deadline"] input[data-assistant-field="deadlineDate"]', localDate(2));
  const unchanged35 = await page.evaluate(() => ({
    disabled: document.querySelector('[data-assistant-action="save-update"]').disabled,
    reason: document.querySelector('.assistant-reason').innerText.trim()
  }));
  assert(unchanged35.disabled === true && unchanged35.reason === '没有可执行的修改', `改回基线值后禁用原因不正确：${JSON.stringify(unchanged35)}`);
  await page.fill('.assistant-diff-row[data-field="deadline"] input[data-assistant-field="deadlineDate"]', localDate(6));
  const restoredChange35 = await page.evaluate(() => document.querySelector('[data-assistant-action="save-update"]').disabled);
  assert(restoredChange35 === false, '恢复变更后保存按钮应重新可用');

  await updateItemThroughIpc(page, 2, { title: '并发改动' });
  await page.click('[data-assistant-action="save-update"]');
  await waitAssistantRecordCount(page, 1);
  const record35a = await page.innerText('#assistantRecords');
  assert(record35a.includes('「校辩论赛报名」已在其他入口被修改，请重新提交'), `记录缺并发修改拦截明细：${record35a}`);
  assert(record35a.includes('修改 1 条（成功 0，失败 1）'), `并发修改拦截汇总不正确：${record35a}`);
  const item2Concurrent35 = (await itemsOf(page)).find(item => item.id === 2);
  assert(Boolean(item2Concurrent35) && item2Concurrent35.title === '并发改动', `并发修改后执行不得覆盖其他入口的修改：${JSON.stringify(item2Concurrent35)}`);
  assert(item2Concurrent35.deadline === `${localDate(2)} 23:59`, `并发修改被拦截后截止时间不应改变：${item2Concurrent35.deadline}`);

  await resetAssistant(page);
  await assistantInput(page, 'MOCK_UI_UPDATE');
  await submitAssistant(page);
  await waitAssistant(page, '.assistant-diff-row[data-field="deadline"]');
  await page.click('[data-assistant-action="save-update"]');
  await waitAssistantRecordCount(page, 1);
  const items35 = await itemsOf(page);
  const item2After35 = items35.find(item => item.id === 2);
  assert(Boolean(item2After35) && item2After35.deadline === `${localDate(6)} 23:59`, `id 2 截止时间未按预览保存：${JSON.stringify(item2After35)}`);
  assert(item2After35.description === '', `id 2 说明应保持不变：${item2After35.description}`);
  assert(item2After35.title === '并发改动', `id 2 标题应保持最新值：${item2After35.title}`);
  const record35 = await page.innerText('#assistantRecords');
  assert(record35.includes('已保存「并发改动」的修改'), `记录缺修改明细：${record35}`);
  assert(record35.includes('修改 1 条（成功 1，失败 0）'), `记录缺修改汇总：${record35}`);

  await assistantInput(page, 'MOCK_UI_UPDATE_MULTI');
  await submitAssistant(page);
  await waitAssistant(page, '.assistant-target-option');
  const multi35 = await page.evaluate(() => ({
    options: document.querySelectorAll('.assistant-target-option').length,
    checked: [...document.querySelectorAll('#assistantResult input[data-assistant-action="pick-target"]')].filter(input => input.checked).length,
    disabled: document.querySelector('[data-assistant-action="save-update"]').disabled,
    reason: document.querySelector('.assistant-reason').innerText.trim()
  }));
  assert(multi35.options === 2, `多目标选项数量不正确：${multi35.options}`);
  assert(multi35.checked === 0, '多目标默认不应选中任何一项');
  assert(multi35.disabled === true && multi35.reason === '请先选择要修改的事项', `多目标禁用原因不正确：${JSON.stringify(multi35)}`);
  await page.click('#assistantResult input[data-assistant-action="pick-target"]');
  await waitAssistant(page, '.assistant-diff-row');
  const enabledAfterPick35 = await page.evaluate(() => document.querySelector('[data-assistant-action="save-update"]').disabled);
  assert(enabledAfterPick35 === false, '选定目标后保存按钮应可用');

  await resetAssistant(page);
  await assistantInput(page, 'MOCK_UI_UPDATE_STATUS_INVALID');
  await submitAssistant(page);
  await waitAssistant(page, '.assistant-diff-row[data-field="status"]');
  const statusInvalid35 = await page.evaluate(() => {
    const select = document.querySelector('.assistant-diff-row[data-field="status"] select');
    return {
      value: select.value,
      firstOption: select.options[0].textContent,
      disabled: document.querySelector('[data-assistant-action="save-update"]').disabled,
      reason: document.querySelector('.assistant-reason').innerText.trim()
    };
  });
  assert(statusInvalid35.value === '' && statusInvalid35.firstOption === '请选择状态', `非法状态初始值不正确：${JSON.stringify(statusInvalid35)}`);
  assert(statusInvalid35.disabled === true && statusInvalid35.reason === '请先为所选项选择有效状态', `非法状态禁用原因不正确：${JSON.stringify(statusInvalid35)}`);
  await page.selectOption('.assistant-diff-row[data-field="status"] select', 'completed');
  const statusFixed35 = await page.evaluate(() => document.querySelector('[data-assistant-action="save-update"]').disabled);
  assert(statusFixed35 === false, '选择合法状态后保存按钮应可用');

  await resetAssistant(page);
  await assistantInput(page, 'MOCK_UI_UPDATE_TITLE');
  await submitAssistant(page);
  await waitAssistant(page, '.assistant-diff-row[data-field="title"]');
  await page.fill('.assistant-diff-row[data-field="title"] input', '');
  const titleCleared35 = await page.evaluate(() => ({
    disabled: document.querySelector('[data-assistant-action="save-update"]').disabled,
    reason: document.querySelector('.assistant-reason').innerText.trim()
  }));
  assert(titleCleared35.disabled === true && titleCleared35.reason.includes('标题不能为空'), `空标题禁用原因不正确：${JSON.stringify(titleCleared35)}`);
  await page.fill('.assistant-diff-row[data-field="title"] input', '数据库课程设计（新）');
  const titleFixed35 = await page.evaluate(() => document.querySelector('[data-assistant-action="save-update"]').disabled);
  assert(titleFixed35 === false, '标题恢复后保存按钮应可用');
  await resetAssistant(page);
  passCheck(35);

  await assistantInput(page, 'MOCK_UI_DELETE');
  await submitAssistant(page);
  await waitAssistant(page, '[data-target-id="2"]');
  await page.click('#assistantResult .assistant-target-row input[data-assistant-field="selected"]');
  const unchecked36 = await page.evaluate(() => ({
    text: document.querySelector('[data-assistant-action="delete"]').textContent.trim(),
    disabled: document.querySelector('[data-assistant-action="delete"]').disabled,
    reason: document.querySelector('.assistant-reason').innerText.trim()
  }));
  assert(unchecked36.text === '删除 0 条', `全部取消勾选后按钮文案不正确：${unchecked36.text}`);
  assert(unchecked36.disabled === true && unchecked36.reason === '没有选择任何条目', `全部取消勾选后禁用原因不正确：${JSON.stringify(unchecked36)}`);
  await page.click('#assistantResult .assistant-target-row input[data-assistant-field="selected"]');
  const rechecked36 = await page.evaluate(() => ({
    text: document.querySelector('[data-assistant-action="delete"]').textContent.trim(),
    disabled: document.querySelector('[data-assistant-action="delete"]').disabled,
    reason: document.querySelector('.assistant-reason').innerText.trim()
  }));
  assert(rechecked36.text === '删除 1 条' && rechecked36.disabled === false && rechecked36.reason === '', `重新勾选后按钮不正确：${JSON.stringify(rechecked36)}`);
  const dangerText36 = await page.innerText('.assistant-danger-note');
  assert(dangerText36.includes('永久删除') && dangerText36.includes('无法恢复'), `删除提示文案不正确：${dangerText36}`);
  await page.click('[data-assistant-action="delete"]');
  await waitAssistant(page, '#confirmModal.open');
  await page.click('#confirmCancel');
  const canceled36 = await page.evaluate(() => Boolean(document.querySelector('[data-target-id="2"]')));
  assert((await itemsOf(page)).some(item => item.id === 2), '取消确认后 id 2 应仍存在');
  assert(canceled36 === true, '取消确认后应保留预览');
  await page.click('[data-assistant-action="delete"]');
  await waitAssistant(page, '#confirmModal.open');
  await page.click('#confirmAccept');
  await waitAssistantRecordCount(page, 1);
  assert(!(await itemsOf(page)).some(item => item.id === 2), '确认后 id 2 应被永久删除');
  const record36 = await page.innerText('#assistantRecords');
  assert(record36.includes('已永久删除「并发改动」'), `记录缺删除明细：${record36}`);
  assert(record36.includes('删除 1 条（成功 1，跳过 0，失败 0）'), `记录缺删除汇总：${record36}`);

  await assistantInput(page, 'MOCK_UI_DELETE_CREATED');
  await submitAssistant(page);
  await waitAssistant(page, '[data-target-id="8"]');
  await page.evaluate(() => window.deadlineDesk.items.remove(8));
  await page.click('[data-assistant-action="delete"]');
  await waitAssistant(page, '#confirmModal.open');
  await page.click('#confirmAccept');
  await waitAssistantRecordCount(page, 2);
  const record36b = await page.innerText('#assistantRecords');
  assert(record36b.includes('已不存在（跳过）'), `记录缺「已不存在」跳过明细：${record36b}`);
  assert(!(await itemsOf(page)).some(item => item.id === 8), '已不存在的 id 8 不应重新出现');
  passCheck(36);

  await assistantInput(page, 'MOCK_UI_CLEANUP');
  await submitAssistant(page);
  await waitAssistant(page, '.assistant-range');
  const lastMonthStart37 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd37 = new Date(now.getFullYear(), now.getMonth(), 0);
  const expectedLastMonthLabel37 = `${lastMonthStart37.getFullYear()}年${lastMonthStart37.getMonth() + 1}月1日–${lastMonthStart37.getMonth() + 1}月${lastMonthEnd37.getDate()}日`;
  const lastMonthDeadline37 = monthDate(-1, 10, '09:00');
  const rangeText37 = await page.innerText('.assistant-range');
  assert(rangeText37.includes(expectedLastMonthLabel37), `清理范围标签不正确：${rangeText37}`);
  const cleanupRows37 = await page.evaluate(() => [...document.querySelectorAll('#assistantResult .assistant-target-row')].map(row => ({
    id: Number(row.dataset.targetId),
    checked: row.querySelector('input[data-assistant-field="selected"]').checked
  })));
  assert(cleanupRows37.length === 1 && cleanupRows37[0].id === 5 && cleanupRows37[0].checked === true, `清理目标不正确：${JSON.stringify(cleanupRows37)}`);
  assert(!cleanupRows37.some(row => row.id === 6 || row.id === 7), '清理不应包含未完成或本月事项');

  await page.click('#assistantResult .assistant-target-row input[data-assistant-field="selected"]');
  const uncheckedCleanup37 = await page.evaluate(() => ({
    text: document.querySelector('[data-assistant-action="delete"]').textContent.trim(),
    disabled: document.querySelector('[data-assistant-action="delete"]').disabled,
    reason: document.querySelector('.assistant-reason').innerText.trim()
  }));
  assert(uncheckedCleanup37.text === '删除 0 条', `清理全部取消勾选后按钮文案不正确：${uncheckedCleanup37.text}`);
  assert(uncheckedCleanup37.disabled === true && uncheckedCleanup37.reason === '没有选择任何条目', `清理全部取消勾选后禁用原因不正确：${JSON.stringify(uncheckedCleanup37)}`);
  await page.click('#assistantResult .assistant-target-row input[data-assistant-field="selected"]');
  const recheckedCleanup37 = await page.evaluate(() => ({
    text: document.querySelector('[data-assistant-action="delete"]').textContent.trim(),
    disabled: document.querySelector('[data-assistant-action="delete"]').disabled
  }));
  assert(recheckedCleanup37.text === '删除 1 条' && recheckedCleanup37.disabled === false, `清理重新勾选后按钮不正确：${JSON.stringify(recheckedCleanup37)}`);

  await updateItemThroughIpc(page, 5, { status: 'not_started' });
  const recordsBefore37 = await page.evaluate(() => document.querySelectorAll('.assistant-record').length);
  await page.click('[data-assistant-action="delete"]');
  await waitAssistant(page, '#confirmModal.open');
  await page.click('#confirmAccept');
  await waitAssistantRecordCount(page, recordsBefore37 + 1);
  const record37a = await page.innerText('#assistantRecords');
  assert(record37a.includes('「上月已完成作业」状态已变化，跳过'), `记录缺清理状态变化跳过明细：${record37a}`);
  assert(record37a.includes('删除 1 条（成功 0，跳过 1，失败 0）'), `清理状态变化跳过汇总不正确：${record37a}`);
  assert((await itemsOf(page)).some(item => item.id === 5), '状态已变化的 id 5 不应被清理');

  await updateItemThroughIpc(page, 5, { status: 'completed', deadline: lastMonthDeadline37 });
  await resetAssistant(page);
  await assistantInput(page, 'MOCK_UI_CLEANUP');
  await submitAssistant(page);
  await waitAssistant(page, '[data-target-id="5"]');
  await updateItemThroughIpc(page, 5, { deadline: `${localDate(0)} 12:00` });
  await page.click('[data-assistant-action="delete"]');
  await waitAssistant(page, '#confirmModal.open');
  await page.click('#confirmAccept');
  await waitAssistantRecordCount(page, 1);
  const record37b = await page.innerText('#assistantRecords');
  assert(record37b.includes('「上月已完成作业」截止时间已不在范围内，跳过'), `记录缺清理范围复核跳过明细：${record37b}`);
  assert(record37b.includes('删除 1 条（成功 0，跳过 1，失败 0）'), `清理范围复核跳过汇总不正确：${record37b}`);
  assert((await itemsOf(page)).some(item => item.id === 5), '截止时间越界的 id 5 不应被清理');

  await updateItemThroughIpc(page, 5, { deadline: lastMonthDeadline37 });
  await resetAssistant(page);
  await assistantInput(page, 'MOCK_UI_CLEANUP');
  await submitAssistant(page);
  await waitAssistant(page, '[data-target-id="5"]');
  await page.click('[data-assistant-action="delete"]');
  await waitAssistant(page, '#confirmModal.open');
  await page.click('#confirmAccept');
  await waitAssistantRecordCount(page, 1);
  const items37 = await itemsOf(page);
  assert(!items37.some(item => item.id === 5), 'id 5 应被清理');
  assert(items37.some(item => item.id === 6) && items37.some(item => item.id === 7), 'id 6 / 7 应保留');
  const record37 = await page.innerText('#assistantRecords');
  assert(record37.includes('删除 1 条（成功 1，跳过 0，失败 0）'), `记录缺清理汇总：${record37}`);

  await assistantInput(page, 'MOCK_UI_CLEANUP_EMPTY');
  await submitAssistant(page);
  await waitAssistantText(page, '#assistantResult', '没有符合条件的已完成事项。');
  const emptyDelete37 = await page.evaluate(() => Boolean(document.querySelector('[data-assistant-action="delete"]')));
  assert(emptyDelete37 === false, '空清理结果不应渲染删除按钮');
  passCheck(37);

  const itemsBefore38 = JSON.stringify(await itemsOf(page));
  await assistantInput(page, 'MOCK_QUERY_THIS_MONTH');
  await submitAssistant(page);
  await waitAssistant(page, '.assistant-answer');
  const answer38 = await page.innerText('.assistant-answer');
  assert(answer38 === '按截止时间在本月内：已完成 1 个。', `查询答复不正确：${answer38}`);
  const monthStart38 = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd38 = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const expectedMonthLabel38 = `${monthStart38.getFullYear()}年${monthStart38.getMonth() + 1}月1日–${monthStart38.getMonth() + 1}月${monthEnd38.getDate()}日`;
  const meta38 = await page.innerText('.assistant-query-meta');
  assert(meta38.includes('按截止时间') && meta38.includes(expectedMonthLabel38), `查询口径说明不正确：${meta38}`);
  assert(await page.evaluate(() => Boolean(document.querySelector('.assistant-query-counts'))), '查询应渲染统计汇总');
  const actionButtons38 = await page.evaluate(() => document.querySelectorAll('#assistantResult [data-assistant-action]').length);
  assert(actionButtons38 === 0, `查询结果不应包含执行按钮，实际 ${actionButtons38}`);
  assert(await page.evaluate(() => document.querySelector('#confirmModal').classList.contains('open')) === false, '查询不应弹出确认框');
  assert(JSON.stringify(await itemsOf(page)) === itemsBefore38, '查询不应写入事项');

  await assistantInput(page, 'MOCK_QUERY_FALLBACK');
  await submitAssistant(page);
  await waitAssistant(page, '.assistant-fallback');
  const fallbackText38 = await page.innerText('.assistant-fallback');
  assert(fallbackText38.includes('模型组织文字失败，以下为本地数据汇总'), `回落提示文案不正确：${fallbackText38}`);
  assert(await page.evaluate(() => Boolean(document.querySelector('.assistant-answer'))), '回落时仍应渲染本地汇总答复');
  assert(JSON.stringify(await itemsOf(page)) === itemsBefore38, '回落查询不应写入事项');
  passCheck(38);

  const repeatedBefore39 = await page.evaluate(() => ({
    records: document.querySelectorAll('.assistant-record').length,
    answer: document.querySelector('.assistant-answer')?.innerText || '',
    input: document.querySelector('#assistantInput').value
  }));
  assert(repeatedBefore39.records >= 1, `重复点击前应存在操作记录，实际 ${repeatedBefore39.records}`);
  await page.click('.nav-item[data-page="assistant"]');
  const repeatedAfter39 = await page.evaluate(() => ({
    records: document.querySelectorAll('.assistant-record').length,
    answer: document.querySelector('.assistant-answer')?.innerText || '',
    input: document.querySelector('#assistantInput').value
  }));
  assert(repeatedAfter39.records === repeatedBefore39.records, `重复点击助手导航不应清空记录：${JSON.stringify({ before: repeatedBefore39, after: repeatedAfter39 })}`);
  assert(repeatedAfter39.answer === repeatedBefore39.answer, `重复点击助手导航不应重置预览：${JSON.stringify({ before: repeatedBefore39, after: repeatedAfter39 })}`);
  assert(repeatedAfter39.input === repeatedBefore39.input, `重复点击助手导航不应重置输入：${JSON.stringify({ before: repeatedBefore39, after: repeatedAfter39 })}`);

  await assistantInput(page, '保留的输入');
  await page.click('.nav-item[data-page="settings"]');
  await page.click('.nav-item[data-page="assistant"]');
  await waitAssistantConfig(page, 'ready');
  const keptInput39 = await page.evaluate(() => document.querySelector('#assistantInput').value);
  assert(keptInput39 === '保留的输入', `离开页面后输入应保留：${keptInput39}`);

  await assistantInput(page, 'MOCK_UI_CREATE');
  await submitAssistant(page);
  await waitAssistant(page, '[data-row-id="c0"]');
  const previewBeforeRepeat39 = await page.evaluate(() => ({
    rows: document.querySelectorAll('#assistantResult .assistant-row[data-row-id]').length,
    input: document.querySelector('#assistantInput').value
  }));
  await page.click('.nav-item[data-page="assistant"]');
  const previewAfterRepeat39 = await page.evaluate(() => ({
    rows: document.querySelectorAll('#assistantResult .assistant-row[data-row-id]').length,
    input: document.querySelector('#assistantInput').value,
    records: document.querySelectorAll('.assistant-record').length
  }));
  assert(previewAfterRepeat39.rows === previewBeforeRepeat39.rows && previewAfterRepeat39.rows > 0, `重复点击助手导航不应重置预览行：${JSON.stringify({ before: previewBeforeRepeat39, after: previewAfterRepeat39 })}`);
  assert(previewAfterRepeat39.input === previewBeforeRepeat39.input, `重复点击助手导航不应重置输入：${JSON.stringify({ before: previewBeforeRepeat39, after: previewAfterRepeat39 })}`);
  assert(previewAfterRepeat39.records === 0, `重复点击助手导航不应产生记录：${previewAfterRepeat39.records}`);
  await page.click('.nav-item[data-page="settings"]');
  const cleared39 = await page.evaluate(() => ({
    result: document.querySelector('#assistantResult').innerText.trim(),
    records: document.querySelectorAll('.assistant-record').length
  }));
  assert(cleared39.result === '' && cleared39.records === 0, `离开页面应清空预览与记录：${JSON.stringify(cleared39)}`);
  await page.click('.nav-item[data-page="assistant"]');
  await waitAssistantConfig(page, 'ready');
  const restored39 = await page.evaluate(() => ({
    placeholder: document.querySelector('#assistantResult').innerText.includes('提交后会在这里显示预览或答复。'),
    rows: document.querySelectorAll('#assistantResult [data-row-id]').length,
    input: document.querySelector('#assistantInput').value
  }));
  assert(restored39.placeholder === true && restored39.rows === 0, `返回助手页应只显示占位：${JSON.stringify(restored39)}`);
  assert(restored39.input === 'MOCK_UI_CREATE', `返回助手页应保留输入：${restored39.input}`);

  await assistantInput(page, 'MOCK_UI_DELAYED');
  await submitAssistant(page);
  const loading39 = await page.evaluate(() => ({
    inputDisabled: document.querySelector('#assistantInput').disabled,
    submitDisabled: document.querySelector('#assistantSubmit').disabled,
    submitText: document.querySelector('#assistantSubmit').innerText.trim()
  }));
  assert(loading39.inputDisabled === true && loading39.submitDisabled === true, `加载中应禁用输入与提交：${JSON.stringify(loading39)}`);
  assert(loading39.submitText === '正在处理…', `加载中文案不正确：${loading39.submitText}`);
  await waitAssistant(page, '[data-row-id="c0"]');
  const loaded39 = await page.evaluate(() => ({
    inputDisabled: document.querySelector('#assistantInput').disabled,
    submitDisabled: document.querySelector('#assistantSubmit').disabled,
    submitText: document.querySelector('#assistantSubmit').innerText.trim()
  }));
  assert(loaded39.inputDisabled === false && loaded39.submitDisabled === false && loaded39.submitText === '解析', `加载结束后控件未恢复：${JSON.stringify(loaded39)}`);

  const requestsBeforeLate39 = mock.requests.length;
  await submitAssistant(page);
  await page.click('.nav-item[data-page="settings"]');
  await new Promise(resolve => setTimeout(resolve, 700));
  const late39 = await page.evaluate(() => ({
    result: document.querySelector('#assistantResult').innerText.trim(),
    records: document.querySelectorAll('.assistant-record').length
  }));
  assert(late39.result === '' && late39.records === 0, `晚到响应不应写回页面：${JSON.stringify(late39)}`);
  await page.click('.nav-item[data-page="assistant"]');
  await waitAssistantConfig(page, 'ready');
  const lateBack39 = await page.evaluate(() => ({
    placeholder: document.querySelector('#assistantResult').innerText.includes('提交后会在这里显示预览或答复。'),
    rows: document.querySelectorAll('#assistantResult [data-row-id]').length
  }));
  assert(lateBack39.placeholder === true && lateBack39.rows === 0, `晚到响应后返回应只显示占位：${JSON.stringify(lateBack39)}`);
  assert(mock.requests.length === requestsBeforeLate39 + 1, `晚到响应应只发起一次请求，实际 ${mock.requests.length - requestsBeforeLate39}`);

  await mock.resetMock();
  await assistantInput(page, 'MOCK_UI_CREATE_BULK');
  await submitAssistant(page);
  await waitAssistant(page, '[data-row-id="c0"]');
  const bulkRows39 = await page.evaluate(() => document.querySelectorAll('#assistantResult .assistant-row[data-row-id]').length);
  const bulkText39 = await page.innerText('[data-assistant-action="write-create"]');
  assert(bulkRows39 === 60 && bulkText39 === '写入 60 条', `批量预览不正确：rows=${bulkRows39} text=${bulkText39}`);
  const itemsBeforeBulk39 = (await itemsOf(page)).length;
  await page.evaluate(() => {
    document.querySelector('[data-assistant-action="write-create"]').click();
    document.querySelector('.nav-item[data-page="settings"]').click();
  });
  await pollAssistant(async () => (await itemsOf(page)).length > itemsBeforeBulk39, 5000);
  await page.click('.nav-item[data-page="assistant"]');
  await pollAssistant(async () => (await page.innerText('#assistantResult')).includes('正在处理…'), 5000);
  const duringExecute39 = await page.evaluate(() => ({
    inputDisabled: document.querySelector('#assistantInput').disabled,
    submitDisabled: document.querySelector('#assistantSubmit').disabled,
    busy: document.querySelector('#assistantResult').innerText.includes('正在处理…'),
    records: document.querySelectorAll('.assistant-record').length
  }));
  assert(duringExecute39.busy === true && duringExecute39.inputDisabled === true && duringExecute39.submitDisabled === true, `执行中返回后应保持加载与禁用：${JSON.stringify(duringExecute39)}`);
  assert(duringExecute39.records === 0, `执行中不应产生操作记录：${duringExecute39.records}`);
  await pollAssistant(() => page.evaluate(() => document.querySelector('#assistantInput').disabled === false), 15000);
  const finished39 = await page.evaluate(() => ({
    busy: document.querySelector('#assistantResult').innerText.includes('正在处理…'),
    placeholder: document.querySelector('#assistantResult').innerText.includes('提交后会在这里显示预览或答复。'),
    records: document.querySelectorAll('.assistant-record').length,
    input: document.querySelector('#assistantInput').value,
    submitText: document.querySelector('#assistantSubmit').innerText.trim()
  }));
  assert(finished39.busy === false && finished39.placeholder === true, `执行结束应恢复占位：${JSON.stringify(finished39)}`);
  assert(finished39.records === 0, `执行中离开又返回后不应写入操作记录：${finished39.records}`);
  assert(finished39.input === 'MOCK_UI_CREATE_BULK', `执行结束后应保留输入：${finished39.input}`);
  assert(finished39.submitText === '解析', `执行结束后提交按钮文案不正确：${finished39.submitText}`);
  assert((await itemsOf(page)).length === itemsBeforeBulk39 + 60, `执行中离开后批次仍应完成写入：${(await itemsOf(page)).length}`);
  passCheck(39);

  await saveAi(page, { endpoint: '', model });
  await resetAssistant(page, 'missing');
  const warning40 = await page.evaluate(() => ({
    config: document.querySelector('#assistantConfigWarning').dataset.config,
    hidden: document.querySelector('#assistantConfigWarning').classList.contains('hidden')
  }));
  assert(warning40.config === 'missing' && warning40.hidden === false, `未配置时配置提示不正确：${JSON.stringify(warning40)}`);
  await mock.resetMock();
  await assistantInput(page, 'MOCK_CREATE');
  await submitAssistant(page);
  await waitAssistant(page, '.assistant-error');
  const errorText40 = await page.innerText('.assistant-error');
  assert(errorText40.includes('尚未完成 AI 配置'), `未配置错误文案不正确：${errorText40}`);
  assert(mock.requests.length === 0, '未配置时不得发起模型请求');
  const retryHidden40 = await page.evaluate(() => document.querySelector('#assistantRetry').classList.contains('hidden'));
  assert(retryHidden40 === true, '不可重试错误应隐藏重试按钮');
  const goSettings40 = await page.evaluate(() => Boolean(document.querySelector('.assistant-error [data-assistant-action="go-settings"]')));
  assert(goSettings40 === true, '未配置错误应提供前往设置按钮');

  await saveAi(page, { endpoint: mockEndpoint, model });
  await resetAssistant(page, 'ready');
  const warning40b = await page.evaluate(() => ({
    config: document.querySelector('#assistantConfigWarning').dataset.config,
    hidden: document.querySelector('#assistantConfigWarning').classList.contains('hidden')
  }));
  assert(warning40b.config === 'ready' && warning40b.hidden === true, `恢复配置后提示应隐藏：${JSON.stringify(warning40b)}`);

  await mock.resetMock();
  await assistantInput(page, 'MOCK_500');
  await submitAssistant(page);
  await waitAssistant(page, '.assistant-error');
  assert(mock.requests.length === 1, `可重试错误应请求一次，实际 ${mock.requests.length}`);
  const retryVisible40 = await page.evaluate(() => !document.querySelector('#assistantRetry').classList.contains('hidden'));
  assert(retryVisible40 === true, '可重试错误应显示重试按钮');
  await page.click('#assistantRetry');
  for (let index = 0; index < 100 && mock.requests.length < 2; index += 1) await new Promise(resolve => setTimeout(resolve, 50));
  await page.waitForFunction(() => document.querySelector('#assistantSubmit').innerText.trim() === '解析', null, { timeout: 5000 });
  assert(mock.requests.length === 2, `重试应再请求一次，实际 ${mock.requests.length}`);
  assert(await page.evaluate(() => Boolean(document.querySelector('.assistant-error'))), '重试后仍应显示错误');

  await page.evaluate(() => {
    const input = document.querySelector('#assistantInput');
    input.value = 'x'.repeat(3001);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const counter40 = await page.evaluate(() => ({
    text: document.querySelector('#assistantCounter').innerText.trim(),
    over: document.querySelector('#assistantCounter').classList.contains('over')
  }));
  assert(counter40.text === '3001 / 3000' && counter40.over === true, `超长输入计数样式不正确：${JSON.stringify(counter40)}`);
  await submitAssistant(page);
  await waitAssistantText(page, '#assistantResult', '3000');
  assert(mock.requests.length === 2, '超长输入应在本地拦截，不得发起请求');
  passCheck(40);

  await mock.resetMock();
  await assistantInput(page, 'MOCK_UI_XSS');
  await submitAssistant(page);
  await waitAssistant(page, '[data-row-id="c0"]');
  const xss41 = await page.evaluate(() => ({
    xss: window.__xss,
    img: document.querySelectorAll('#assistantResult img').length,
    script: document.querySelectorAll('#assistantResult script').length,
    text: document.querySelector('#assistantResult').innerText
  }));
  assert(xss41.xss === undefined, '候选文本不应执行脚本');
  assert(xss41.img === 0 && xss41.script === 0, '结果区不应插入 img/script 元素');
  assert(xss41.text.includes('<img'), `结果区应以纯文本呈现转义后的标题：${xss41.text}`);
  const originalTitle41 = await page.evaluate(() => document.querySelector('[data-row-id="c0"] input[data-assistant-field="title"]').value);
  assert(originalTitle41 === '<img src=x onerror="window.__xss=1">X', `标题原文不正确：${originalTitle41}`);
  await page.fill('[data-row-id="c0"] input[data-assistant-field="title"]', `${originalTitle41}改`);
  await submitAssistant(page);
  await waitAssistant(page, '#confirmModal.open');
  const confirmTitle41 = await page.innerText('#confirmTitle');
  assert(confirmTitle41 === '替换当前预览？', `替换预览确认标题不正确：${confirmTitle41}`);
  assert(mock.requests.length === 1, '确认替换前不得发起新请求');
  await page.click('#confirmCancel');
  const keptPreview41 = await page.evaluate(() => Boolean(document.querySelector('[data-row-id="c0"]')));
  assert(keptPreview41 === true && mock.requests.length === 1, '取消替换后应保留预览且不请求');
  await submitAssistant(page);
  await waitAssistant(page, '#confirmModal.open');
  await page.click('#confirmAccept');
  for (let index = 0; index < 100 && mock.requests.length < 2; index += 1) await new Promise(resolve => setTimeout(resolve, 50));
  await waitAssistant(page, '[data-row-id="c0"]');
  const restoredTitle41 = await page.evaluate(() => document.querySelector('[data-row-id="c0"] input[data-assistant-field="title"]').value);
  assert(mock.requests.length === 2, `确认替换后应重新请求，实际 ${mock.requests.length}`);
  assert(restoredTitle41 === originalTitle41, `替换后标题应恢复为模型原值：${restoredTitle41}`);
  passCheck(41);
  await page.click('.nav-item[data-page="settings"]');
}

(async () => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  const mock = await createMockServer();
  mockEndpoint = mock.endpoint;
  const pageErrors = [];
  let electronApp = null;
  try {
    electronApp = await launchApp();
    await runStageA(electronApp, mock, pageErrors);
    await stopApp(electronApp);
    electronApp = null;

    await mutateDb([
      { sql: 'DELETE FROM items' },
      { sql: 'INSERT INTO items (id, kind, title, description, deadline, status, work_type) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [1, 'assignment', '本月已完成大作业', '', monthDate(0, 5, '09:00'), 'completed', 'personal'] },
      { sql: 'INSERT INTO items (id, kind, title, description, deadline, status, work_type) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [2, 'activity', '本月未完成活动', '', monthDate(0, 20, '18:00'), 'not_completed', null] },
      { sql: 'INSERT INTO items (id, kind, title, description, deadline, status, work_type) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [3, 'assignment', '上月已完成大作业', '', monthDate(-1, 15, '10:00'), 'completed', 'personal'] }
    ]);
    electronApp = await launchApp();
    await runStageB(electronApp, mock, pageErrors);
    await stopApp(electronApp);
    electronApp = null;

    const stageCStatements = [{ sql: 'DELETE FROM items' }];
    for (let id = 1; id <= 100; id += 1) {
      const isAssignment = id % 2 === 1;
      stageCStatements.push({
        sql: 'INSERT INTO items (id, kind, title, description, deadline, status, work_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
        params: [id, isAssignment ? 'assignment' : 'activity', `摘要样本 ${id}`, '', `${localDate(id)} 23:59`, isAssignment ? 'not_started' : 'not_completed', isAssignment ? 'personal' : null]
      });
    }
    for (let id = 101; id <= 105; id += 1) {
      stageCStatements.push({
        sql: 'INSERT INTO items (id, kind, title, description, deadline, status, work_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
        params: [id, 'assignment', `完成样本 ${id}`, '', `${localDate(-(id - 100))} 09:00`, 'completed', 'personal']
      });
    }
    stageCStatements.push({ sql: "INSERT INTO settings (key, value) VALUES ('ai_endpoint', 'ftp://x') ON CONFLICT(key) DO UPDATE SET value = excluded.value" });
    await mutateDb(stageCStatements);
    electronApp = await launchApp();
    await runStageC(electronApp, mock, pageErrors);
    await stopApp(electronApp);
    electronApp = null;

    await mutateDb([{ sql: "DELETE FROM settings WHERE key = 'ai_api_key'" }]);
    electronApp = await launchApp();
    await runStageD(electronApp, mock, pageErrors);
    await stopApp(electronApp);
    electronApp = null;

    const stageEStatements = [
      { sql: 'DELETE FROM items' },
      { sql: "DELETE FROM sqlite_sequence WHERE name = 'items'" },
      {
        sql: "INSERT INTO settings (key, value) VALUES ('ai_api_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params: [apiKey]
      },
      { sql: 'INSERT INTO items (id, kind, title, description, deadline, status, work_type) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [1, 'assignment', '数据库课程设计', '', `${localDate(3)} 23:59`, 'not_started', 'personal'] },
      { sql: 'INSERT INTO items (id, kind, title, description, deadline, status, work_type) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [2, 'activity', '校辩论赛报名', '', `${localDate(2)} 23:59`, 'not_completed', null] },
      { sql: 'INSERT INTO items (id, kind, title, description, deadline, status, work_type) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [3, 'activity', '同名活动', '', `${localDate(1)} 18:00`, 'not_completed', null] },
      { sql: 'INSERT INTO items (id, kind, title, description, deadline, status, work_type) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [4, 'assignment', '同名活动', '', `${localDate(5)} 23:59`, 'not_started', 'personal'] },
      { sql: 'INSERT INTO items (id, kind, title, description, deadline, status, work_type) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [5, 'assignment', '上月已完成作业', '', monthDate(-1, 10, '09:00'), 'completed', 'personal'] },
      { sql: 'INSERT INTO items (id, kind, title, description, deadline, status, work_type) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [6, 'assignment', '上月未完成作业', '', monthDate(-1, 20, '09:00'), 'not_started', 'personal'] },
      { sql: 'INSERT INTO items (id, kind, title, description, deadline, status, work_type) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [7, 'activity', '本月已完成活动', '', monthDate(0, 5, '10:00'), 'completed', null] }
    ];
    await mutateDb(stageEStatements);
    electronApp = await launchApp();
    await runStageE(electronApp, mock, pageErrors);
    await stopApp(electronApp);
    electronApp = null;

    electronApp = await launchApp();
    await runStageF(electronApp, mock, pageErrors);
    await stopApp(electronApp);
    electronApp = null;

    assert(pageErrors.length === 0, `页面异常应为空，实际 ${JSON.stringify(pageErrors)}`);
    passCheck(24);

    const checks = Object.keys(CHECK_TITLES)
      .filter(key => passed.has(key))
      .sort((a, b) => Number(a) - Number(b))
      .map(key => `${key}. ${CHECK_TITLES[key]}`);
    assert(checks.length === 41, `断言数量应为 41，实际 ${checks.length}`);
    console.log(JSON.stringify({ passed: true, checks }));
  } finally {
    if (electronApp) await stopApp(electronApp);
    await mock.close();
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
