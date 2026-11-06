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
  10: '围栏与数组内容解析',
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
  24: '全流程无页面异常'
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

async function openStagePage(electronApp, pageErrors) {
  const page = await electronApp.firstWindow();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  return page;
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
    assert(result.ok === true && result.intent === 'create', `${key} 应解析为 create`);
    assert(!('create' in result) && !('query' in result), '非查询成功结构不应包含计划字段');
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

    assert(pageErrors.length === 0, `页面异常应为空，实际 ${JSON.stringify(pageErrors)}`);
    passCheck(24);

    const checks = Object.keys(CHECK_TITLES)
      .filter(key => passed.has(key))
      .sort((a, b) => Number(a) - Number(b))
      .map(key => `${key}. ${CHECK_TITLES[key]}`);
    assert(checks.length === 24, `断言数量应为 24，实际 ${checks.length}`);
    console.log(JSON.stringify({ passed: true, checks }));
  } finally {
    if (electronApp) await stopApp(electronApp);
    await mock.close();
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
