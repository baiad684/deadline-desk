const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const http = require('http');
const archiver = require('archiver');
const extract = require('extract-zip');

const projectDir = path.resolve(__dirname, '..');
const dataDir = path.join(projectDir, 'test-output', 'assistant-data');
const outputDir = path.join(projectDir, 'test-output');
const dbPath = path.join(dataDir, 'deadline-desk.db');
const model = 'mock-model';
const apiKey = 'sk-test-1234567890abcd';
const expectedKeyMask = 'sk-t••••abcd';
const NEW_API_KEY = 'sk-ui-new-key-0987654321';
const NEW_KEY_MASK = 'sk-u••••4321';
const BACKUP_ENDPOINT = 'https://api.backup.example/v1/chat/completions';
const BACKUP_MODEL = 'backup-model';
const BACKUP_KEY = 'sk-backup-key-111111';
const BACKUP_KEY_MASK = 'sk-b••••1111';
const STAGE_H_BACKUP = path.join(outputDir, 'stage-h-backup.zip');
const STAGE_H_RESTORE = path.join(outputDir, 'stage-h-restore.zip');
const STAGE_H_EXTRACT = path.join(outputDir, 'stage-h-extract');
const STAGE_H_DB = path.join(STAGE_H_EXTRACT, 'deadline-desk.db');
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_MAX_TOKENS = 4096;
const ANTHROPIC_KEY = 'sk-ant-probe-key-123456';
const ANTHROPIC_KEY_MASK = 'sk-a••••3456';
const STAGE_I_BACKUP = path.join(outputDir, 'stage-i-backup.zip');
const STAGE_I_RESTORE = path.join(outputDir, 'stage-i-restore.zip');
const STAGE_I_RESTORE_DB = path.join(outputDir, 'stage-i-restore.db');
const STAGE_I_EXTRACT = path.join(outputDir, 'stage-i-extract');
const STAGE_I_DB = path.join(STAGE_I_EXTRACT, 'deadline-desk.db');

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
  41: '安全：文本转义与替换预览确认',
  42: '设置页：AI 分组结构、顺序与初始掩码',
  43: '设置页：修改 Key、留空保持旧 Key',
  44: '设置页：保存新 Key 与模型、助手提示同步',
  45: '设置页：不完整配置允许保存与状态联动',
  46: '设置页：非法接口地址错误提示且不落库',
  47: '设置页：明文 Key 不泄露、不写 localStorage',
  48: '备份：导出 zip 剔除 Key、保留地址/模型与 manifest',
  49: '恢复：备份 Key 被忽略、本机 Key 回填且清空数据后保留',
  50: '恢复：本机无 Key 时不引入备份 Key 且不落盘',
  51: '重启后助手会话为空、输入不残留',
  52: '多意图与越界意图：只读提示、无执行入口、零写入',
  53: '疑似重复强制勾选与过期候选写入',
  54: '批量删除：目标已不存在时其余行继续执行',
  55: '设置页：协议下拉结构与默认值',
  56: '设置页：切换协议不清空字段并保存协议',
  57: 'Anthropic：新增调用请求头与请求体',
  58: 'Anthropic：查询两次调用与成功响应解析',
  59: 'Anthropic：错误映射、超时与零写入',
  60: '切回 OpenAI：请求与解析恢复既有行为',
  61: '备份与恢复：协议随库保留、Key 不导出'
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

function detectProtocol(headers) {
  return headers['anthropic-version'] ? 'anthropic' : 'openai';
}

function readUserContent(body) {
  if (!Array.isArray(body.messages)) return undefined;
  const last = body.messages.filter(item => item && item.role === 'user' && typeof item.content === 'string').pop();
  return last ? last.content : undefined;
}

function modelEnvelope(protocol, content, options = {}) {
  if (protocol === 'anthropic') {
    return {
      id: 'mock',
      type: 'message',
      role: 'assistant',
      model,
      content: Array.isArray(content) ? content : [{ type: 'text', text: content }],
      stop_reason: options.stopReason || 'end_turn'
    };
  }
  return chatCompletion(content, options.finishReason || 'stop');
}

function respondModel(res, protocol, status, content, options = {}) {
  sendJson(res, status, modelEnvelope(protocol, content, options), options.delayMs || 0);
}

function createMockServer() {
  return new Promise((resolve, reject) => {
    const requests = [];
    const state = { queryScenario: null };
    const respondQuery = (res, protocol) => {
      if (state.queryScenario === 'this_month') {
        respondModel(res, protocol, 200, '按截止时间在本月内：已完成 1 个。');
        return;
      }
      sendJson(res, 500, { error: { message: 'secret-body' } });
    };
    const respondScenario = (res, key, protocol) => {
      switch (key) {
        case 'MOCK_CREATE':
          return respondModel(res, protocol, 200, '{"intent":"create","create":{"candidates":[{"title":"数据库课设","kind":"assignment","deadline":"2026-11-13 23:59","status":"not_started","description":"","workType":"personal"},{"title":"校辩论赛报名","kind":"activity","deadline":"2026-11-10 23:59","status":"not_completed","description":"","workType":null}]},"message":"已识别到 2 条候选"}');
        case 'MOCK_FENCE':
          return respondModel(res, protocol, 200, '```json\n{"intent":"create","message":"ok"}\n```');
        case 'MOCK_ARRAY':
          return respondModel(res, protocol, 200, [{ type: 'text', text: '{"intent":"create","message":"ok"}' }]);
        case 'MOCK_MULTI':
          return respondModel(res, protocol, 200, '{"intent":"multiple","detectedIntents":["create","delete"],"message":"mixed"}');
        case 'MOCK_MULTI_EMPTY':
          return respondModel(res, protocol, 200, '{"intent":"multiple","message":"mixed"}');
        case 'MOCK_UNKNOWN':
          return respondModel(res, protocol, 200, '{"intent":"whatever"}');
        case 'MOCK_UNSUPPORTED':
          return respondModel(res, protocol, 200, '{"intent":"unsupported","message":"不支持生成周报。"}');
        case 'MOCK_EMPTY':
          return respondModel(res, protocol, 200, '');
        case 'MOCK_NOT_JSON':
          return respondModel(res, protocol, 200, '抱歉，我不能…');
        case 'MOCK_LENGTH':
          return respondModel(res, protocol, 200, '{"intent":"clarify","message":"length"}', { finishReason: 'length', stopReason: 'max_tokens' });
        case 'MOCK_ANTHROPIC_MAX_TOKENS':
          return respondModel(res, protocol, 200, '{"intent":"clarify","message":"cut"}', { stopReason: 'max_tokens' });
        case 'MOCK_NO_CHOICES':
          return sendJson(res, 200, { choices: [] });
        case 'MOCK_401':
          return sendJson(res, 401, { error: { message: 'secret-body' } });
        case 'MOCK_429':
          return sendJson(res, 429, { error: { message: 'secret-body' } });
        case 'MOCK_500':
          return sendJson(res, 500, { error: { message: 'secret-body' } });
        case 'MOCK_SLOW':
          return respondModel(res, protocol, 200, '{"intent":"clarify","message":"slow"}', { delayMs: 1500 });
        case 'MOCK_QUERY_THIS_MONTH':
          state.queryScenario = 'this_month';
          return respondModel(res, protocol, 200, '{"intent":"query","query":{"range":{"type":"this_month"},"kind":"all","status":"completed","shape":"count"}}');
        case 'MOCK_QUERY_FALLBACK':
          state.queryScenario = 'fallback';
          return respondModel(res, protocol, 200, '{"intent":"query","query":{"range":{"type":"last_month"},"status":"completed"}}');
        case 'MOCK_QUERY_NO_RANGE':
          return respondModel(res, protocol, 200, '{"intent":"query","query":{}}');
        case 'MOCK_PLAN_CREATE':
          return respondModel(res, protocol, 200, JSON.stringify({
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
          }));
        case 'MOCK_PLAN_UPDATE':
          return respondModel(res, protocol, 200, JSON.stringify({
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
          }));
        case 'MOCK_PLAN_UPDATE_INVALID':
          return respondModel(res, protocol, 200, JSON.stringify({
            intent: 'update',
            update: { targetIds: [2], changes: { status: 'in_progress', deadline: '2026-02-31 10:00' } }
          }));
        case 'MOCK_PLAN_DELETE':
          return respondModel(res, protocol, 200, JSON.stringify({ intent: 'delete', delete: { targetIds: [3, 2] } }));
        case 'MOCK_PLAN_CLEANUP':
          return respondModel(res, protocol, 200, JSON.stringify({ intent: 'cleanup', cleanup: { range: { type: 'last_month' } } }));
        case 'MOCK_PLAN_CLEANUP_EMPTY':
          return respondModel(res, protocol, 200, JSON.stringify({ intent: 'cleanup', cleanup: { range: { type: 'next_month' } } }));
        case 'MOCK_UI_CREATE':
          return respondModel(res, protocol, 200, JSON.stringify({
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
          }));
        case 'MOCK_UI_CREATE_MISSING':
          return respondModel(res, protocol, 200, JSON.stringify({
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
          }));
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
          return respondModel(res, protocol, 200, JSON.stringify({ intent: 'create', create: { candidates, ignored: [] } }));
        }
        case 'MOCK_UI_XSS':
          return respondModel(res, protocol, 200, JSON.stringify({
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
          }));
        case 'MOCK_UI_UPDATE':
          return respondModel(res, protocol, 200, JSON.stringify({
            intent: 'update',
            message: '已找到目标',
            update: { targetIds: [2], changes: { deadline: `${localDate(6)} 23:59` } }
          }));
        case 'MOCK_UI_UPDATE_MULTI':
          return respondModel(res, protocol, 200, JSON.stringify({
            intent: 'update',
            message: '匹配到多个事项',
            update: { targetIds: [3, 4], changes: { status: 'completed' } }
          }));
        case 'MOCK_UI_UPDATE_STATUS_INVALID':
          return respondModel(res, protocol, 200, JSON.stringify({
            intent: 'update',
            update: { targetIds: [2], changes: { status: 'in_progress' } }
          }));
        case 'MOCK_UI_UPDATE_TITLE':
          return respondModel(res, protocol, 200, JSON.stringify({
            intent: 'update',
            update: { targetIds: [1], changes: { title: '数据库课程设计（新）' } }
          }));
        case 'MOCK_UI_DELETE':
          return respondModel(res, protocol, 200, JSON.stringify({
            intent: 'delete',
            delete: { targetIds: [2] }
          }));
        case 'MOCK_UI_DELETE_CREATED':
          return respondModel(res, protocol, 200, JSON.stringify({
            intent: 'delete',
            delete: { targetIds: [8] }
          }));
        case 'MOCK_UI_CLEANUP':
          return respondModel(res, protocol, 200, JSON.stringify({
            intent: 'cleanup',
            cleanup: { range: { type: 'last_month' } }
          }));
        case 'MOCK_UI_CLEANUP_EMPTY':
          return respondModel(res, protocol, 200, JSON.stringify({
            intent: 'cleanup',
            cleanup: { range: { type: 'next_month' } }
          }));
        case 'MOCK_UI_DUPLICATE':
          return respondModel(res, protocol, 200, JSON.stringify({
            intent: 'create',
            create: {
              candidates: [
                { title: '数据库课设', kind: 'assignment', deadline: `${localDate(3)} 23:59`, status: 'not_started', workType: 'personal' },
                { title: '补录旧通知', kind: 'assignment', deadline: `${localDate(-3)} 02:00`, status: 'not_started', workType: 'personal' }
              ],
              ignored: []
            }
          }));
        case 'MOCK_UI_DELETE_PARTIAL':
          return respondModel(res, protocol, 200, JSON.stringify({
            intent: 'delete',
            delete: { targetIds: [6, 7] }
          }));
        case 'MOCK_UI_DELAYED':
          return respondModel(res, protocol, 200, JSON.stringify({
            intent: 'create',
            create: {
              candidates: [{ title: '助手延迟候选', kind: 'assignment', deadline: `${localDate(4)} 23:59`, status: 'not_started', workType: 'personal' }],
              ignored: []
            }
          }), { delayMs: 400 });
        case 'MOCK_400':
          return sendJson(res, 400, { error: { message: 'secret-body' } });
        case 'MOCK_404':
          return sendJson(res, 404, { error: { message: 'secret-body' } });
        case 'MOCK_418':
          return sendJson(res, 418, { error: { message: 'secret-body' } });
        default:
          return respondModel(res, protocol, 200, '{"intent":"clarify","message":"请补充更多信息"}');
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
        const protocol = detectProtocol(req.headers);
        requests.push({ method: req.method, url: `http://${req.headers.host}${req.url}`, headers: req.headers, body, protocol });
        const contentText = readUserContent(body);
        let parsed = null;
        if (typeof contentText === 'string') {
          try {
            parsed = JSON.parse(contentText);
          } catch {
            parsed = null;
          }
        }
        if (parsed && typeof parsed === 'object' && typeof parsed.question === 'string') {
          respondQuery(res, protocol);
          return;
        }
        const input = parsed && typeof parsed === 'object' && typeof parsed.input === 'string' ? parsed.input : '';
        respondScenario(res, input, protocol);
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

function waitToast(page, text) {
  return pollPage(page, value => {
    const toast = document.querySelector('#toast');
    return Boolean(toast && toast.classList.contains('show') && document.querySelector('#toastText').innerText.trim().includes(value));
  }, text, '等待提示超时');
}

function waitSettingsReady(page) {
  return pollPage(page, () => document.querySelector('#aiSettingsStatus')?.dataset.aiStatus === 'ready', undefined, '等待设置页配置就绪超时');
}

async function patchSaveDialog(electronApp, target) {
  await electronApp.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = Object.assign(async () => ({ canceled: false, filePath }), { __probePatched: true });
  }, target);
  const patched = await electronApp.evaluate(({ dialog }) => dialog.showSaveDialog.__probePatched === true);
  if (!patched) throw new Error('无法替换保存对话框');
}

async function patchOpenDialog(electronApp, target) {
  await electronApp.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = Object.assign(async () => ({ canceled: false, filePaths: [filePath] }), { __probePatched: true });
  }, target);
  const patched = await electronApp.evaluate(({ dialog }) => dialog.showOpenDialog.__probePatched === true);
  if (!patched) throw new Error('无法替换打开对话框');
}

function waitSettingsLoaded(page, endpoint) {
  return pollPage(page, value => document.querySelector('#aiEndpointInput')?.value === value, endpoint, '等待设置页表单超时');
}

async function pollPage(page, predicate, arg, timeoutMessage = '等待页面条件超时', timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, arg)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(timeoutMessage);
}

let sqlJsPromise = null;

function loadSqlJs() {
  if (!sqlJsPromise) {
    const initSqlJs = require('sql.js');
    sqlJsPromise = initSqlJs({ locateFile: file => path.join(projectDir, 'node_modules', 'sql.js', 'dist', file) });
  }
  return sqlJsPromise;
}

async function readDbSettings(file) {
  const SQL = await loadSqlJs();
  const db = new SQL.Database(fs.readFileSync(file));
  try {
    const result = db.exec("SELECT key, value FROM settings WHERE key IN ('ai_endpoint','ai_model','ai_api_key','ai_protocol')");
    if (!result.length) return {};
    return Object.fromEntries(result[0].values.map(row => [row[0], row[1]]));
  } finally {
    db.close();
  }
}

function createZipArchive(destination, databaseFile, manifestText) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destination);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.file(databaseFile, { name: 'deadline-desk.db' });
    archive.append(manifestText, { name: 'manifest.json' });
    archive.finalize();
  });
}

async function buildRestoreZip(sourceDbFile, targetZip = STAGE_H_RESTORE, workingDbFile = path.join(outputDir, 'stage-h-restore.db')) {
  const SQL = await loadSqlJs();
  const db = new SQL.Database(fs.readFileSync(sourceDbFile));
  const restoreDb = workingDbFile;
  try {
    db.run("UPDATE settings SET value = ? WHERE key = 'ai_endpoint'", [BACKUP_ENDPOINT]);
    db.run("UPDATE settings SET value = ? WHERE key = 'ai_model'", [BACKUP_MODEL]);
    db.run("INSERT INTO settings (key, value) VALUES ('ai_api_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [BACKUP_KEY]);
    fs.writeFileSync(restoreDb, Buffer.from(db.export()));
  } finally {
    db.close();
  }
  await createZipArchive(
    targetZip,
    restoreDb,
    JSON.stringify({ app: 'Deadline Desk', version: 1, createdAt: new Date().toISOString() })
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

  await resetAssistant(page);
  const itemsBefore52 = await snapshotItems(page);
  await assistantInput(page, 'MOCK_MULTI');
  await submitAssistant(page);
  await waitAssistant(page, '.assistant-summary');
  const clarify52 = await page.evaluate(() => ({
    text: document.querySelector('.assistant-summary')?.innerText.trim() || '',
    actions: document.querySelectorAll('#assistantResult [data-assistant-action]').length,
    records: document.querySelectorAll('.assistant-record').length,
    input: document.querySelector('#assistantInput').value
  }));
  assert(clarify52.text.includes('请拆开分别提交'), `多意图提示不正确：${clarify52.text}`);
  assert(clarify52.actions === 0, `多意图不应渲染执行入口，实际 ${clarify52.actions}`);
  assert(clarify52.records === 0, `多意图不应产生操作记录，实际 ${clarify52.records}`);
  assert(clarify52.input === 'MOCK_MULTI', `多意图后输入应保留，实际 ${clarify52.input}`);
  assert(await snapshotItems(page) === itemsBefore52, '多意图不应写入事项');

  await resetAssistant(page);
  await assistantInput(page, 'MOCK_UNSUPPORTED');
  await submitAssistant(page);
  await waitAssistant(page, '.assistant-summary');
  const unsupported52 = await page.evaluate(() => ({
    text: document.querySelector('.assistant-summary')?.innerText.trim() || '',
    actions: document.querySelectorAll('#assistantResult [data-assistant-action]').length,
    records: document.querySelectorAll('.assistant-record').length,
    input: document.querySelector('#assistantInput').value
  }));
  assert(unsupported52.text.includes('不支持生成周报。'), `越界意图提示不正确：${unsupported52.text}`);
  assert(unsupported52.actions === 0, `越界意图不应渲染执行入口，实际 ${unsupported52.actions}`);
  assert(unsupported52.records === 0, `越界意图不应产生操作记录，实际 ${unsupported52.records}`);
  assert(unsupported52.input === 'MOCK_UNSUPPORTED', `越界意图后输入应保留，实际 ${unsupported52.input}`);
  assert(await snapshotItems(page) === itemsBefore52, '越界意图不应写入事项');
  passCheck(52);

  await resetAssistant(page);
  const itemsBefore53 = await itemsOf(page);
  await assistantInput(page, 'MOCK_UI_DUPLICATE');
  await submitAssistant(page);
  await waitAssistant(page, '[data-row-id="c0"]');
  const duplicate53 = await page.evaluate(() => {
    const first = document.querySelector('[data-row-id="c0"]');
    const second = document.querySelector('[data-row-id="c1"]');
    return {
      duplicate: Boolean(first.querySelector('.assistant-badge.duplicate')),
      checked: first.querySelector('input[data-assistant-field="selected"]').checked,
      disabled: first.querySelector('input[data-assistant-field="selected"]').disabled,
      secondChecked: second.querySelector('input[data-assistant-field="selected"]').checked,
      secondExpired: Boolean(second.querySelector('.assistant-badge.expired'))
    };
  });
  assert(duplicate53.duplicate === true, 'c0 应标记「疑似重复」');
  assert(duplicate53.checked === false, 'c0 疑似重复应默认不勾选');
  assert(duplicate53.disabled === false, 'c0 疑似重复应允许用户坚持勾选');
  assert(duplicate53.secondChecked === true && duplicate53.secondExpired === true, `c1 应已过期且默认勾选：${JSON.stringify(duplicate53)}`);

  await page.click('[data-row-id="c0"] input[data-assistant-field="selected"]');
  await waitAssistantText(page, '[data-assistant-action="write-create"]', '写入 2 条');
  await page.click('[data-assistant-action="write-create"]');
  await waitAssistantRecordCount(page, 1);
  const items53 = await itemsOf(page);
  assert(items53.length === itemsBefore53.length + 2, `应新增 2 条，实际 ${items53.length - itemsBefore53.length}`);
  const duplicateCreated53 = items53.find(item => item.title === '数据库课设');
  assert(Boolean(duplicateCreated53) && duplicateCreated53.deadline === `${localDate(3)} 23:59`, `疑似重复项应被写入且截止时间正确：${JSON.stringify(duplicateCreated53)}`);
  const expiredCreated53 = items53.find(item => item.title === '补录旧通知');
  assert(Boolean(expiredCreated53) && expiredCreated53.deadline === `${localDate(-3)} 02:00`, `过期候选应可写入：${JSON.stringify(expiredCreated53)}`);
  const record53 = await page.innerText('#assistantRecords');
  assert(record53.includes('已新增「数据库课设」'), `记录缺少疑似重复项新增明细：${record53}`);
  assert(record53.includes('新增 2 条（成功 2，失败 0）'), `记录缺少新增汇总：${record53}`);
  passCheck(53);

  await resetAssistant(page);
  await assistantInput(page, 'MOCK_UI_DELETE_PARTIAL');
  await submitAssistant(page);
  await waitAssistant(page, '[data-target-id="6"]');
  const targets54 = await page.evaluate(() => [...document.querySelectorAll('#assistantResult .assistant-target-row')].map(row => ({
    id: Number(row.dataset.targetId),
    checked: row.querySelector('input[data-assistant-field="selected"]').checked
  })));
  assert(targets54.map(target => target.id).join(',') === '6,7', `删除目标顺序不正确：${targets54.map(target => target.id).join(',')}`);
  assert(targets54.every(target => target.checked === true), `标题唯一的删除目标应默认全选：${JSON.stringify(targets54)}`);
  const deleteButtonText54 = await page.innerText('[data-assistant-action="delete"]');
  assert(deleteButtonText54 === '删除 2 条', `删除按钮文案不正确：${deleteButtonText54}`);

  await page.evaluate(() => window.deadlineDesk.items.remove(6));
  const recordsBefore54 = await page.evaluate(() => document.querySelectorAll('.assistant-record').length);
  await page.click('[data-assistant-action="delete"]');
  await waitAssistant(page, '#confirmModal.open');
  await page.click('#confirmAccept');
  await waitAssistantRecordCount(page, recordsBefore54 + 1);
  const items54 = await itemsOf(page);
  assert(!items54.some(item => item.id === 6), '确认前已删除的 id 6 不应复活');
  assert(!items54.some(item => item.id === 7), '其余已勾选且仍存在的 id 7 应继续删除');
  assert(items54.some(item => item.id === 3) && items54.some(item => item.id === 4), '未勾选事项不应受影响');
  const record54 = await page.innerText('#assistantRecords');
  assert(record54.includes('「上月未完成作业」已不存在（跳过）'), `记录缺少已不存在跳过明细：${record54}`);
  assert(record54.includes('删除 2 条（成功 1，跳过 1，失败 0）'), `记录缺少批量删除汇总：${record54}`);
  passCheck(54);

  await page.click('.nav-item[data-page="settings"]');
}

async function runStageG(electronApp, mock, pageErrors) {
  const page = await openStagePage(electronApp, pageErrors);
  await mock.resetMock();
  await page.click('.nav-item[data-page="assistant"]');
  await waitAssistantConfig(page, 'ready');
  await waitAssistantText(page, '#assistantResult', '提交后会在这里显示预览或答复。');
  const restarted51 = await page.evaluate(() => ({
    input: document.querySelector('#assistantInput').value,
    records: document.querySelectorAll('.assistant-record').length,
    placeholder: document.querySelector('#assistantResult').innerText.includes('提交后会在这里显示预览或答复。')
  }));
  assert(restarted51.input === '', `重启后输入不应残留，实际 ${restarted51.input}`);
  assert(restarted51.records === 0, `重启后不应保留操作记录，实际 ${restarted51.records}`);
  assert(restarted51.placeholder === true, `重启后结果区应只显示占位：${JSON.stringify(restarted51)}`);
  passCheck(51);
  await page.click('.nav-item[data-page="settings"]');
  await waitSettingsReady(page);

  const initial42 = await page.evaluate(() => ({
    headings: [...document.querySelectorAll('[data-page-view="settings"] .settings-group h2')].map(node => node.textContent.trim()),
    endpoint: document.querySelector('#aiEndpointInput').value,
    endpointType: document.querySelector('#aiEndpointInput').type,
    model: document.querySelector('#aiModelInput').value,
    modelMax: document.querySelector('#aiModelInput').maxLength,
    mask: document.querySelector('#aiKeyMask').textContent.trim(),
    keyHidden: document.querySelector('#aiKeyField').classList.contains('hidden'),
    keyType: document.querySelector('#aiKeyInput').type,
    keyMax: document.querySelector('#aiKeyInput').maxLength,
    keyValue: document.querySelector('#aiKeyInput').value,
    status: document.querySelector('#aiSettingsStatus').dataset.aiStatus,
    statusText: document.querySelector('#aiSettingsStatus').textContent.trim()
  }));
  assert(initial42.headings.join(',') === '提醒,桌面小组件,AI 配置,备份与恢复,本地数据', `设置页分组顺序不正确：${initial42.headings.join(',')}`);
  assert(initial42.endpoint === mockEndpoint && initial42.endpointType === 'url', `接口地址回填或类型不正确：${JSON.stringify(initial42)}`);
  assert(initial42.model === model && initial42.modelMax === 200, `模型名回填或长度限制不正确：${JSON.stringify(initial42)}`);
  assert(initial42.mask === `已保存（${expectedKeyMask}）`, `Key 掩码不正确：${initial42.mask}`);
  assert(initial42.keyHidden === true && initial42.keyType === 'password' && initial42.keyMax === 4096 && initial42.keyValue === '', `Key 输入框初始态不正确：${JSON.stringify(initial42)}`);
  assert(initial42.status === 'ready' && initial42.statusText === '配置完整，助手页可用', `状态行初始态不正确：${JSON.stringify(initial42)}`);
  passCheck(42);

  await page.click('#aiKeyEditButton');
  const edit43 = await page.evaluate(() => ({
    hidden: document.querySelector('#aiKeyField').classList.contains('hidden'),
    visible: document.querySelector('#aiKeyInput').getClientRects().length > 0,
    value: document.querySelector('#aiKeyInput').value
  }));
  assert(edit43.hidden === false && edit43.visible === true && edit43.value === '', `修改 Key 后输入框状态不正确：${JSON.stringify(edit43)}`);

  await page.click('#aiSettingsSave');
  await waitToast(page, 'AI 配置已保存');
  const after43 = await page.evaluate(() => ({
    hidden: document.querySelector('#aiKeyField').classList.contains('hidden'),
    value: document.querySelector('#aiKeyInput').value,
    mask: document.querySelector('#aiKeyMask').textContent.trim()
  }));
  assert(after43.hidden === true && after43.value === '' && after43.mask === `已保存（${expectedKeyMask}）`, `留空保存后 Key 展示不正确：${JSON.stringify(after43)}`);
  const ai43 = await readAi(page);
  assert(ai43.keyMask === expectedKeyMask && ai43.configured === true, `留空保存不应改变已存 Key：${JSON.stringify(ai43)}`);
  assert(mock.requests.length === 0, '保存配置不得发起模型请求');
  passCheck(43);

  await page.click('#aiKeyEditButton');
  await page.fill('#aiKeyInput', NEW_API_KEY);
  await page.click('#aiSettingsSave');
  await page.waitForFunction(mask => document.querySelector('#aiKeyMask').textContent.includes(mask), NEW_KEY_MASK, { timeout: 5000 });
  const after44 = await page.evaluate(() => ({
    mask: document.querySelector('#aiKeyMask').textContent.trim(),
    hidden: document.querySelector('#aiKeyField').classList.contains('hidden'),
    value: document.querySelector('#aiKeyInput').value
  }));
  assert(after44.mask === `已保存（${NEW_KEY_MASK}）` && after44.hidden === true && after44.value === '', `保存新 Key 后展示不正确：${JSON.stringify(after44)}`);
  const ai44 = await readAi(page);
  assert(ai44.keyMask === NEW_KEY_MASK && ai44.configured === true && ai44.endpoint === mockEndpoint && ai44.model === model, `保存新 Key 后配置不正确：${JSON.stringify(ai44)}`);
  assert(mock.requests.length === 0, '保存新 Key 不得发起模型请求');

  await page.click('.nav-item[data-page="assistant"]');
  await waitAssistantConfig(page, 'ready');
  const warning44 = await page.evaluate(() => ({
    config: document.querySelector('#assistantConfigWarning').dataset.config,
    hidden: document.querySelector('#assistantConfigWarning').classList.contains('hidden')
  }));
  assert(warning44.config === 'ready' && warning44.hidden === true, `助手页配置提示未同步：${JSON.stringify(warning44)}`);
  const ai44Entry = await readAi(page);
  assert(ai44Entry.configured === true, `助手页读取配置应保持完整：${JSON.stringify(ai44Entry)}`);

  await page.click('.nav-item[data-page="settings"]');
  const back44 = await page.evaluate(() => ({
    endpoint: document.querySelector('#aiEndpointInput').value,
    model: document.querySelector('#aiModelInput').value,
    mask: document.querySelector('#aiKeyMask').textContent.trim(),
    hidden: document.querySelector('#aiKeyField').classList.contains('hidden'),
    value: document.querySelector('#aiKeyInput').value
  }));
  assert(back44.endpoint === mockEndpoint && back44.model === model && back44.mask === `已保存（${NEW_KEY_MASK}）` && back44.hidden === true && back44.value === '', `返回设置页后表单值不正确：${JSON.stringify(back44)}`);
  passCheck(44);

  await page.fill('#aiModelInput', '');
  await page.click('#aiSettingsSave');
  await page.waitForFunction(() => document.querySelector('#aiSettingsStatus')?.dataset.aiStatus === 'missing', null, { timeout: 5000 });
  const missing45 = await page.evaluate(() => ({
    status: document.querySelector('#aiSettingsStatus').dataset.aiStatus,
    text: document.querySelector('#aiSettingsStatus').textContent.trim()
  }));
  assert(missing45.status === 'missing' && missing45.text === '配置不完整，助手功能不可用', `空模型保存后状态行不正确：${JSON.stringify(missing45)}`);
  const ai45 = await readAi(page);
  assert(ai45.configured === false && ai45.endpoint === mockEndpoint && ai45.keyMask === NEW_KEY_MASK, `空模型保存后配置不正确：${JSON.stringify(ai45)}`);

  await page.click('.nav-item[data-page="assistant"]');
  await waitAssistantConfig(page, 'missing');
  const warning45 = await page.evaluate(() => ({
    config: document.querySelector('#assistantConfigWarning').dataset.config,
    hidden: document.querySelector('#assistantConfigWarning').classList.contains('hidden')
  }));
  assert(warning45.config === 'missing' && warning45.hidden === false, `不完整配置应显示助手提示：${JSON.stringify(warning45)}`);
  const ai45Entry = await readAi(page);
  assert(ai45Entry.configured === false, `助手页读取配置应仍为不完整：${JSON.stringify(ai45Entry)}`);

  await page.click('.nav-item[data-page="settings"]');
  await page.fill('#aiModelInput', model);
  await page.click('#aiSettingsSave');
  await waitSettingsReady(page);
  await page.click('.nav-item[data-page="assistant"]');
  await waitAssistantConfig(page, 'ready');
  const warning45b = await page.evaluate(() => ({
    config: document.querySelector('#assistantConfigWarning').dataset.config,
    hidden: document.querySelector('#assistantConfigWarning').classList.contains('hidden')
  }));
  assert(warning45b.config === 'ready' && warning45b.hidden === true, `补全模型后助手提示应隐藏：${JSON.stringify(warning45b)}`);
  passCheck(45);

  await page.click('.nav-item[data-page="settings"]');
  await page.fill('#aiEndpointInput', 'ftp://x');
  const typed46 = await page.evaluate(() => document.querySelector('#aiEndpointInput').value);
  assert(typed46 === 'ftp://x', `非法地址未填入输入框：${typed46}`);
  await page.click('#aiSettingsSave');
  await waitToast(page, 'http/https');
  const after46 = await page.evaluate(() => ({
    endpoint: document.querySelector('#aiEndpointInput').value,
    status: document.querySelector('#aiSettingsStatus').dataset.aiStatus,
    text: document.querySelector('#aiSettingsStatus').textContent.trim()
  }));
  assert(after46.endpoint === 'ftp://x', `保存失败不应重置用户输入：${after46.endpoint}`);
  assert(after46.status === 'ready' && after46.text === '配置完整，助手页可用', `保存失败不应改变状态行：${JSON.stringify(after46)}`);
  const ai46 = await readAi(page);
  assert(ai46.endpoint === mockEndpoint && ai46.model === model && ai46.configured === true, `非法地址不应落库：${JSON.stringify(ai46)}`);
  assert(mock.requests.length === 0, '保存失败不得发起模型请求');
  passCheck(46);

  const leak47 = await page.evaluate(keys => {
    const text = document.querySelector('[data-page-view="settings"]').innerText;
    const values = [...document.querySelectorAll('input')].map(node => node.value).join('\n');
    let storage = '';
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      storage += `${key}=${localStorage.getItem(key)}\n`;
    }
    return {
      textOld: text.includes(keys[0]),
      textNew: text.includes(keys[1]),
      valueOld: values.includes(keys[0]),
      valueNew: values.includes(keys[1]),
      storageOld: storage.includes(keys[0]),
      storageNew: storage.includes(keys[1]),
      keyValue: document.querySelector('#aiKeyInput').value,
      mask: document.querySelector('#aiKeyMask').textContent
    };
  }, [apiKey, NEW_API_KEY]);
  assert(leak47.textOld === false && leak47.textNew === false, '页面明文不应包含完整 Key');
  assert(leak47.valueOld === false && leak47.valueNew === false, '输入框值不应包含完整 Key');
  assert(leak47.storageOld === false && leak47.storageNew === false, 'localStorage 不应写入完整 Key');
  assert(leak47.keyValue === '', `Key 输入框应保持清空：${leak47.keyValue}`);
  assert(leak47.mask.includes(NEW_KEY_MASK) === true, `界面应只展示掩码：${leak47.mask}`);
  passCheck(47);
}

async function runStageH(electronApp, mock, pageErrors) {
  const page = await openStagePage(electronApp, pageErrors);
  await new Promise(resolve => setTimeout(resolve, 400));
  assert(fs.readFileSync(dbPath).includes(Buffer.from(NEW_API_KEY)) === true, '前置：本机数据库应保存本机 Key');

  fs.rmSync(STAGE_H_BACKUP, { force: true });
  await patchSaveDialog(electronApp, STAGE_H_BACKUP);
  const requestsBefore48 = mock.requests.length;

  await page.click('.nav-item[data-page="settings"]');
  await waitSettingsReady(page);
  await page.click('#backupButton');
  await waitToast(page, '备份已保存');
  assert(fs.existsSync(STAGE_H_BACKUP) === true, '备份文件应生成');
  assert(mock.requests.length === requestsBefore48, `备份不应调用模型，实际 ${mock.requests.length}`);
  await mock.resetMock();

  fs.rmSync(STAGE_H_EXTRACT, { recursive: true, force: true });
  fs.mkdirSync(STAGE_H_EXTRACT, { recursive: true });
  await extract(STAGE_H_BACKUP, { dir: STAGE_H_EXTRACT });
  assert(fs.existsSync(STAGE_H_DB) === true, '备份应包含数据库');
  assert(fs.existsSync(path.join(STAGE_H_EXTRACT, 'manifest.json')) === true, '备份应包含 manifest');

  const settings48 = await readDbSettings(STAGE_H_DB);
  assert(settings48.ai_endpoint === mockEndpoint, `备份应保留接口地址：${JSON.stringify(settings48)}`);
  assert(settings48.ai_model === model, `备份应保留模型名：${JSON.stringify(settings48)}`);
  assert(settings48.ai_api_key === undefined, `备份不应包含 API Key：${JSON.stringify(settings48)}`);
  assert(fs.readFileSync(STAGE_H_DB).includes(Buffer.from(NEW_API_KEY)) === false, '备份数据库不应包含 Key 字节');
  const manifestText48 = fs.readFileSync(path.join(STAGE_H_EXTRACT, 'manifest.json'), 'utf8');
  const manifest48 = JSON.parse(manifestText48);
  assert(manifest48.app === 'Deadline Desk' && manifest48.version === 1, `manifest 不正确：${manifestText48}`);
  assert(manifestText48.includes(NEW_API_KEY) === false, 'manifest 不应包含 Key');
  passCheck(48);

  await buildRestoreZip(STAGE_H_DB);
  await patchOpenDialog(electronApp, STAGE_H_RESTORE);
  await page.click('#restoreButton');
  await waitAssistant(page, '#confirmModal.open');
  await page.click('#confirmAccept');
  await waitToast(page, '备份已恢复');
  await waitSettingsLoaded(page, BACKUP_ENDPOINT);

  const ai49 = await readAi(page);
  assert(ai49.endpoint === BACKUP_ENDPOINT && ai49.model === BACKUP_MODEL, `恢复后应使用备份地址与模型：${JSON.stringify(ai49)}`);
  assert(ai49.keyMask === NEW_KEY_MASK && ai49.configured === true, `恢复后应回填本机 Key：${JSON.stringify(ai49)}`);

  const dom49 = await page.evaluate(() => ({
    endpoint: document.querySelector('#aiEndpointInput').value,
    model: document.querySelector('#aiModelInput').value,
    mask: document.querySelector('#aiKeyMask').textContent.trim(),
    keyHidden: document.querySelector('#aiKeyField').classList.contains('hidden'),
    status: document.querySelector('#aiSettingsStatus').dataset.aiStatus,
    statusText: document.querySelector('#aiSettingsStatus').textContent.trim()
  }));
  assert(dom49.endpoint === BACKUP_ENDPOINT, `接口地址表单未同步：${dom49.endpoint}`);
  assert(dom49.model === BACKUP_MODEL, `模型表单未同步：${dom49.model}`);
  assert(dom49.mask === `已保存（${NEW_KEY_MASK}）`, `Key 掩码表单未同步：${dom49.mask}`);
  assert(dom49.keyHidden === true, 'Key 输入框应隐藏');
  assert(dom49.status === 'ready' && dom49.statusText === '配置完整，助手页可用', `状态行未同步：${JSON.stringify(dom49)}`);
  assert(mock.requests.length === 0, `恢复不应调用模型，实际 ${mock.requests.length}`);

  await page.click('#clearDataButton');
  await waitAssistant(page, '#confirmModal.open');
  await page.click('#confirmAccept');
  await pollPage(page, () => document.querySelector('#confirmTitle')?.textContent.trim() === '再次确认清空', undefined, '等待二次确认弹窗超时');
  await page.click('#confirmAccept');
  await waitToast(page, '全部数据已清空');

  const ai49b = await readAi(page);
  assert(ai49b.endpoint === BACKUP_ENDPOINT && ai49b.model === BACKUP_MODEL, `清空后配置应保留：${JSON.stringify(ai49b)}`);
  assert(ai49b.keyMask === NEW_KEY_MASK && ai49b.configured === true, `清空后 Key 应保留：${JSON.stringify(ai49b)}`);
  const dom49b = await page.evaluate(() => ({
    endpoint: document.querySelector('#aiEndpointInput').value,
    model: document.querySelector('#aiModelInput').value,
    mask: document.querySelector('#aiKeyMask').textContent.trim(),
    status: document.querySelector('#aiSettingsStatus').dataset.aiStatus
  }));
  assert(dom49b.endpoint === BACKUP_ENDPOINT && dom49b.model === BACKUP_MODEL, `清空后表单项变化：${JSON.stringify(dom49b)}`);
  assert(dom49b.mask === `已保存（${NEW_KEY_MASK}）` && dom49b.status === 'ready', `清空后表单状态变化：${JSON.stringify(dom49b)}`);

  await new Promise(resolve => setTimeout(resolve, 400));
  assert(fs.readFileSync(dbPath).includes(Buffer.from(NEW_API_KEY)) === true, '恢复并清空后本机 Key 应落盘');
  passCheck(49);
}

async function runStageH2(electronApp, mock, pageErrors) {
  const page = await openStagePage(electronApp, pageErrors);
  await patchOpenDialog(electronApp, STAGE_H_RESTORE);
  await page.click('.nav-item[data-page="settings"]');
  await waitSettingsLoaded(page, BACKUP_ENDPOINT);

  await page.click('#restoreButton');
  await waitAssistant(page, '#confirmModal.open');
  await page.click('#confirmAccept');
  await waitToast(page, '备份已恢复');
  await waitSettingsLoaded(page, BACKUP_ENDPOINT);

  const ai50 = await readAi(page);
  assert(ai50.endpoint === BACKUP_ENDPOINT && ai50.model === BACKUP_MODEL, `无 Key 恢复后应使用备份地址与模型：${JSON.stringify(ai50)}`);
  assert(ai50.keyMask === '' && ai50.configured === false, `无 Key 恢复后应保持未配置：${JSON.stringify(ai50)}`);

  const dom50 = await page.evaluate(() => ({
    mask: document.querySelector('#aiKeyMask').textContent.trim(),
    status: document.querySelector('#aiSettingsStatus').dataset.aiStatus,
    statusText: document.querySelector('#aiSettingsStatus').textContent.trim(),
    endpoint: document.querySelector('#aiEndpointInput').value,
    model: document.querySelector('#aiModelInput').value,
    keyHidden: document.querySelector('#aiKeyField').classList.contains('hidden')
  }));
  assert(dom50.mask === '未设置', `无 Key 时掩码文案不正确：${dom50.mask}`);
  assert(dom50.status === 'missing' && dom50.statusText === '配置不完整，助手功能不可用', `无 Key 时状态行不正确：${JSON.stringify(dom50)}`);
  assert(dom50.endpoint === BACKUP_ENDPOINT && dom50.model === BACKUP_MODEL, `无 Key 恢复后表单未同步：${JSON.stringify(dom50)}`);
  assert(dom50.keyHidden === true, 'Key 输入框应隐藏');
}

async function runStageI(electronApp, mock, pageErrors) {
  const page = await openStagePage(electronApp, pageErrors);
  await page.click('.nav-item[data-page="settings"]');
  await waitSettingsLoaded(page, BACKUP_ENDPOINT);

  const dom55 = await page.evaluate(() => {
    const select = document.querySelector('#aiProtocolSelect');
    const group = document.querySelector('#aiSettingsGroup');
    const field = select ? select.closest('.field') : null;
    return {
      exists: Boolean(select),
      inForm: Boolean(select && select.closest('#aiSettingsGroup .ai-settings-form')),
      value: select ? select.value : null,
      options: select ? [...select.options].map(option => [option.value, option.textContent.trim()]) : [],
      fieldClasses: field ? [...field.classList] : [],
      disabled: select ? select.disabled : null,
      note: group ? group.querySelector('.setting-note').innerText : ''
    };
  });
  assert(dom55.exists === true && dom55.inForm === true, '协议下拉缺失或不在 AI 配置表单内');
  assert(dom55.value === 'openai', `协议下拉默认值应为 openai，实际 ${dom55.value}`);
  const expectedOptions55 = [['openai', 'OpenAI 兼容'], ['anthropic', 'Anthropic Messages API']];
  assert(JSON.stringify(dom55.options) === JSON.stringify(expectedOptions55), `协议选项不正确：${JSON.stringify(dom55.options)}`);
  assert(dom55.fieldClasses.includes('field') && dom55.fieldClasses.includes('full'), `协议下拉应位于 field full：${JSON.stringify(dom55.fieldClasses)}`);
  assert(dom55.disabled === false, '协议下拉不应禁用');
  const noteWords55 = ['接口协议', '接口地址', '模型名', '随导出备份保存', 'API Key', '本机 Key', '界面只显示掩码'];
  assert(noteWords55.every(word => dom55.note.includes(word)), `AI 分组说明缺少治理口径：${dom55.note}`);
  passCheck(55);

  const requestsBefore56 = mock.requests.length;
  await page.click('#aiKeyEditButton');
  await page.fill('#aiKeyInput', ANTHROPIC_KEY);
  await page.fill('#aiEndpointInput', mockEndpoint);
  await page.fill('#aiModelInput', model);
  const formBefore56 = await page.evaluate(() => ({
    endpoint: document.querySelector('#aiEndpointInput').value,
    model: document.querySelector('#aiModelInput').value,
    key: document.querySelector('#aiKeyInput').value,
    keyVisible: document.querySelector('#aiKeyInput').getClientRects().length > 0,
    mask: document.querySelector('#aiKeyMask').textContent.trim(),
    status: document.querySelector('#aiSettingsStatus').textContent.trim()
  }));
  await page.selectOption('#aiProtocolSelect', 'anthropic');
  const formAfter56 = await page.evaluate(() => ({
    endpoint: document.querySelector('#aiEndpointInput').value,
    model: document.querySelector('#aiModelInput').value,
    key: document.querySelector('#aiKeyInput').value,
    keyVisible: document.querySelector('#aiKeyInput').getClientRects().length > 0,
    mask: document.querySelector('#aiKeyMask').textContent.trim(),
    status: document.querySelector('#aiSettingsStatus').textContent.trim()
  }));
  assert(formAfter56.endpoint === formBefore56.endpoint && formAfter56.model === formBefore56.model, `切换协议不应改动地址或模型：${JSON.stringify(formAfter56)}`);
  assert(formAfter56.keyVisible === true && formAfter56.key === ANTHROPIC_KEY, `切换协议不应清空 Key 输入：${JSON.stringify(formAfter56)}`);
  assert(formAfter56.mask === formBefore56.mask, `切换协议不应改动 Key 掩码：${formAfter56.mask}`);
  assert(formAfter56.status === formBefore56.status, `切换协议不应改动状态行：${formAfter56.status}`);
  const unsaved56 = await readAi(page);
  assert(unsaved56.protocol === 'openai', `切换协议不应隐式保存：${JSON.stringify(unsaved56)}`);
  assert(mock.requests.length === requestsBefore56, '切换协议不得发起模型请求');

  await page.click('#aiSettingsSave');
  await waitToast(page, 'AI 配置已保存');
  await waitSettingsReady(page);
  const saved56 = await readAi(page);
  assert(saved56.configured === true && saved56.protocol === 'anthropic', `保存后协议应为 anthropic：${JSON.stringify(saved56)}`);
  assert(saved56.endpoint === mockEndpoint && saved56.model === model && saved56.keyMask === ANTHROPIC_KEY_MASK, `保存后配置不正确：${JSON.stringify(saved56)}`);
  const select56 = await page.evaluate(() => document.querySelector('#aiProtocolSelect').value);
  assert(select56 === 'anthropic', `保存后下拉应保持 anthropic，实际 ${select56}`);
  await new Promise(resolve => setTimeout(resolve, 400));
  const db56 = await readDbSettings(dbPath);
  assert(db56.ai_protocol === 'anthropic' && db56.ai_endpoint === mockEndpoint, `协议未落库：${JSON.stringify(db56)}`);
  assert(mock.requests.length === requestsBefore56, '保存配置不得发起模型请求');
  passCheck(56);

  await mock.resetMock();
  const result57 = await parse(page, 'MOCK_CREATE');
  assert(mock.requests.length === 1, `新增意图应只调用一次模型，实际 ${mock.requests.length}`);
  const request57 = mock.requests[0];
  assert(request57.protocol === 'anthropic', `请求应使用 Anthropic 协议：${request57.protocol}`);
  assert(request57.method === 'POST' && request57.url === mockEndpoint, `请求行不正确：${request57.method} ${request57.url}`);
  assert(request57.headers['content-type'] === 'application/json', `content-type 不正确：${request57.headers['content-type']}`);
  assert(request57.headers['x-api-key'] === ANTHROPIC_KEY, `x-api-key 不正确：${request57.headers['x-api-key']}`);
  assert(request57.headers['anthropic-version'] === ANTHROPIC_VERSION, `anthropic-version 不正确：${request57.headers['anthropic-version']}`);
  assert(request57.headers.authorization === undefined && request57.headers.accept === undefined, `不应携带 OpenAI 请求头：${JSON.stringify(request57.headers)}`);
  const bodyKeys57 = Object.keys(request57.body).sort().join(',');
  assert(bodyKeys57 === 'max_tokens,messages,model,system,temperature', `请求体字段不正确：${bodyKeys57}`);
  assert(request57.body.model === model && request57.body.max_tokens === ANTHROPIC_MAX_TOKENS && request57.body.temperature === 0, `请求体参数不正确：${JSON.stringify(request57.body)}`);
  assert(typeof request57.body.system === 'string' && request57.body.system.includes('intent') && request57.body.system.includes('detectedIntents'), 'system 提示词未完整迁入');
  assert(request57.body.messages.length === 1 && request57.body.messages.every(item => item.role !== 'system'), `messages 不应包含 system：${JSON.stringify(request57.body.messages)}`);
  const user57 = JSON.parse(request57.body.messages[0].content);
  assert(request57.body.messages[0].role === 'user' && Object.keys(user57).sort().join(',') === 'input,items,now' && user57.input === 'MOCK_CREATE', `user 消息不正确：${JSON.stringify(user57)}`);
  assert(result57.ok === true && result57.intent === 'create' && typeof result57.omittedCount === 'number', `新增结果不正确：${JSON.stringify(result57)}`);
  passCheck(57);

  await mock.resetMock();
  const result58 = await parse(page, 'MOCK_QUERY_THIS_MONTH');
  assert(mock.requests.length === 2, `查询应调用两次模型，实际 ${mock.requests.length}`);
  for (const request of mock.requests) {
    assert(request.protocol === 'anthropic', `查询请求应使用 Anthropic 协议：${request.protocol}`);
    assert(request.headers.authorization === undefined && request.headers['anthropic-version'] === ANTHROPIC_VERSION && request.headers['x-api-key'] === ANTHROPIC_KEY, `查询请求头不正确：${JSON.stringify(request.headers)}`);
    assert(request.body.max_tokens === ANTHROPIC_MAX_TOKENS && request.body.temperature === 0, `查询请求参数不正确：${JSON.stringify(request.body)}`);
    assert(typeof request.body.system === 'string', '查询请求缺少 system');
    assert(request.body.messages.every(item => item.role !== 'system'), `查询 messages 不应包含 system：${JSON.stringify(request.body.messages)}`);
  }
  const first58 = JSON.parse(mock.requests[0].body.messages[0].content);
  assert(first58.input === 'MOCK_QUERY_THIS_MONTH', `首次 user 消息不正确：${JSON.stringify(first58)}`);
  const second58 = JSON.parse(mock.requests[1].body.messages[0].content);
  assert(typeof second58.question === 'string', `第二次 user 消息缺少 question：${JSON.stringify(second58)}`);
  assert(result58.ok === true && result58.intent === 'query' && result58.query.fallback === false, `查询结果不正确：${JSON.stringify(result58)}`);
  assert(result58.query.answer === '按截止时间在本月内：已完成 1 个。', `答复未取第二次文本：${result58.query.answer}`);
  assert(result58.query.meta && typeof result58.query.meta === 'object', '查询 meta 缺失');
  passCheck(58);

  const settingsBefore59 = await snapshotSettings(page);
  const itemsBefore59 = await snapshotItems(page);
  const failures59 = [];
  const cases59 = [
    ['MOCK_ANTHROPIC_MAX_TOKENS', 'invalid_response', true],
    ['MOCK_EMPTY', 'empty_response', true],
    ['MOCK_NOT_JSON', 'invalid_response', true],
    ['MOCK_401', 'http_401', false],
    ['MOCK_500', 'http_5xx', true]
  ];
  for (const [input, code, retryable] of cases59) {
    await mock.resetMock();
    const result = await parse(page, input);
    failures59.push(result);
    assert(result.ok === false && result.code === code && result.retryable === retryable, `${input} 错误映射不正确：${JSON.stringify(result)}`);
  }

  await mock.resetMock();
  const started59 = Date.now();
  const timeout59 = await parse(page, 'MOCK_SLOW');
  const elapsed59 = Date.now() - started59;
  failures59.push(timeout59);
  assert(elapsed59 < 1200, `超时应快速返回，实际 ${elapsed59}ms`);
  assert(timeout59.ok === false && timeout59.code === 'timeout' && timeout59.retryable === true, `超时错误不正确：${JSON.stringify(timeout59)}`);

  const networkSave59 = await saveAi(page, { endpoint: 'http://127.0.0.1:1/v1/messages', model });
  assert(networkSave59.ok === true, `切换网络失败端点应保存成功：${JSON.stringify(networkSave59)}`);
  await mock.resetMock();
  const network59 = await parse(page, 'MOCK_CREATE');
  failures59.push(network59);
  assert(network59.ok === false && network59.code === 'network' && network59.retryable === true, `网络失败错误不正确：${JSON.stringify(network59)}`);
  assert(mock.requests.length === 0, '网络失败不应到达 mock 服务');

  const restoreSave59 = await saveAi(page, { endpoint: mockEndpoint, model });
  assert(restoreSave59.ok === true, `恢复端点应保存成功：${JSON.stringify(restoreSave59)}`);
  assert(restoreSave59.ai.protocol === 'anthropic', `省略协议应保留 anthropic：${JSON.stringify(restoreSave59.ai)}`);
  const ai59 = await readAi(page);
  assert(ai59.protocol === 'anthropic', `恢复端点后协议应仍为 anthropic：${JSON.stringify(ai59)}`);

  const settingsAfter59 = await snapshotSettings(page);
  const itemsAfter59 = await snapshotItems(page);
  assert(settingsAfter59 === settingsBefore59, '错误路径不应改动设置');
  assert(itemsAfter59 === itemsBefore59, '错误路径不应改动事项');
  for (const failure of failures59) {
    const text = `${failure.code} ${failure.message}`;
    assert(text.includes(ANTHROPIC_KEY) === false, `错误提示不应包含 Key：${text}`);
    assert(text.includes('secret-body') === false, `错误提示不应包含响应体：${text}`);
  }
  passCheck(59);

  const requestsBefore61 = mock.requests.length;
  const ai61Before = await readAi(page);
  assert(ai61Before.protocol === 'anthropic', `备份前协议应为 anthropic：${JSON.stringify(ai61Before)}`);

  fs.rmSync(STAGE_I_BACKUP, { force: true });
  await patchSaveDialog(electronApp, STAGE_I_BACKUP);
  await page.click('#backupButton');
  await waitToast(page, '备份已保存');
  assert(fs.existsSync(STAGE_I_BACKUP) === true, '备份文件应生成');
  assert(mock.requests.length === requestsBefore61, `备份不应调用模型，实际 ${mock.requests.length}`);

  fs.rmSync(STAGE_I_EXTRACT, { recursive: true, force: true });
  fs.mkdirSync(STAGE_I_EXTRACT, { recursive: true });
  await extract(STAGE_I_BACKUP, { dir: STAGE_I_EXTRACT });
  assert(fs.existsSync(STAGE_I_DB) === true, '备份应包含数据库');
  assert(fs.existsSync(path.join(STAGE_I_EXTRACT, 'manifest.json')) === true, '备份应包含 manifest');

  const settings61 = await readDbSettings(STAGE_I_DB);
  assert(settings61.ai_protocol === 'anthropic', `备份应保留协议：${JSON.stringify(settings61)}`);
  assert(settings61.ai_endpoint === mockEndpoint && settings61.ai_model === model, `备份应保留地址与模型：${JSON.stringify(settings61)}`);
  assert(settings61.ai_api_key === undefined, `备份不应包含 API Key：${JSON.stringify(settings61)}`);
  assert(fs.readFileSync(STAGE_I_DB).includes(Buffer.from(ANTHROPIC_KEY)) === false, '备份数据库不应包含 Key 字节');
  const manifestText61 = fs.readFileSync(path.join(STAGE_I_EXTRACT, 'manifest.json'), 'utf8');
  assert(manifestText61.includes(ANTHROPIC_KEY) === false, 'manifest 不应包含 Key');

  await buildRestoreZip(STAGE_I_DB, STAGE_I_RESTORE, STAGE_I_RESTORE_DB);
  const switchSave61 = await saveAi(page, { endpoint: mockEndpoint, model, protocol: 'openai' });
  assert(switchSave61.ok === true && switchSave61.ai.protocol === 'openai', `本机协议应改为 openai：${JSON.stringify(switchSave61)}`);
  const local61 = await readAi(page);
  assert(local61.protocol === 'openai', `恢复前本机协议应为 openai：${JSON.stringify(local61)}`);

  await patchOpenDialog(electronApp, STAGE_I_RESTORE);
  await page.click('#restoreButton');
  await waitAssistant(page, '#confirmModal.open');
  await page.click('#confirmAccept');
  await waitToast(page, '备份已恢复');
  await waitSettingsLoaded(page, BACKUP_ENDPOINT);

  const ai61 = await readAi(page);
  assert(ai61.protocol === 'anthropic', `恢复后协议应来自备份：${JSON.stringify(ai61)}`);
  assert(ai61.endpoint === BACKUP_ENDPOINT && ai61.model === BACKUP_MODEL, `恢复后地址与模型不正确：${JSON.stringify(ai61)}`);
  assert(ai61.keyMask === ANTHROPIC_KEY_MASK && ai61.configured === true, `恢复后应回填本机 Key：${JSON.stringify(ai61)}`);
  const dom61 = await page.evaluate(() => ({
    protocol: document.querySelector('#aiProtocolSelect').value,
    status: document.querySelector('#aiSettingsStatus').dataset.aiStatus
  }));
  assert(dom61.protocol === 'anthropic', `恢复后下拉未同步：${dom61.protocol}`);
  assert(dom61.status === 'ready', `恢复后状态行不正确：${dom61.status}`);
  await new Promise(resolve => setTimeout(resolve, 400));
  assert(fs.readFileSync(dbPath).includes(Buffer.from(BACKUP_KEY)) === false, '备份 Key 不应残留在本机数据库');
  passCheck(61);

  await page.selectOption('#aiProtocolSelect', 'openai');
  await page.fill('#aiEndpointInput', mockEndpoint);
  await page.fill('#aiModelInput', model);
  await page.click('#aiSettingsSave');
  await waitToast(page, 'AI 配置已保存');
  await waitSettingsReady(page);
  const saved60 = await readAi(page);
  assert(saved60.protocol === 'openai', `切回 OpenAI 后协议不正确：${JSON.stringify(saved60)}`);
  await new Promise(resolve => setTimeout(resolve, 400));
  const db60 = await readDbSettings(dbPath);
  assert(db60.ai_protocol === 'openai', `切回 OpenAI 后协议未落库：${JSON.stringify(db60)}`);

  await mock.resetMock();
  const result60 = await parse(page, 'MOCK_CREATE');
  assert(mock.requests.length === 1, `切回 OpenAI 后应只调用一次模型，实际 ${mock.requests.length}`);
  const request60 = mock.requests[0];
  assert(request60.protocol === 'openai', `请求应使用 OpenAI 协议：${request60.protocol}`);
  assert(request60.headers.authorization === `Bearer ${ANTHROPIC_KEY}`, `Authorization 不正确：${request60.headers.authorization}`);
  assert(request60.headers['anthropic-version'] === undefined && request60.headers['x-api-key'] === undefined, `不应携带 Anthropic 请求头：${JSON.stringify(request60.headers)}`);
  const bodyKeys60 = Object.keys(request60.body).sort().join(',');
  assert(bodyKeys60 === 'messages,model,temperature', `请求体字段不正确：${bodyKeys60}`);
  assert(request60.body.messages.length === 2, `messages 应为 system+user：${JSON.stringify(request60.body.messages)}`);
  assert(request60.body.messages[0].role === 'system' && request60.body.messages[1].role === 'user', `messages 角色不正确：${JSON.stringify(request60.body.messages)}`);
  assert(result60.ok === true && result60.intent === 'create', `切回 OpenAI 后结果不正确：${JSON.stringify(result60)}`);
  passCheck(60);
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

    electronApp = await launchApp();
    await runStageG(electronApp, mock, pageErrors);
    await stopApp(electronApp);
    electronApp = null;

    electronApp = await launchApp();
    await runStageH(electronApp, mock, pageErrors);
    await stopApp(electronApp);
    electronApp = null;

    await mutateDb([{ sql: "DELETE FROM settings WHERE key = 'ai_api_key'" }]);
    electronApp = await launchApp();
    await runStageH2(electronApp, mock, pageErrors);
    await stopApp(electronApp);
    electronApp = null;
    const settings50 = await readDbSettings(dbPath);
    assert(settings50.ai_api_key === undefined, '恢复不应引入备份 Key');
    assert(fs.readFileSync(dbPath).includes(Buffer.from(BACKUP_KEY)) === false, '备份 Key 不应残留在本机数据库');
    passCheck(50);

    electronApp = await launchApp();
    await runStageI(electronApp, mock, pageErrors);
    await stopApp(electronApp);
    electronApp = null;

    assert(pageErrors.length === 0, `页面异常应为空，实际 ${JSON.stringify(pageErrors)}`);
    passCheck(24);

    const checks = Object.keys(CHECK_TITLES)
      .filter(key => passed.has(key))
      .sort((a, b) => Number(a) - Number(b))
      .map(key => `${key}. ${CHECK_TITLES[key]}`);
    assert(checks.length === 61, `断言数量应为 61，实际 ${checks.length}`);
    console.log(JSON.stringify({ passed: true, checks }));
  } finally {
    if (electronApp) await stopApp(electronApp);
    await mock.close();
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
