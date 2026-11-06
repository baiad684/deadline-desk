/**
 * 助手后端单元测试（依据 detail_v1.md 的 F1–F8 行为契约）
 *
 * 运行方式：node --test scripts/assistant-unit.test.js
 *
 * 加载方式说明：main.js 是 Electron 主进程入口，内部函数不对外导出。
 * 这里用 vm 在独立上下文中加载 main.js 源码，注入 stub electron（whenReady 永不 resolve，
 * 因此不会真正初始化数据库/窗口），再注入内存版 database 与 net.fetch，
 * 从而直接验证设计规定的函数签名与 IPC 处理器行为，不修改任何源码文件。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');
const { describe, test, beforeEach } = require('node:test');

const projectDir = path.resolve(__dirname, '..');
const mainPath = path.join(projectDir, 'main.js');
const preloadPath = path.join(projectDir, 'preload.js');
const mainSource = fs.readFileSync(mainPath, 'utf8');
const preloadSource = fs.readFileSync(preloadPath, 'utf8');

const KEY = 'sk-test-1234567890abcd';
const KEY_MASK = 'sk-t••••abcd';
const MOCK_ENDPOINT = 'http://127.0.0.1:9/v1/chat/completions';
const MODEL = 'mock-model';

const NOT_CONFIGURED_MESSAGE = '尚未完成 AI 配置，请到设置页填写接口地址、API Key 与模型名';
const INVALID_INPUT_MESSAGE = '请输入要处理的内容';
const INVALID_ENDPOINT_MESSAGE = '接口地址格式不正确，请在设置页填写完整的 http/https 地址';
const NETWORK_MESSAGE = '无法连接模型服务，请检查网络、接口地址或系统代理';
const TIMEOUT_MESSAGE = '请求超时（60 秒），请重试';
const EMPTY_RESPONSE_MESSAGE = '模型没有返回内容，请重试';
const INVALID_RESPONSE_MESSAGE = '模型返回内容无法解析，请重试；若持续失败，请确认接口与模型支持 Chat Completions';
const UNKNOWN_INTENT_MESSAGE = '没有理解这条指令，请换一种说法或补充信息。';
const NO_RANGE_MESSAGE = '请补充时间范围（例如本周、下个月、今年）后重试。';
const UNKNOWN_MESSAGE = '处理失败，请重试';

const AI_SETTINGS_ERROR = 'AI 配置格式不正确';
const SET_AI_INVALID_ENDPOINT = '接口地址格式不正确，请填写完整的 http/https 地址';
const SET_AI_MODEL_TOO_LONG = '模型名内容过长';
const SET_AI_KEY_TOO_LONG = 'API Key 内容过长';
const SET_AI_FORBIDDEN = '当前窗口无权执行该操作';
const SET_AI_SAVE_FAILED = '保存失败，请重试';

// ---------- 通用工具 ----------

function plain(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function chatBody(content, finishReason = 'stop') {
  return JSON.stringify({
    id: 'mock',
    object: 'chat.completion',
    created: 1,
    model: MODEL,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }]
  });
}

function httpResponse({ status = 200, body = '' } = {}) {
  return { status, ok: status >= 200 && status < 300, text: async () => body };
}

function chatEnvelope(content, { status = 200, finishReason = 'stop' } = {}) {
  return httpResponse({ status, body: chatBody(content, finishReason) });
}

function createWindowStub(destroyed = false) {
  return { webContents: {}, isDestroyed: () => destroyed };
}

function captureFailure(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('期望抛出异常，但函数正常返回');
}

async function captureRejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('期望 Promise 被拒绝，但正常完成');
}

function localDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localDateTime(offsetHours) {
  const date = new Date();
  date.setMinutes(date.getMinutes() + offsetHours * 60);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function monthDate(offsetMonths, day, time) {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + offsetMonths, day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${time}`;
}

function summaryItem(id, overrides = {}) {
  return {
    id,
    title: `事项 ${id}`,
    kind: 'assignment',
    deadline: localDateTime(id),
    status: 'not_started',
    description: '说明',
    work_type: 'personal',
    ...overrides
  };
}

// ---------- 内存版 database ----------

function createFakeDatabase(seed = {}) {
  const settings = new Map(Object.entries(seed.settings || {}));
  const items = (seed.items || []).map(row => ({ ...row }));
  const state = { failPrepare: false };

  const db = {
    settings,
    items,
    state,
    prepare(sql) {
      if (state.failPrepare) throw new Error('模拟数据库不可用');
      if (sql.includes('FROM settings WHERE key')) {
        return {
          get: key => (settings.has(key) ? { key, value: settings.get(key) } : undefined),
          all: () => Array.from(settings.entries()).map(([key, value]) => ({ key, value }))
        };
      }
      if (sql.includes('FROM items')) {
        return {
          all: () => items.map(row => ({ ...row })).sort((a, b) => a.id - b.id)
        };
      }
      if (sql.includes('INSERT INTO settings')) {
        return {
          run: (...params) => {
            if (params.length >= 2) settings.set(String(params[0]), String(params[1]));
            return { changes: 1, lastInsertRowid: 0 };
          }
        };
      }
      return {
        get: () => undefined,
        all: () => [],
        run: () => ({ changes: 0, lastInsertRowid: 0 })
      };
    }
  };
  return db;
}

function settingsSnapshot(db) {
  return Object.fromEntries(db.settings);
}

// ---------- main.js 加载器 ----------

function createHarness(options = {}) {
  const handlers = new Map();
  const registered = [];
  const fetchCalls = [];
  const wcToWindow = new Map();
  const userDataDir = path.join(os.tmpdir(), 'deadline-desk-unit');
  let fetchImpl = () => Promise.resolve(chatEnvelope('{"intent":"create","message":"ok"}'));
  let currentDatabase;
  let currentWindow;
  let whenReadyCallback = null;

  const fakeElectron = {
    app: {
      requestSingleInstanceLock: () => true,
      quit() {},
      on() {},
      whenReady: () => {
        if (!options.captureWhenReady) return new Promise(() => {});
        return {
          then(callback) {
            whenReadyCallback = callback;
            return { catch() { return this; } };
          }
        };
      },
      setPath() {},
      getPath: () => userDataDir,
      setName() {}
    },
    BrowserWindow: { fromWebContents: sender => wcToWindow.get(sender) || null },
    Menu: { buildFromTemplate: () => ({}) },
    Notification: { isSupported: () => false },
    Tray: function Tray() {},
    dialog: {
      showSaveDialog: async () => ({ canceled: true }),
      showOpenDialog: async () => ({ canceled: true })
    },
    ipcMain: {
      handle: (channel, handler) => {
        registered.push(channel);
        handlers.set(channel, handler);
      }
    },
    nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
    net: {
      fetch: (url, init) => {
        fetchCalls.push({ url, init });
        return fetchImpl(url, init);
      }
    },
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
    shell: { openPath: async () => '' }
  };

  const context = vm.createContext({
    require: name => (name === 'electron' ? fakeElectron : require(name)),
    module: { exports: {} },
    exports: {},
    __filename: mainPath,
    __dirname: projectDir,
    process,
    console,
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate,
    queueMicrotask
  });

  const evalIn = code => vm.runInContext(code, context);
  vm.runInContext(mainSource, context, { filename: mainPath });

  function fn(name) {
    const value = evalIn(`typeof ${name} === 'undefined' ? undefined : ${name}`);
    assert.equal(typeof value, 'function', `main.js 中未找到函数 ${name}`);
    return value;
  }

  function setDatabase(db) {
    currentDatabase = db;
    context.__testDatabase = db;
    evalIn('database = __testDatabase');
  }

  function registerWindow(win) {
    wcToWindow.set(win.webContents, win);
    return win;
  }

  function setMainWindow(win = createWindowStub()) {
    currentWindow = win;
    context.__testMainWindow = win;
    evalIn('mainWindow = __testMainWindow');
    registerWindow(win);
    return win;
  }

  function setFetch(impl) {
    fetchImpl = impl;
  }

  const h = {
    handlers,
    registered,
    fetchCalls,
    fn,
    evalIn,
    setDatabase,
    setFetch,
    setMainWindow,
    createOtherWindow: () => registerWindow(createWindowStub()),
    get database() {
      return currentDatabase;
    },
    get mainWindow() {
      return currentWindow;
    },
    get whenReadyCallback() {
      return whenReadyCallback;
    },
    get mainEvent() {
      return { sender: currentWindow.webContents };
    },
    now: () => evalIn('new Date()'),
    date: (year, month, day, hour = 0, minute = 0) => evalIn(`new Date(${year}, ${month - 1}, ${day}, ${hour}, ${minute})`),
    settingsSnapshot: () => settingsSnapshot(currentDatabase),
    itemsSnapshot: () => JSON.stringify(currentDatabase.items),
    call(channel, event, ...args) {
      const handler = handlers.get(channel);
      assert.ok(handler, `通道 ${channel} 未注册`);
      return handler(event, ...args);
    },
    parse(input) {
      return h.call('assistant:parse', h.mainEvent, input);
    },
    saveAi(payload) {
      return h.call('settings:set-ai', h.mainEvent, payload);
    },
    settingsGet() {
      return h.call('settings:get', h.mainEvent);
    },
    lastRequestBody() {
      const request = fetchCalls[fetchCalls.length - 1];
      return request ? JSON.parse(request.init.body) : undefined;
    },
    reset() {
      fetchCalls.length = 0;
      fetchImpl = () => Promise.resolve(chatEnvelope('{"intent":"create","message":"ok"}'));
      setDatabase(createFakeDatabase());
      setMainWindow(createWindowStub());
    }
  };

  setDatabase(createFakeDatabase());
  setMainWindow(createWindowStub());
  if (!options.captureWhenReady) {
    fn('registerDataHandlers')();
    fn('registerAssistantHandlers')();
  }

  return h;
}

const h = createHarness();

function configuredDatabase(extra = {}) {
  return createFakeDatabase({
    settings: { ai_endpoint: MOCK_ENDPOINT, ai_model: MODEL, ai_api_key: KEY },
    ...extra
  });
}

function seedQueryItems() {
  return createFakeDatabase({
    settings: { ai_endpoint: MOCK_ENDPOINT, ai_model: MODEL, ai_api_key: KEY },
    items: [
      { id: 1, title: '本月已完成大作业', kind: 'assignment', deadline: monthDate(0, 5, '09:00'), status: 'completed', work_type: 'personal' },
      { id: 2, title: '本月未完成活动', kind: 'activity', deadline: monthDate(0, 20, '18:00'), status: 'not_completed', work_type: null },
      { id: 3, title: '上月已完成大作业', kind: 'assignment', deadline: monthDate(-1, 15, '10:00'), status: 'completed', work_type: 'personal' }
    ]
  });
}

// 100 条近期待办会占满摘要上限，5 条上月的已完成事项必然被摘要截断；
// 若查询误用摘要而不是全量事项，将统计不到这 5 条。
function seedOversizedSummaryDatabase() {
  const items = [];
  for (let id = 1; id <= 100; id += 1) {
    items.push({
      id,
      title: `近期待办 ${id}`,
      kind: id % 2 === 1 ? 'assignment' : 'activity',
      deadline: localDateTime(id),
      status: id % 2 === 1 ? 'not_started' : 'not_completed',
      work_type: id % 2 === 1 ? 'personal' : null
    });
  }
  for (let index = 0; index < 5; index += 1) {
    items.push({
      id: 101 + index,
      title: `上月已完成 ${101 + index}`,
      kind: 'assignment',
      deadline: monthDate(-1, 3 + index, '10:00'),
      status: 'completed',
      work_type: 'personal'
    });
  }
  return createFakeDatabase({
    settings: { ai_endpoint: MOCK_ENDPOINT, ai_model: MODEL, ai_api_key: KEY },
    items
  });
}

// ---------- 测试主体 ----------

describe('助手后端单元测试（detail_v1）', () => {
  beforeEach(() => h.reset());

  // ============ F1 AI 配置读写与掩码 ============

  describe('F1 AI 配置读写与掩码', () => {
    test('F1.3 maskApiKey：空值返回空串，短 Key 全掩码，长 Key 保留首尾四位', () => {
      const mask = h.fn('maskApiKey');
      assert.equal(mask(''), '');
      assert.equal(mask(undefined), '');
      assert.equal(mask('short'), '••••');
      assert.equal(mask('12345678901'), '••••');
      assert.equal(mask('123456789012'), '1234••••9012');
      assert.equal(mask(KEY), KEY_MASK);
    });

    test('F1.2 isValidAiEndpoint：只接受可解析的 http/https 地址', () => {
      const valid = h.fn('isValidAiEndpoint');
      assert.equal(valid('https://api.example.com/v1/chat/completions'), true);
      assert.equal(valid(' http://127.0.0.1:8080/v1/chat/completions '), true);
      assert.equal(valid('ftp://example.com'), false);
      assert.equal(valid('not a url'), false);
      assert.equal(valid(''), false);
      assert.equal(valid('   '), false);
      assert.equal(valid('http://'), false);
      assert.equal(valid(123), false);
    });

    test('F1.1 readAiConfig：三项配置读取后 trim，只读不写库', () => {
      const db = createFakeDatabase({
        settings: {
          ai_endpoint: '  https://api.example.com/v1/chat/completions  ',
          ai_model: '  gpt-x  ',
          ai_api_key: '  key-abc  '
        }
      });
      h.setDatabase(db);
      assert.deepEqual(plain(h.fn('readAiConfig')()), {
        endpoint: 'https://api.example.com/v1/chat/completions',
        model: 'gpt-x',
        apiKey: 'key-abc'
      });
      assert.deepEqual(settingsSnapshot(db), {
        ai_endpoint: '  https://api.example.com/v1/chat/completions  ',
        ai_model: '  gpt-x  ',
        ai_api_key: '  key-abc  '
      });
    });

    test('F1.4 buildAiSettingsView：未配置时 configured=false 且掩码为空', () => {
      const view = h.fn('buildAiSettingsView')();
      assert.deepEqual(plain(view), { configured: false, endpoint: '', model: '', keyMask: '' });
    });

    test('F1.4 buildAiSettingsView：三项合法时 configured=true 且返回首尾掩码', () => {
      h.setDatabase(configuredDatabase());
      assert.deepEqual(plain(h.fn('buildAiSettingsView')()), {
        configured: true,
        endpoint: MOCK_ENDPOINT,
        model: MODEL,
        keyMask: KEY_MASK
      });
    });

    test('F1.4 buildAiSettingsView：endpoint 非法或占位缺失时 configured=false，仍返回已存值', () => {
      h.setDatabase(createFakeDatabase({
        settings: { ai_endpoint: 'ftp://x', ai_model: MODEL, ai_api_key: KEY }
      }));
      const badEndpoint = h.fn('buildAiSettingsView')();
      assert.equal(badEndpoint.configured, false);
      assert.equal(badEndpoint.endpoint, 'ftp://x');
      assert.equal(badEndpoint.keyMask, KEY_MASK);

      h.setDatabase(createFakeDatabase({
        settings: { ai_endpoint: MOCK_ENDPOINT, ai_model: MODEL, ai_api_key: '   ' }
      }));
      const emptyKey = h.fn('buildAiSettingsView')();
      assert.equal(emptyKey.configured, false);
      assert.equal(emptyKey.keyMask, '');
    });

    test('F1.5 isMainWindowSender：仅主窗口且未销毁时返回 true', () => {
      const check = h.fn('isMainWindowSender');
      assert.equal(check(h.mainEvent), true);

      const other = h.createOtherWindow();
      assert.equal(check({ sender: other.webContents }), false);
      assert.equal(check({ sender: {} }), false);

      const destroyed = createWindowStub(true);
      h.setMainWindow(destroyed);
      assert.equal(check({ sender: destroyed.webContents }), false);
    });

    test('F1.6 settings:get：返回 ai 视图与其他既有字段', () => {
      const expectedRoot = process.env.DEADLINE_DESK_DATA_DIR || path.join(os.tmpdir(), 'deadline-desk-unit');
      const result = plain(h.settingsGet());
      assert.deepEqual(result, {
        notificationsEnabled: true,
        widgetEnabled: true,
        dataPath: expectedRoot,
        ai: { configured: false, endpoint: '', model: '', keyMask: '' }
      });
      assert.equal(Object.keys(result.ai).length, 4);
    });

    test('F1.6 settings:get：读取已有配置且绝不返回完整 Key', () => {
      const db = configuredDatabase({
        settings: { ai_endpoint: MOCK_ENDPOINT, ai_model: MODEL, ai_api_key: KEY, notifications_enabled: 'false', widget_enabled: 'false' }
      });
      h.setDatabase(db);
      const result = h.settingsGet();
      assert.equal(result.notificationsEnabled, false);
      assert.equal(result.widgetEnabled, false);
      assert.deepEqual(plain(result.ai), {
        configured: true,
        endpoint: MOCK_ENDPOINT,
        model: MODEL,
        keyMask: KEY_MASK
      });
      assert.ok(!JSON.stringify(result).includes(KEY));
    });

    test('F1.7 settings:set-ai：保存完整配置并返回掩码视图，不返回完整 Key', () => {
      const result = h.saveAi({ endpoint: MOCK_ENDPOINT, model: MODEL, apiKey: KEY });
      assert.equal(result.ok, true);
      assert.deepEqual(plain(result.ai), {
        configured: true,
        endpoint: MOCK_ENDPOINT,
        model: MODEL,
        keyMask: KEY_MASK
      });
      assert.equal(h.database.settings.get('ai_endpoint'), MOCK_ENDPOINT);
      assert.equal(h.database.settings.get('ai_model'), MODEL);
      assert.equal(h.database.settings.get('ai_api_key'), KEY);
      assert.ok(!JSON.stringify(result).includes(KEY));
    });

    test('F1.7 settings:set-ai：payload 非普通对象或字段类型非法时返回格式错误且不落库', () => {
      const invalidPayloads = [null, [], 'x', 42, undefined];
      for (const payload of invalidPayloads) {
        const result = h.saveAi(payload);
        assert.equal(result.ok, false);
        assert.equal(result.message, AI_SETTINGS_ERROR);
      }
      const invalidFields = [
        {},
        { model: MODEL },
        { endpoint: 123, model: MODEL },
        { endpoint: MOCK_ENDPOINT, model: null },
        { endpoint: MOCK_ENDPOINT, model: MODEL, apiKey: {} },
        { endpoint: MOCK_ENDPOINT, model: MODEL, apiKey: null },
        { endpoint: MOCK_ENDPOINT, model: MODEL, apiKey: 42 }
      ];
      for (const payload of invalidFields) {
        const result = h.saveAi(payload);
        assert.equal(result.ok, false);
        assert.equal(result.message, AI_SETTINGS_ERROR);
      }
      assert.equal(h.database.settings.size, 0);
    });

    test('F1.7 settings:set-ai：endpoint 非空但非法时不落库，message 含 http/https', () => {
      h.setDatabase(configuredDatabase());
      for (const endpoint of ['ftp://example.com', 'not a url', 'http://']) {
        const result = h.saveAi({ endpoint, model: 'next-model' });
        assert.equal(result.ok, false);
        assert.equal(result.message, SET_AI_INVALID_ENDPOINT);
        assert.ok(result.message.includes('http/https'));
        assert.deepEqual(settingsSnapshot(h.database), {
          ai_endpoint: MOCK_ENDPOINT,
          ai_model: MODEL,
          ai_api_key: KEY
        });
      }
    });

    test('F1.7 settings:set-ai：模型名 200 允许、201 拒绝且不落库', () => {
      const allowed = h.saveAi({ endpoint: MOCK_ENDPOINT, model: 'm'.repeat(200), apiKey: KEY });
      assert.equal(allowed.ok, true);
      assert.equal(h.database.settings.get('ai_model'), 'm'.repeat(200));

      const rejected = h.saveAi({ endpoint: MOCK_ENDPOINT, model: 'm'.repeat(201) });
      assert.equal(rejected.ok, false);
      assert.equal(rejected.message, SET_AI_MODEL_TOO_LONG);
      assert.equal(h.database.settings.get('ai_model'), 'm'.repeat(200));
    });

    test('F1.7 settings:set-ai：API Key 4096 允许、4097 拒绝且不落库', () => {
      const allowed = h.saveAi({ endpoint: MOCK_ENDPOINT, model: MODEL, apiKey: 'k'.repeat(4096) });
      assert.equal(allowed.ok, true);
      assert.equal(h.database.settings.get('ai_api_key').length, 4096);

      const rejected = h.saveAi({ endpoint: MOCK_ENDPOINT, model: MODEL, apiKey: 'k'.repeat(4097) });
      assert.equal(rejected.ok, false);
      assert.equal(rejected.message, SET_AI_KEY_TOO_LONG);
      assert.equal(h.database.settings.get('ai_api_key').length, 4096);
    });

    test('F1.7 settings:set-ai：省略 / 空串 / 空白 apiKey 均保持旧 Key', () => {
      h.setDatabase(configuredDatabase());
      for (const payload of [
        { endpoint: MOCK_ENDPOINT, model: 'next-model' },
        { endpoint: MOCK_ENDPOINT, model: MODEL, apiKey: '' },
        { endpoint: MOCK_ENDPOINT, model: MODEL, apiKey: '   ' }
      ]) {
        const result = h.saveAi(payload);
        assert.equal(result.ok, true);
        assert.equal(h.database.settings.get('ai_api_key'), KEY);
        assert.equal(result.ai.keyMask, KEY_MASK);
      }
    });

    test('F1.7 settings:set-ai：允许保存空地址与空模型，configured=false 并保留旧 Key', () => {
      h.setDatabase(configuredDatabase());
      const result = h.saveAi({ endpoint: '', model: '', apiKey: '' });
      assert.equal(result.ok, true);
      assert.deepEqual(plain(result.ai), {
        configured: false,
        endpoint: '',
        model: '',
        keyMask: KEY_MASK
      });
      assert.equal(h.database.settings.get('ai_endpoint'), '');
      assert.equal(h.database.settings.get('ai_model'), '');
      assert.equal(h.database.settings.get('ai_api_key'), KEY);
    });

    test('F1.7 settings:set-ai：写入前对三项配置 trim', () => {
      const result = h.saveAi({
        endpoint: `  ${MOCK_ENDPOINT}  `,
        model: `  ${MODEL}  `,
        apiKey: `  ${KEY}  `
      });
      assert.equal(result.ok, true);
      assert.equal(h.database.settings.get('ai_endpoint'), MOCK_ENDPOINT);
      assert.equal(h.database.settings.get('ai_model'), MODEL);
      assert.equal(h.database.settings.get('ai_api_key'), KEY);
      assert.equal(result.ai.keyMask, KEY_MASK);
      assert.equal(result.ai.endpoint, MOCK_ENDPOINT);
    });

    test('F1.7 settings:set-ai：非主窗口调用被拒绝且不落库', () => {
      const other = h.createOtherWindow();
      const result = h.call('settings:set-ai', { sender: other.webContents }, { endpoint: MOCK_ENDPOINT, model: MODEL, apiKey: KEY });
      assert.equal(result.ok, false);
      assert.equal(result.message, SET_AI_FORBIDDEN);
      assert.equal(h.database.settings.size, 0);
    });

    test('F1.7 settings:set-ai：来源校验先于 payload / 字段 / 内容校验（非主窗口 + 非法 payload 仍为 forbidden）', () => {
      const db = createFakeDatabase({ settings: { notifications_enabled: 'true' } });
      h.setDatabase(db);
      const before = settingsSnapshot(db);
      const other = h.createOtherWindow();
      const invalidPayloads = [
        null,
        [],
        { endpoint: 123, model: MODEL },
        { endpoint: 'ftp://x', model: 'm'.repeat(201) },
        { endpoint: MOCK_ENDPOINT, model: MODEL, apiKey: {} }
      ];
      for (const payload of invalidPayloads) {
        const result = h.call('settings:set-ai', { sender: other.webContents }, payload);
        assert.equal(result.ok, false, `${JSON.stringify(payload)} 应被来源校验拦截`);
        assert.equal(result.message, SET_AI_FORBIDDEN);
      }
      assert.deepEqual(settingsSnapshot(db), before);
    });

    test('F1.7 settings:set-ai：只改动三个 AI 键，不影响其他 settings 键', () => {
      const db = createFakeDatabase({
        settings: {
          ai_endpoint: MOCK_ENDPOINT,
          ai_model: MODEL,
          ai_api_key: KEY,
          notifications_enabled: 'true',
          widget_enabled: 'false',
          data_path: 'D:/data'
        }
      });
      h.setDatabase(db);
      const saved = h.saveAi({ endpoint: 'http://127.0.0.1:9/v2/chat', model: 'next-model', apiKey: 'next-key-12345678' });
      assert.equal(saved.ok, true);
      assert.deepEqual(settingsSnapshot(db), {
        ai_endpoint: 'http://127.0.0.1:9/v2/chat',
        ai_model: 'next-model',
        ai_api_key: 'next-key-12345678',
        notifications_enabled: 'true',
        widget_enabled: 'false',
        data_path: 'D:/data'
      });

      const afterSuccess = settingsSnapshot(db);
      const failed = h.saveAi({ endpoint: 'ftp://x', model: 'm'.repeat(201), apiKey: 'k'.repeat(4097) });
      assert.equal(failed.ok, false);
      assert.deepEqual(settingsSnapshot(db), afterSuccess);
    });

    test('F1.7 settings:set-ai：校验通过后数据库写入异常返回兜底文案，不向渲染层抛异常', () => {
      const db = configuredDatabase();
      db.state.failPrepare = true;
      h.setDatabase(db);
      const result = h.saveAi({ endpoint: MOCK_ENDPOINT, model: MODEL, apiKey: KEY });
      assert.equal(result.ok, false);
      assert.equal(result.message, SET_AI_SAVE_FAILED);
    });

    test('F1.7 → F1.6 状态交互：saveAi 后 settings:get 立即反映新配置', () => {
      h.saveAi({ endpoint: MOCK_ENDPOINT, model: MODEL, apiKey: KEY });
      const result = plain(h.settingsGet());
      assert.deepEqual(result.ai, {
        configured: true,
        endpoint: MOCK_ENDPOINT,
        model: MODEL,
        keyMask: KEY_MASK
      });
      assert.ok(!JSON.stringify(result).includes(KEY));
    });
  });

  // ============ F2 事项摘要 ============

  describe('F2 事项摘要', () => {
    test('F2.1 readItemsForAssistant：只返回五个字段且按 id 升序', () => {
      const db = createFakeDatabase({
        items: [
          { id: 3, title: 'C', kind: 'activity', deadline: '2026-11-03 12:00', status: 'completed', description: '说明', work_type: 'team' },
          { id: 1, title: 'A', kind: 'assignment', deadline: '2026-11-01 12:00', status: 'not_started', description: '说明', work_type: 'personal' },
          { id: 2, title: 'B', kind: 'assignment', deadline: '2026-11-02 12:00', status: 'completed', description: '说明', work_type: 'personal' }
        ]
      });
      h.setDatabase(db);
      const rows = plain(h.fn('readItemsForAssistant')());
      assert.deepEqual(rows.map(row => row.id), [1, 2, 3]);
      for (const row of rows) {
        assert.deepEqual(Object.keys(row).sort(), ['deadline', 'id', 'kind', 'status', 'title']);
      }
      assert.ok(!JSON.stringify(rows).includes('description'));
      assert.ok(!JSON.stringify(rows).includes('work_type'));
    });

    test('F2.2 parseLocalDateTime：解析本地时间毫秒数，非法格式返回 NaN', () => {
      const parse = h.fn('parseLocalDateTime');
      const expected = new Date(2026, 10, 6, 23, 59).getTime();
      assert.equal(parse('2026-11-06 23:59'), expected);
      assert.equal(parse('2026-11-06 23:59:30'), expected);
      assert.equal(Number.isNaN(parse('2026/11/06 23:59')), true);
      assert.equal(Number.isNaN(parse('')), true);
      assert.equal(Number.isNaN(parse(undefined)), true);
    });

    test('F2.3 buildAssistantSummary：未完成事项整体排在已完成事项之前', () => {
      const db = createFakeDatabase({
        items: [
          summaryItem(1, { deadline: localDateTime(1), status: 'completed' }),
          summaryItem(2, { deadline: localDateTime(48), status: 'not_started' })
        ]
      });
      h.setDatabase(db);
      const summary = plain(h.fn('buildAssistantSummary')(h.now()));
      assert.deepEqual(summary.items.map(item => item.id), [2, 1]);
      assert.equal(summary.omittedCount, 0);
    });

    test('F2.3 buildAssistantSummary：组内按与当前时间距离升序，距离相同按 id 升序', () => {
      const sameMoment = localDateTime(5);
      const db = createFakeDatabase({
        items: [
          summaryItem(2, { deadline: sameMoment }),
          summaryItem(1, { deadline: sameMoment }),
          summaryItem(3, { deadline: localDateTime(1) })
        ]
      });
      h.setDatabase(db);
      const summary = plain(h.fn('buildAssistantSummary')(h.now()));
      assert.deepEqual(summary.items.map(item => item.id), [3, 1, 2]);
    });

    test('F2.3 buildAssistantSummary：无法解析的 deadline 视为最远，排在组内最后', () => {
      const db = createFakeDatabase({
        items: [
          summaryItem(1, { deadline: 'not-a-date' }),
          summaryItem(2, { deadline: localDateTime(1) })
        ]
      });
      h.setDatabase(db);
      const summary = plain(h.fn('buildAssistantSummary')(h.now()));
      assert.deepEqual(summary.items.map(item => item.id), [2, 1]);
    });

    test('F2.3 buildAssistantSummary：超过 100 条时截取 100 条并给出 omittedCount', () => {
      const items = [];
      for (let id = 1; id <= 100; id += 1) {
        items.push(summaryItem(id, {
          kind: id % 2 === 1 ? 'assignment' : 'activity',
          deadline: `${localDate(id)} 23:59`,
          status: id % 2 === 1 ? 'not_started' : 'not_completed'
        }));
      }
      for (let id = 101; id <= 105; id += 1) {
        items.push(summaryItem(id, {
          kind: 'assignment',
          deadline: `${localDate(-(id - 100))} 09:00`,
          status: 'completed'
        }));
      }
      h.setDatabase(createFakeDatabase({ items }));
      const summary = plain(h.fn('buildAssistantSummary')(h.now()));
      assert.equal(summary.items.length, 100);
      assert.equal(summary.omittedCount, 5);
      assert.deepEqual(summary.items.map(item => item.id), Array.from({ length: 100 }, (_, index) => index + 1));
      assert.ok(summary.items.every(item => item.status !== 'completed'));
      for (const item of summary.items) {
        assert.deepEqual(Object.keys(item).sort(), ['deadline', 'id', 'kind', 'status', 'title']);
      }
    });

    test('F2.3 buildAssistantSummary：恰好 100 条 omittedCount=0，101 条 omittedCount=1', () => {
      const makeRows = count => Array.from({ length: count }, (_, index) => summaryItem(index + 1, { deadline: `${localDate(index + 1)} 23:59` }));
      h.setDatabase(createFakeDatabase({ items: makeRows(100) }));
      assert.equal(h.fn('buildAssistantSummary')(h.now()).omittedCount, 0);
      h.setDatabase(createFakeDatabase({ items: makeRows(101) }));
      assert.equal(h.fn('buildAssistantSummary')(h.now()).omittedCount, 1);
    });

    test('F2.3 buildAssistantSummary：空数据返回空列表与 0 遗漏', () => {
      const summary = plain(h.fn('buildAssistantSummary')(h.now()));
      assert.deepEqual(summary, { items: [], omittedCount: 0 });
    });
  });

  // ============ F3 模型请求 ============

  describe('F3 模型请求', () => {
    test('F3.2 createHttpFailure：HTTP 状态映射为固定 code/message/retryable', () => {
      const create = h.fn('createHttpFailure');
      const Failure = h.evalIn('AssistantFailure');
      const cases = [
        [400, 'http_400', '接口地址或模型名不正确，或请求被服务端拒绝（400）', false],
        [401, 'http_401', 'API Key 无效或没有访问权限（401/403）', false],
        [403, 'http_403', 'API Key 无效或没有访问权限（401/403）', false],
        [404, 'http_404', '接口地址或模型名不存在（404）', false],
        [429, 'http_429', '请求过于频繁，请稍后再试（429）', true],
        [500, 'http_5xx', '模型服务暂时不可用（5xx），请稍后重试', true],
        [503, 'http_5xx', '模型服务暂时不可用（5xx），请稍后重试', true],
        [418, 'http_other', '请求失败（状态码 418）', true]
      ];
      for (const [status, code, message, retryable] of cases) {
        const failure = create(status);
        assert.ok(failure instanceof Failure, `HTTP ${status} 应返回 AssistantFailure`);
        assert.equal(failure.code, code);
        assert.equal(failure.message, message);
        assert.equal(failure.retryable, retryable);
      }
    });

    test('F3.3 resolveAiTimeoutMs：环境变量为正数时使用，否则回落 60000', () => {
      const resolve = h.fn('resolveAiTimeoutMs');
      const previous = process.env.DEADLINE_DESK_AI_TIMEOUT_MS;
      try {
        delete process.env.DEADLINE_DESK_AI_TIMEOUT_MS;
        assert.equal(resolve(), 60000);
        process.env.DEADLINE_DESK_AI_TIMEOUT_MS = '800';
        assert.equal(resolve(), 800);
        process.env.DEADLINE_DESK_AI_TIMEOUT_MS = '0';
        assert.equal(resolve(), 60000);
        process.env.DEADLINE_DESK_AI_TIMEOUT_MS = '-5';
        assert.equal(resolve(), 60000);
        process.env.DEADLINE_DESK_AI_TIMEOUT_MS = 'abc';
        assert.equal(resolve(), 60000);
      } finally {
        if (previous === undefined) delete process.env.DEADLINE_DESK_AI_TIMEOUT_MS;
        else process.env.DEADLINE_DESK_AI_TIMEOUT_MS = previous;
      }
    });

    test('F3.4 classifyFetchFailure：超时守卫/AbortError 归为 timeout', () => {
      const classify = h.fn('classifyFetchFailure');
      const sentinel = h.evalIn('AI_TIMEOUT_SENTINEL');
      assert.equal(classify(sentinel), 'timeout');
      assert.equal(classify({ assistantTimeout: true }), 'timeout');
      assert.equal(classify(Object.assign(new Error('aborted'), { name: 'AbortError' })), 'timeout');
    });

    test('F3.4 classifyFetchFailure：连接类错误归为 network，不得落入 unknown', () => {
      const classify = h.fn('classifyFetchFailure');
      const networkCases = [
        new Error('net::ERR_CONNECTION_REFUSED'),
        new Error('net::ERR_NAME_NOT_RESOLVED'),
        new Error('net::ERR_TUNNEL_CONNECTION_FAILED'),
        new Error('net::ERR_CERT_AUTHORITY_INVALID'),
        Object.assign(new Error('socket failure'), { code: 'ECONNRESET' }),
        Object.assign(new Error('lookup failure'), { code: 'ENOTFOUND' }),
        Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
        Object.assign(new Error('socket'), { code: 'ERR_SOCKET_CLOSED' }),
        { message: 'wrapped', cause: { code: 'EAI_AGAIN' } },
        { message: 'wrapped', cause: { errno: 'ECONNREFUSED' } }
      ];
      for (const error of networkCases) {
        assert.equal(classify(error), 'network', `${error.message || error.cause?.code} 应归类为 network`);
      }
    });

    test('F3.4 classifyFetchFailure：其他异常归为 unknown', () => {
      const classify = h.fn('classifyFetchFailure');
      assert.equal(classify(new Error('boom')), 'unknown');
      assert.equal(classify({}), 'unknown');
      assert.equal(classify(undefined), 'unknown');
    });

    test('F3.5 callChatCompletion：返回响应快照且请求头/请求体严格符合契约', async () => {
      h.setFetch(() => Promise.resolve(httpResponse({ status: 200, body: '{"ok":true}' })));
      const messages = [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'user' }
      ];
      const chat = await h.fn('callChatCompletion')({
        endpoint: MOCK_ENDPOINT,
        apiKey: KEY,
        model: MODEL,
        messages,
        timeoutMs: 500
      });
      assert.deepEqual(plain(chat), { status: 200, ok: true, text: '{"ok":true}' });

      const request = h.fetchCalls[0];
      assert.equal(request.url, MOCK_ENDPOINT);
      assert.equal(request.init.method, 'POST');
      assert.deepEqual(Object.keys(request.init.headers).sort(), ['Accept', 'Authorization', 'Content-Type']);
      assert.equal(request.init.headers['Content-Type'], 'application/json');
      assert.equal(request.init.headers.Accept, 'application/json');
      assert.equal(request.init.headers.Authorization, `Bearer ${KEY}`);

      const body = JSON.parse(request.init.body);
      assert.deepEqual(Object.keys(body).sort(), ['messages', 'model', 'temperature']);
      assert.equal(body.model, MODEL);
      assert.equal(body.temperature, 0);
      assert.deepEqual(body.messages, messages);
      for (const forbidden of ['stream', 'response_format', 'tools', 'functions', 'max_tokens']) {
        assert.equal(body[forbidden], undefined, `请求体不得包含 ${forbidden}`);
      }
      assert.ok(request.init.signal);
      assert.equal(request.init.signal.aborted, false);
    });

    test('F3.5 callChatCompletion：非 2xx 不抛异常，返回状态快照', async () => {
      h.setFetch(() => Promise.resolve(httpResponse({ status: 401, body: '{"error":{"message":"secret-body"}}' })));
      const chat = await h.fn('callChatCompletion')({
        endpoint: MOCK_ENDPOINT,
        apiKey: KEY,
        model: MODEL,
        messages: [],
        timeoutMs: 500
      });
      assert.equal(chat.status, 401);
      assert.equal(chat.ok, false);
      assert.equal(chat.text, '{"error":{"message":"secret-body"}}');
    });

    test('F3.5 callChatCompletion：网络失败抛 network（retryable=true）', async () => {
      h.setFetch(() => Promise.reject(Object.assign(new Error('net::ERR_CONNECTION_REFUSED'), { code: 'ERR_CONNECTION_REFUSED' })));
      const error = await captureRejection(h.fn('callChatCompletion')({
        endpoint: MOCK_ENDPOINT,
        apiKey: KEY,
        model: MODEL,
        messages: [],
        timeoutMs: 500
      }));
      assert.equal(error.code, 'network');
      assert.equal(error.message, NETWORK_MESSAGE);
      assert.equal(error.retryable, true);
    });

    test('F3.5 callChatCompletion：未分类异常抛 unknown（retryable=true）', async () => {
      h.setFetch(() => Promise.reject(new Error('boom')));
      const error = await captureRejection(h.fn('callChatCompletion')({
        endpoint: MOCK_ENDPOINT,
        apiKey: KEY,
        model: MODEL,
        messages: [],
        timeoutMs: 500
      }));
      assert.equal(error.code, 'unknown');
      assert.equal(error.message, UNKNOWN_MESSAGE);
      assert.equal(error.retryable, true);
    });

    test('F3.5 callChatCompletion：请求被 abort 时归类 timeout', async () => {
      h.setFetch((_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }));
      const error = await captureRejection(h.fn('callChatCompletion')({
        endpoint: MOCK_ENDPOINT,
        apiKey: KEY,
        model: MODEL,
        messages: [],
        timeoutMs: 40
      }));
      assert.equal(error.code, 'timeout');
      assert.equal(error.message, TIMEOUT_MESSAGE);
      assert.equal(error.retryable, true);
    });

    test('F3.5 callChatCompletion：请求完全不响应时守卫触发 timeout，文案固定 60 秒', async () => {
      h.setFetch(() => new Promise(() => {}));
      const started = Date.now();
      const error = await captureRejection(h.fn('callChatCompletion')({
        endpoint: MOCK_ENDPOINT,
        apiKey: KEY,
        model: MODEL,
        messages: [],
        timeoutMs: 40
      }));
      assert.ok(Date.now() - started < 1000, '超时判定不应拖到真实 60 秒');
      assert.equal(error.code, 'timeout');
      assert.equal(error.message, TIMEOUT_MESSAGE);
      assert.equal(error.retryable, true);
    });
  });

  // ============ F4 响应解析与意图归一化 ============

  describe('F4 响应解析与意图归一化', () => {
    test('F4.1 readChatText：合法响应返回原始（未 trim）文本', () => {
      const read = h.fn('readChatText');
      const text = '  {"intent":"create"}  ';
      assert.equal(read({ status: 200, ok: true, text: chatBody(text) }), text);
    });

    test('F4.1 readChatText：非 2xx 直接抛对应 HTTP 错误，不解析响应体', () => {
      const read = h.fn('readChatText');
      const unauthorized = captureFailure(() => read({ status: 401, ok: false, text: '{"choices":[{"message":{"content":"x"}}]}' }));
      assert.equal(unauthorized.code, 'http_401');
      assert.equal(unauthorized.retryable, false);

      const rateLimited = captureFailure(() => read({ status: 429, ok: false, text: '' }));
      assert.equal(rateLimited.code, 'http_429');
      assert.equal(rateLimited.retryable, true);

      const serverError = captureFailure(() => read({ status: 500, ok: false, text: '' }));
      assert.equal(serverError.code, 'http_5xx');
      assert.equal(serverError.retryable, true);

      const other = captureFailure(() => read({ status: 418, ok: false, text: '' }));
      assert.equal(other.code, 'http_other');
      assert.equal(other.message, '请求失败（状态码 418）');
    });

    test('F4.1 readChatText：非 JSON 内容抛 invalid_response', () => {
      const read = h.fn('readChatText');
      const error = captureFailure(() => read({ status: 200, ok: true, text: '抱歉，我不能…' }));
      assert.equal(error.code, 'invalid_response');
      assert.equal(error.message, INVALID_RESPONSE_MESSAGE);
      assert.equal(error.retryable, true);
    });

    test('F4.1 readChatText：choices 缺失/非数组/空数组/首项非法/message 非法均抛 invalid_response', () => {
      const read = h.fn('readChatText');
      const bodies = [
        '{}',
        '{"choices":{}}',
        '{"choices":[]}',
        '{"choices":[null]}',
        '{"choices":[[]]}',
        '{"choices":[{"message":null}]}',
        '{"choices":[{"message":[]}]}'
      ];
      for (const body of bodies) {
        const error = captureFailure(() => read({ status: 200, ok: true, text: body }));
        assert.equal(error.code, 'invalid_response', `${body} 应解析失败`);
        assert.equal(error.retryable, true);
      }
    });

    test('F4.1 readChatText：finish_reason=length 视为被截断，抛 invalid_response', () => {
      const read = h.fn('readChatText');
      const error = captureFailure(() => read({ status: 200, ok: true, text: chatBody('{"intent":"create"}', 'length') }));
      assert.equal(error.code, 'invalid_response');
    });

    test('F4.1 readChatText：数组 content 只拼接 type=text 的字符串片段', () => {
      const read = h.fn('readChatText');
      const content = [
        { type: 'text', text: '{"intent":' },
        { type: 'image_url', image_url: { url: 'http://x' } },
        { type: 'text', text: ' "create"}' },
        { type: 'text', text: 123 }
      ];
      assert.equal(read({ status: 200, ok: true, text: chatBody(content) }), '{"intent": "create"}');
    });

    test('F4.1 readChatText：内容为空、纯空白或非字符串类型抛 empty_response', () => {
      const read = h.fn('readChatText');
      const contents = ['', '   ', null, 123, [], [{ type: 'image_url', image_url: { url: 'http://x' } }]];
      for (const content of contents) {
        const error = captureFailure(() => read({ status: 200, ok: true, text: chatBody(content) }));
        assert.equal(error.code, 'empty_response', `${JSON.stringify(content)} 应视为空响应`);
        assert.equal(error.message, EMPTY_RESPONSE_MESSAGE);
        assert.equal(error.retryable, true);
      }
    });

    test('F4.2 extractJsonObject：支持纯 JSON、Markdown 围栏与前后说明', () => {
      const extract = h.fn('extractJsonObject');
      assert.deepEqual(plain(extract('{"a":1}')), { a: 1 });
      assert.deepEqual(plain(extract('```json\n{"a":1}\n```')), { a: 1 });
      assert.deepEqual(plain(extract('前缀说明 {"a":{"b":[1,2]}} 后缀')), { a: { b: [1, 2] } });
      assert.deepEqual(plain(extract('{"a":1}{"b":2}')), { a: 1 });
    });

    test('F4.2 extractJsonObject：字符串内的括号与转义引号不影响截取', () => {
      const extract = h.fn('extractJsonObject');
      const payload = JSON.stringify({ a: 'quote " and } brace' });
      assert.deepEqual(plain(extract(`说明：${payload}`)), { a: 'quote " and } brace' });
      assert.deepEqual(plain(extract('{"a":"}"}')), { a: '}' });
    });

    test('F4.2 extractJsonObject：截断/非对象/无花括号返回 null', () => {
      const extract = h.fn('extractJsonObject');
      for (const text of ['{"a":', '{"a":1', 'no braces here', '[1,2]', '```\nnot json\n```', '"text"']) {
        assert.equal(extract(text), null, `${text} 应无法提取`);
      }
    });

    test('F4.3 readAssistantPayload：从 Chat Completions 外壳中提取 JSON 对象', () => {
      const read = h.fn('readAssistantPayload');
      const payload = read({ status: 200, ok: true, text: chatBody('```json\n{"intent":"create","message":"ok"}\n```') });
      assert.deepEqual(plain(payload), { intent: 'create', message: 'ok' });
    });

    test('F4.3 readAssistantPayload：文本中无合法对象时抛 invalid_response', () => {
      const read = h.fn('readAssistantPayload');
      const notJson = captureFailure(() => read({ status: 200, ok: true, text: chatBody('抱歉，我不能…') }));
      assert.equal(notJson.code, 'invalid_response');

      const array = captureFailure(() => read({ status: 200, ok: true, text: chatBody('[1,2]') }));
      assert.equal(array.code, 'invalid_response');
    });

    test('F4.4 normalizeAssistantIntent：单意图透传 message，缺省/非字符串回落空串', () => {
      const normalize = h.fn('normalizeAssistantIntent');
      for (const intent of ['create', 'update', 'delete', 'cleanup', 'query']) {
        assert.deepEqual(plain(normalize({ intent, message: '说明' })), { intent, message: '说明' });
      }
      assert.deepEqual(plain(normalize({ intent: 'create' })), { intent: 'create', message: '' });
      assert.deepEqual(plain(normalize({ intent: 'update', message: 123 })), { intent: 'update', message: '' });
    });

    test('F4.4 normalizeAssistantIntent：未知或缺失意图归一化为 clarify 固定文案', () => {
      const normalize = h.fn('normalizeAssistantIntent');
      for (const payload of [{}, { intent: 'whatever' }, { intent: null }]) {
        assert.deepEqual(plain(normalize(payload)), { intent: 'clarify', message: UNKNOWN_INTENT_MESSAGE });
      }
    });

    test('F4.4 normalizeAssistantIntent：unsupported 使用模型说明，缺失时给固定兜底', () => {
      const normalize = h.fn('normalizeAssistantIntent');
      assert.deepEqual(plain(normalize({ intent: 'unsupported', message: '不支持生成周报。' })), {
        intent: 'unsupported',
        message: '不支持生成周报。'
      });
      assert.deepEqual(plain(normalize({ intent: 'unsupported', message: '   ' })), {
        intent: 'unsupported',
        message: '暂不支持这类操作。'
      });
      assert.deepEqual(plain(normalize({ intent: 'unsupported' })), {
        intent: 'unsupported',
        message: '暂不支持这类操作。'
      });
    });

    test('F4.4 normalizeAssistantIntent：detectedIntents 两类时给出两类操作提示', () => {
      const normalize = h.fn('normalizeAssistantIntent');
      const result = plain(normalize({ intent: 'create', detectedIntents: ['create', 'delete'], message: 'mixed' }));
      assert.equal(result.intent, 'clarify');
      assert.equal(result.message, '识别到「新增」和「删除」两类操作；一次只能处理一类，请拆开分别提交。');
    });

    test('F4.4 normalizeAssistantIntent：detectedIntents 按固定顺序去重并过滤非法值', () => {
      const normalize = h.fn('normalizeAssistantIntent');
      const result = plain(normalize({ intent: 'query', detectedIntents: ['query', 'create', 'query', 'bogus'] }));
      assert.equal(result.intent, 'clarify');
      assert.equal(result.message, '识别到「新增」和「查询」两类操作；一次只能处理一类，请拆开分别提交。');
    });

    test('F4.4 normalizeAssistantIntent：intent=multiple 且无类别时给出通用多类提示', () => {
      const normalize = h.fn('normalizeAssistantIntent');
      assert.deepEqual(plain(normalize({ intent: 'multiple', message: 'mixed' })), {
        intent: 'clarify',
        message: '识别到多类操作；一次只能处理一类，请拆开分别提交。'
      });
    });

    test('F4.4 normalizeAssistantIntent：三类及以上用「」、「」和句式', () => {
      const normalize = h.fn('normalizeAssistantIntent');
      const result = plain(normalize({ intent: 'multiple', detectedIntents: ['create', 'delete', 'query'] }));
      assert.equal(result.message, '识别到「新增」、「删除」和「查询」多类操作；一次只能处理一类，请拆开分别提交。');
    });

    test('F4.4 normalizeAssistantIntent：unsupported 不参与多意图计数，单类别不触发 clarify', () => {
      const normalize = h.fn('normalizeAssistantIntent');
      assert.deepEqual(plain(normalize({ intent: 'create', detectedIntents: ['create', 'unsupported'], message: 'ok' })), {
        intent: 'create',
        message: 'ok'
      });
      assert.deepEqual(plain(normalize({ intent: 'create', detectedIntents: ['create', 'create'] })), {
        intent: 'create',
        message: ''
      });
    });
  });

  // ============ F5 系统提示词与消息 ============

  describe('F5 系统提示词与消息', () => {
    test('F5.1 buildAssistantSystemPrompt：包含 schema 关键字段、range.type 取值与 14 条协议约束（逐条内容校验）', () => {
      const prompt = h.fn('buildAssistantSystemPrompt')();
      for (const token of ['intent', 'detectedIntents', 'this_week', 'next_week', 'last_week', 'this_month', 'next_month', 'last_month', 'this_year', 'last_year', 'month', 'week', 'custom', 'all']) {
        assert.ok(prompt.includes(token), `system prompt 缺少 ${token}`);
      }
      assert.ok(prompt.includes('只输出一个 JSON 对象'));

      const constraints = [
        [1, ['只输出 JSON', '不输出 Markdown']],
        [2, ['YYYY-MM-DD HH:MM', '23:59', '无法确定输出 null']],
        [3, ['kind 只能是 assignment / activity', 'status 只能是该类型允许的状态']],
        [4, ['新增候选必须有明确标题', '空标题', '不生成候选']],
        [5, ['targetIds', '只能取自输入摘要的 id', '不得改事项大类', '批量删除未完成事项']],
        [6, ['cleanup 只针对已完成事项', 'range', '本地提示补充']],
        [7, ['intent = multiple', 'detectedIntents', '列出全部类别']],
        [8, ['周报/复盘/建议', 'unsupported', '在 message 说明']],
        [9, ['now.date / now.weekday / now.time', '周一为一周第一天', '最近的下一个同名日期']],
        [10, ['不复述事项说明、附件等未提供的信息']],
        [11, ['逐条处理', '已完成批量删除走 cleanup']],
        [12, ['完成时间', '按截止时间归属', '当前已完成状态统计']],
        [13, ['永久删除', '不改状态、不归档']],
        [14, ['默认回答范围内未完成事项', '明确问完成情况时按已完成统计']]
      ];
      const lines = prompt.split('\n');
      for (const [index, snippets] of constraints) {
        const line = lines.find(text => text.startsWith(`${index}. `));
        assert.ok(line, `system prompt 缺少第 ${index} 条协议约束`);
        for (const snippet of snippets) {
          assert.ok(line.includes(snippet), `第 ${index} 条协议约束缺少内容：${snippet}`);
        }
      }
    });

    test('F5.2 buildAssistantNow：输出本地日期、中文星期与两位补零时刻', () => {
      const build = h.fn('buildAssistantNow');
      assert.deepEqual(plain(build(h.date(2026, 11, 6, 9, 5))), {
        date: '2026-11-06',
        weekday: '星期五',
        time: '09:05'
      });
      assert.deepEqual(plain(build(h.date(2026, 1, 5, 7, 3))), {
        date: '2026-01-05',
        weekday: '星期一',
        time: '07:03'
      });
      assert.deepEqual(plain(build(h.date(2026, 11, 1, 0, 0))), {
        date: '2026-11-01',
        weekday: '星期日',
        time: '00:00'
      });
    });

    test('F5.3 buildAssistantUserMessage：顶层恰为 now/items/input，items 不追加字段', () => {
      const build = h.fn('buildAssistantUserMessage');
      const items = [
        { id: 1, title: 'A', kind: 'assignment', deadline: '2026-11-06 23:59', status: 'not_started' },
        { id: 2, title: 'B', kind: 'activity', deadline: '2026-11-07 18:00', status: 'completed' }
      ];
      const text = build(h.date(2026, 11, 6, 9, 5), items, '新建一个大作业');
      const parsed = JSON.parse(text);
      assert.deepEqual(Object.keys(parsed), ['now', 'items', 'input']);
      assert.deepEqual(Object.keys(parsed.now), ['date', 'weekday', 'time']);
      assert.deepEqual(parsed.items, items);
      assert.equal(parsed.input, '新建一个大作业');
      assert.ok(!JSON.stringify(parsed).includes('description'));
      assert.ok(!JSON.stringify(parsed).includes('work_type'));
    });

    test('F5.4 buildQuerySystemPrompt：限定只能使用给定统计并只输出纯文本', () => {
      const prompt = h.fn('buildQuerySystemPrompt')();
      assert.ok(prompt.includes('只能使用'));
      assert.ok(prompt.includes('不得编造'));
      assert.ok(prompt.includes('纯文本'));
    });

    test('F5.4 buildQueryUserMessage：顶层恰为六项且统计与 meta 同源', () => {
      const build = h.fn('buildQueryUserMessage');
      const meta = {
        rangeLabel: '2026年11月1日–11月30日',
        kindLabel: '大作业',
        statusLabel: '未完成',
        counts: { total: 1, assignment: { total: 1, pending: 1, completed: 0 }, activity: { total: 0, pending: 0, completed: 0 } },
        entries: [{ id: 1, title: 'A', kind: 'assignment', deadline: '2026-11-06 23:59', status: 'not_started' }]
      };
      const parsed = JSON.parse(build(meta, '本月有哪些大作业？'));
      assert.deepEqual(Object.keys(parsed), ['question', 'rangeLabel', 'kindLabel', 'statusLabel', 'counts', 'entries']);
      assert.deepEqual(parsed.counts, meta.counts);
      assert.deepEqual(parsed.entries, meta.entries);
      assert.equal(parsed.question, '本月有哪些大作业？');
    });
  });

  // ============ F6 查询路径 ============

  describe('F6 查询路径', () => {
    test('F6.1 resolveRange：周/月/年固定类型的起止与标签', () => {
      const resolve = h.fn('resolveRange');
      const base = h.date(2026, 11, 6, 12, 0);
      const cases = [
        ['this_week', '2026-11-02', '2026-11-08', '2026年11月2日（周一）–11月8日（周日）'],
        ['next_week', '2026-11-09', '2026-11-15', '2026年11月9日（周一）–11月15日（周日）'],
        ['last_week', '2026-10-26', '2026-11-01', '2026年10月26日（周一）–11月1日（周日）'],
        ['this_month', '2026-11-01', '2026-11-30', '2026年11月1日–11月30日'],
        ['next_month', '2026-12-01', '2026-12-31', '2026年12月1日–12月31日'],
        ['last_month', '2026-10-01', '2026-10-31', '2026年10月1日–10月31日'],
        ['this_year', '2026-01-01', '2026-12-31', '2026年1月1日–12月31日'],
        ['last_year', '2025-01-01', '2025-12-31', '2025年1月1日–12月31日']
      ];
      for (const [type, start, end, label] of cases) {
        assert.deepEqual(plain(resolve({ type }, base)), { start, end, label }, `${type} 范围不正确`);
      }
    });

    test('F6.1 resolveRange：周一/周日边界仍归属同一自然周', () => {
      const resolve = h.fn('resolveRange');
      assert.deepEqual(plain(resolve({ type: 'this_week' }, h.date(2026, 11, 8, 23, 59))), {
        start: '2026-11-02',
        end: '2026-11-08',
        label: '2026年11月2日（周一）–11月8日（周日）'
      });
      assert.deepEqual(plain(resolve({ type: 'this_week' }, h.date(2026, 11, 9, 0, 0))), {
        start: '2026-11-09',
        end: '2026-11-15',
        label: '2026年11月9日（周一）–11月15日（周日）'
      });
    });

    test('F6.1 resolveRange：跨年 last_month 与标签年份省略规则', () => {
      const resolve = h.fn('resolveRange');
      assert.deepEqual(plain(resolve({ type: 'last_month' }, h.date(2026, 1, 15, 12, 0))), {
        start: '2025-12-01',
        end: '2025-12-31',
        label: '2025年12月1日–12月31日'
      });
    });

    test('F6.1 resolveRange：month 类型校验 year/month 与闰年月末', () => {
      const resolve = h.fn('resolveRange');
      const base = h.date(2026, 11, 6);
      assert.deepEqual(plain(resolve({ type: 'month', year: 2026, month: 2 }, base)), {
        start: '2026-02-01',
        end: '2026-02-28',
        label: '2026年2月1日–2月28日'
      });
      assert.deepEqual(plain(resolve({ type: 'month', year: 2024, month: 2 }, base)), {
        start: '2024-02-01',
        end: '2024-02-29',
        label: '2024年2月1日–2月29日'
      });
      for (const range of [
        { type: 'month', year: 1999, month: 12 },
        { type: 'month', year: 2101, month: 1 },
        { type: 'month', year: 2026, month: 13 },
        { type: 'month', year: 2026, month: 0 },
        { type: 'month', year: 2026.5, month: 1 },
        { type: 'month', month: 2 }
      ]) {
        assert.equal(resolve(range, base), null, `${JSON.stringify(range)} 应返回 null`);
      }
    });

    test('F6.1 resolveRange：week 类型取所在周周一，跨年标签带年份', () => {
      const resolve = h.fn('resolveRange');
      assert.deepEqual(plain(resolve({ type: 'week', date: '2026-01-01' }, h.date(2026, 1, 1))), {
        start: '2025-12-29',
        end: '2026-01-04',
        label: '2025年12月29日（周一）–2026年1月4日（周日）'
      });
      assert.deepEqual(plain(resolve({ type: 'week', date: '2026-11-08' }, h.date(2026, 11, 8))), {
        start: '2026-11-02',
        end: '2026-11-08',
        label: '2026年11月2日（周一）–11月8日（周日）'
      });
      assert.equal(resolve({ type: 'week', date: '2026-02-30' }, h.date(2026, 11, 6)), null);
      assert.equal(resolve({ type: 'week', date: 'not-a-date' }, h.date(2026, 11, 6)), null);
    });

    test('F6.1 resolveRange：custom 支持 start/end 互换与跨年标签，非法输入返回 null', () => {
      const resolve = h.fn('resolveRange');
      const base = h.date(2026, 11, 6);
      assert.deepEqual(plain(resolve({ type: 'custom', start: '2026-11-30', end: '2026-11-01' }, base)), {
        start: '2026-11-01',
        end: '2026-11-30',
        label: '2026年11月1日–11月30日'
      });
      assert.deepEqual(plain(resolve({ type: 'custom', start: '2026-12-20', end: '2027-01-10' }, base)), {
        start: '2026-12-20',
        end: '2027-01-10',
        label: '2026年12月20日–2027年1月10日'
      });
      assert.equal(resolve({ type: 'custom', start: '2026-11-01' }, base), null);
      assert.equal(resolve({ type: 'custom', start: 'x', end: '2026-11-01' }, base), null);
    });

    test('F6.1 resolveRange：all/未知/缺失/非对象一律返回 null', () => {
      const resolve = h.fn('resolveRange');
      const base = h.date(2026, 11, 6);
      for (const range of [null, undefined, [], 'this_week', {}, { type: 123 }, { type: 'this_quarter' }, { type: 'all' }]) {
        assert.equal(resolve(range, base), null, `${JSON.stringify(range)} 应返回 null`);
      }
    });

    test('F6.2 normalizeQueryFilters：非法取值回落默认 kind=all/status=pending/shape=list', () => {
      const normalize = h.fn('normalizeQueryFilters');
      assert.deepEqual(plain(normalize(undefined)), { kind: 'all', status: 'pending', shape: 'list' });
      assert.deepEqual(plain(normalize(null)), { kind: 'all', status: 'pending', shape: 'list' });
      assert.deepEqual(plain(normalize('x')), { kind: 'all', status: 'pending', shape: 'list' });
      assert.deepEqual(plain(normalize({ kind: 'bogus', status: 'bogus', shape: 'bogus' })), { kind: 'all', status: 'pending', shape: 'list' });
      assert.deepEqual(plain(normalize({ kind: 'assignment', status: 'completed', shape: 'count' })), { kind: 'assignment', status: 'completed', shape: 'count' });
      assert.deepEqual(plain(normalize({ kind: 'activity', status: 'all', shape: 'list' })), { kind: 'activity', status: 'all', shape: 'list' });
    });

    test('F6.3 collectQueryData：闭区间 + kind 过滤统计，entries 再按 status 过滤', () => {
      const collect = h.fn('collectQueryData');
      const rows = [
        { id: 1, title: 'A', kind: 'assignment', deadline: '2026-11-01 09:00', status: 'not_started' },
        { id: 2, title: 'B', kind: 'activity', deadline: '2026-11-30 18:00', status: 'completed' },
        { id: 3, title: 'C', kind: 'assignment', deadline: '2026-10-31 23:59', status: 'completed' },
        { id: 4, title: 'D', kind: 'activity', deadline: '2026-12-01 00:00', status: 'not_completed' },
        { id: 5, title: 'E', kind: 'activity', deadline: '2026-11-15 12:00', status: 'not_completed' },
        { id: 6, title: 'F', kind: 'assignment', deadline: '2026-11-15 12:00', status: 'completed' }
      ];
      const range = { start: '2026-11-01', end: '2026-11-30' };

      const pending = plain(collect(rows, range, 'all', 'pending'));
      assert.deepEqual(pending.counts, {
        total: 4,
        assignment: { total: 2, pending: 1, completed: 1 },
        activity: { total: 2, pending: 1, completed: 1 }
      });
      assert.deepEqual(pending.entries.map(entry => entry.id), [1, 5]);
      assert.deepEqual(Object.keys(pending.entries[0]).sort(), ['deadline', 'id', 'kind', 'status', 'title']);

      const completed = plain(collect(rows, range, 'all', 'completed'));
      assert.deepEqual(completed.entries.map(entry => entry.id), [6, 2]);
      assert.deepEqual(completed.counts, pending.counts);

      const allStatus = plain(collect(rows, range, 'all', 'all'));
      assert.deepEqual(allStatus.entries.map(entry => entry.id), [1, 5, 6, 2]);

      const assignmentOnly = plain(collect(rows, range, 'assignment', 'all'));
      assert.deepEqual(assignmentOnly.counts, {
        total: 2,
        assignment: { total: 2, pending: 1, completed: 1 },
        activity: { total: 0, pending: 0, completed: 0 }
      });
      assert.deepEqual(assignmentOnly.entries.map(entry => entry.id), [1, 6]);
    });

    test('F6.4 buildQueryFallback：无结果、计数与列表三种模板', () => {
      const fallback = h.fn('buildQueryFallback');
      const rangeLabel = '2026年11月1日–11月30日';
      const counts = {
        total: 2,
        assignment: { total: 1, pending: 1, completed: 0 },
        activity: { total: 1, pending: 1, completed: 0 }
      };
      const entries = [
        { id: 1, title: 'A', kind: 'assignment', deadline: '2026-11-01 09:00', status: 'not_started' },
        { id: 2, title: 'B', kind: 'activity', deadline: '2026-11-20 18:00', status: 'not_completed' }
      ];
      const meta = { rangeLabel, kindLabel: '全部类型', statusLabel: '未完成', counts, entries };

      assert.equal(fallback(meta, 'count'), `按截止时间在 ${rangeLabel} 内：共 2 个事项，其中大作业 1 个（未完成 1、已完成 0），活动 1 个（未完成 1、已完成 0）。`);
      assert.equal(fallback(meta, 'list'), `按截止时间在 ${rangeLabel} 内，共 2 个未完成事项：\n2026-11-01 09:00 · 大作业 · A\n2026-11-20 18:00 · 活动 · B`);

      const emptyCounts = {
        total: 0,
        assignment: { total: 0, pending: 0, completed: 0 },
        activity: { total: 0, pending: 0, completed: 0 }
      };
      const emptyMeta = { rangeLabel, kindLabel: '全部类型', statusLabel: '未完成', counts: emptyCounts, entries: [] };
      assert.equal(fallback(emptyMeta, 'count'), `按截止时间在 ${rangeLabel} 内没有符合条件的事项。`);
      assert.equal(fallback(emptyMeta, 'list'), `按截止时间在 ${rangeLabel} 内没有符合条件的事项。`);

      const entriesEmptyMeta = { ...meta, entries: [] };
      assert.equal(fallback(entriesEmptyMeta, 'list'), `按截止时间在 ${rangeLabel} 内没有符合条件的事项。`);
    });

    test('F6.5 handleAssistantQuery：缺范围直接 clarify 且不发起第二次请求', async () => {
      h.setDatabase(configuredDatabase());
      let calls = 0;
      h.setFetch(() => {
        calls += 1;
        return Promise.resolve(chatEnvelope('{"intent":"query"}'));
      });
      const result = await h.fn('handleAssistantQuery')({
        payload: { intent: 'query', query: {} },
        config: { endpoint: MOCK_ENDPOINT, model: MODEL, apiKey: KEY },
        now: h.now(),
        input: '查一下',
        omittedCount: 3
      });
      assert.deepEqual(plain(result), { ok: true, intent: 'clarify', message: NO_RANGE_MESSAGE, omittedCount: 3 });
      assert.equal(calls, 0);
    });

    test('F6.5 handleAssistantQuery：成功后返回 answer/fallback/meta，统计结果与样本一致', async () => {
      h.setDatabase(seedQueryItems());
      const label = plain(h.fn('resolveRange')({ type: 'this_month' }, h.now())).label;
      h.setFetch(() => Promise.resolve(chatEnvelope('本月共有 2 个大作业，其中 1 个已完成。')));
      const result = plain(await h.fn('handleAssistantQuery')({
        payload: {
          intent: 'query',
          query: { range: { type: 'this_month' }, kind: 'all', status: 'all', shape: 'list' }
        },
        config: { endpoint: MOCK_ENDPOINT, model: MODEL, apiKey: KEY },
        now: h.now(),
        input: '本月有哪些大作业？',
        omittedCount: 0
      }));
      assert.equal(result.ok, true);
      assert.equal(result.intent, 'query');
      assert.equal(result.message, '');
      assert.equal(result.query.answer, '本月共有 2 个大作业，其中 1 个已完成。');
      assert.equal(result.query.fallback, false);
      assert.equal(result.query.meta.rangeLabel, label);
      assert.equal(result.query.meta.kindLabel, '全部类型');
      assert.equal(result.query.meta.statusLabel, '全部状态');
      assert.deepEqual(result.query.meta.counts, {
        total: 2,
        assignment: { total: 1, pending: 0, completed: 1 },
        activity: { total: 1, pending: 1, completed: 0 }
      });
      assert.deepEqual(result.query.meta.entries.map(entry => entry.id), [1, 2]);
      const question = JSON.parse(h.fetchCalls[h.fetchCalls.length - 1].init.body).messages[1].content;
      assert.equal(JSON.parse(question).question, '本月有哪些大作业？');
    });

    test('F6.5 handleAssistantQuery：超过摘要上限时仍以全量事项统计（不得误用 100 条摘要）', async () => {
      const db = seedOversizedSummaryDatabase();
      h.setDatabase(db);
      const summary = plain(h.fn('buildAssistantSummary')(h.now()));
      assert.equal(summary.items.length, 100);
      assert.equal(summary.omittedCount, 5);
      assert.ok(!summary.items.some(item => item.status === 'completed'), '上月的已完成事项应被摘要截断');

      const range = plain(h.fn('resolveRange')({ type: 'last_month' }, h.now()));
      const label = range.label;
      const summaryCounts = plain(h.fn('collectQueryData')(summary.items, range, 'all', 'completed')).counts;
      assert.equal(summaryCounts.total, 0, '摘要路径统计不到已完成事项，用于证明用例可区分全量与摘要');

      h.setFetch(() => Promise.resolve(chatEnvelope('上月共有 5 个已完成大作业。')));
      const result = plain(await h.fn('handleAssistantQuery')({
        payload: {
          intent: 'query',
          query: { range: { type: 'last_month' }, kind: 'all', status: 'completed', shape: 'count' }
        },
        config: { endpoint: MOCK_ENDPOINT, model: MODEL, apiKey: KEY },
        now: h.now(),
        input: '上个月完成了几个事项？',
        omittedCount: summary.omittedCount
      }));
      assert.equal(result.ok, true);
      assert.equal(result.intent, 'query');
      assert.equal(result.query.fallback, false);
      assert.equal(result.query.meta.rangeLabel, label);
      assert.deepEqual(result.query.meta.counts, {
        total: 5,
        assignment: { total: 5, pending: 0, completed: 5 },
        activity: { total: 0, pending: 0, completed: 0 }
      });
      assert.deepEqual(result.query.meta.entries.map(entry => entry.id), [101, 102, 103, 104, 105]);
      assert.equal(h.fetchCalls.length, 1, 'query 组织调用只应发起一次请求');
    });

    test('F6.5 handleAssistantQuery：第二次调用失败回落本地模板（fallback=true）', async () => {
      h.setDatabase(seedQueryItems());
      const label = plain(h.fn('resolveRange')({ type: 'this_month' }, h.now())).label;
      h.setFetch(() => Promise.reject(Object.assign(new Error('net::ERR_CONNECTION_REFUSED'), { code: 'ERR_CONNECTION_REFUSED' })));
      const result = plain(await h.fn('handleAssistantQuery')({
        payload: {
          intent: 'query',
          query: { range: { type: 'this_month' }, kind: 'all', status: 'completed', shape: 'count' }
        },
        config: { endpoint: MOCK_ENDPOINT, model: MODEL, apiKey: KEY },
        now: h.now(),
        input: '本月完成了几个事项？',
        omittedCount: 0
      }));
      assert.equal(result.query.fallback, true);
      assert.equal(
        result.query.answer,
        `按截止时间在 ${label} 内：共 2 个事项，其中大作业 1 个（未完成 0、已完成 1），活动 1 个（未完成 1、已完成 0）。`
      );
      assert.deepEqual(result.query.meta.counts, {
        total: 2,
        assignment: { total: 1, pending: 0, completed: 1 },
        activity: { total: 1, pending: 1, completed: 0 }
      });
    });
  });

  // ============ F7 assistant:parse 与注册 ============

  describe('F7 assistant:parse 处理器与注册', () => {
    test('F7.1 注册：assistant:parse 与 settings:set-ai 各注册一次', () => {
      assert.equal(h.registered.filter(channel => channel === 'assistant:parse').length, 1);
      assert.equal(h.registered.filter(channel => channel === 'settings:set-ai').length, 1);
    });

    test('F7.1 注册接线：app.whenReady 回调内先注册数据通道、再注册助手通道', async () => {
      const capture = createHarness({ captureWhenReady: true });
      const callback = capture.whenReadyCallback;
      assert.equal(typeof callback, 'function', 'app.whenReady 未挂载启动回调');

      const calls = capture.evalIn(`(function () {
        const calls = [];
        const stub = name => () => { calls.push(name); };
        initializeDatabase = async () => { calls.push('initializeDatabase'); };
        registerItemHandlers = stub('registerItemHandlers');
        registerAttachmentHandlers = stub('registerAttachmentHandlers');
        registerDiaryHandlers = stub('registerDiaryHandlers');
        registerHabitHandlers = stub('registerHabitHandlers');
        const originalData = registerDataHandlers;
        registerDataHandlers = () => { calls.push('registerDataHandlers'); originalData(); };
        const originalAssistant = registerAssistantHandlers;
        registerAssistantHandlers = () => { calls.push('registerAssistantHandlers'); originalAssistant(); };
        registerWidgetHandlers = stub('registerWidgetHandlers');
        createWindow = stub('createWindow');
        createTray = stub('createTray');
        createWidgetWindow = stub('createWidgetWindow');
        isWidgetEnabled = () => false;
        checkNotifications = () => {};
        setTimeout = () => 0;
        setInterval = () => 0;
        return calls;
      })()`);

      await callback();
      const log = JSON.parse(JSON.stringify(calls));
      assert.ok(log.includes('initializeDatabase'), 'whenReady 回调应先初始化数据库');
      const dataIndex = log.indexOf('registerDataHandlers');
      const assistantIndex = log.indexOf('registerAssistantHandlers');
      assert.ok(dataIndex >= 0, 'whenReady 回调未调用 registerDataHandlers');
      assert.ok(assistantIndex >= 0, 'whenReady 回调未调用 registerAssistantHandlers');
      assert.ok(assistantIndex > dataIndex, 'registerAssistantHandlers 应在 registerDataHandlers 之后调用');
      assert.equal(capture.registered.filter(channel => channel === 'assistant:parse').length, 1);
      assert.equal(capture.registered.filter(channel => channel === 'settings:set-ai').length, 1);
    });

    test('F7.1 assistant:parse：非主窗口调用返回 forbidden，且主窗口随后仍可正常调用', async () => {
      h.setDatabase(configuredDatabase());
      const other = h.createOtherWindow();
      const forbidden = await h.call('assistant:parse', { sender: other.webContents }, '新建事项');
      assert.deepEqual(plain(forbidden), {
        ok: false,
        code: 'forbidden',
        message: '当前窗口无权执行该操作',
        retryable: false
      });
      assert.equal(h.fetchCalls.length, 0);

      const success = await h.parse('新建事项');
      assert.equal(success.ok, true);
      assert.equal(success.intent, 'create');
    });

    test('F7.1 assistant:parse：来源校验先于配置与输入校验（无配置 + 非主窗口 + 非法输入仍为 forbidden）', async () => {
      h.setDatabase(createFakeDatabase());
      const other = h.createOtherWindow();
      for (const input of [null, 123, { intent: 'create' }]) {
        const result = await h.call('assistant:parse', { sender: other.webContents }, input);
        assert.deepEqual(plain(result), {
          ok: false,
          code: 'forbidden',
          message: '当前窗口无权执行该操作',
          retryable: false
        }, `${String(input)} 应被来源校验拦截，而不是 not_configured / invalid_input`);
      }

      h.setDatabase(createFakeDatabase({ settings: { ai_endpoint: 'ftp://x', ai_model: MODEL, ai_api_key: KEY } }));
      const result = await h.call('assistant:parse', { sender: other.webContents }, '新建事项');
      assert.deepEqual(plain(result), {
        ok: false,
        code: 'forbidden',
        message: '当前窗口无权执行该操作',
        retryable: false
      });
      assert.equal(h.fetchCalls.length, 0);
    });

    test('F7.1 assistant:parse：未配置时返回 not_configured 且零请求', async () => {
      const result = await h.parse('新建事项');
      assert.deepEqual(plain(result), {
        ok: false,
        code: 'not_configured',
        message: NOT_CONFIGURED_MESSAGE,
        retryable: false
      });
      assert.equal(h.fetchCalls.length, 0);
    });

    test('F7.1 assistant:parse：endpoint 非 http/https 时返回 invalid_endpoint 且零请求', async () => {
      h.setDatabase(createFakeDatabase({
        settings: { ai_endpoint: 'ftp://x', ai_model: MODEL, ai_api_key: KEY }
      }));
      const result = await h.parse('新建事项');
      assert.deepEqual(plain(result), {
        ok: false,
        code: 'invalid_endpoint',
        message: INVALID_ENDPOINT_MESSAGE,
        retryable: false
      });
      assert.equal(h.fetchCalls.length, 0);
    });

    test('F7.1 assistant:parse：输入非字符串或 trim 后为空返回 invalid_input', async () => {
      h.setDatabase(configuredDatabase());
      for (const input of [null, 123, {}, [], undefined, '', '   ']) {
        const result = await h.parse(input);
        assert.deepEqual(plain(result), {
          ok: false,
          code: 'invalid_input',
          message: INVALID_INPUT_MESSAGE,
          retryable: false
        }, `${JSON.stringify(input)} 应被拦截`);
      }
      assert.equal(h.fetchCalls.length, 0);
    });

    test('F7.1 assistant:parse：输入长度 3000 允许、3001 拒绝', async () => {
      h.setDatabase(configuredDatabase());
      h.setFetch(() => Promise.resolve(chatEnvelope('{"intent":"create","message":"ok"}')));
      const accepted = await h.parse('x'.repeat(3000));
      assert.equal(accepted.ok, true);
      assert.equal(h.fetchCalls.length, 1);

      const rejected = await h.parse('x'.repeat(3001));
      assert.deepEqual(plain(rejected), {
        ok: false,
        code: 'invalid_input',
        message: '内容超过 3000 字符，请精简后再提交',
        retryable: false
      });
      assert.equal(h.fetchCalls.length, 1);
    });

    test('F7.1 assistant:parse：成功结果恰为 ok/intent/message/omittedCount，不含计划字段', async () => {
      h.setDatabase(configuredDatabase());
      h.setFetch(() => Promise.resolve(chatEnvelope('{"intent":"create","message":"已识别到新增"}')));
      const result = await h.parse('新建事项');
      assert.deepEqual(plain(result), {
        ok: true,
        intent: 'create',
        message: '已识别到新增',
        omittedCount: 0
      });
      assert.deepEqual(Object.keys(result).sort(), ['intent', 'message', 'ok', 'omittedCount']);
      for (const field of ['create', 'update', 'delete', 'cleanup', 'query']) {
        assert.equal(result[field], undefined);
      }
    });

    test('F7.1 assistant:parse：送模型前对输入 trim', async () => {
      h.setDatabase(configuredDatabase());
      h.setFetch(() => Promise.resolve(chatEnvelope('{"intent":"clarify","message":"ok"}')));
      await h.parse('  新建事项  ');
      const userMessage = JSON.parse(h.lastRequestBody().messages[1].content);
      assert.equal(userMessage.input, '新建事项');
    });

    test('F7.1 assistant:parse：模型请求报文契约（消息结构/摘要 100 条/字段裁剪）', async () => {
      const items = [];
      for (let id = 1; id <= 100; id += 1) {
        items.push({
          id,
          title: `摘要样本 ${id}`,
          kind: id % 2 === 1 ? 'assignment' : 'activity',
          deadline: `${localDate(id)} 23:59`,
          status: id % 2 === 1 ? 'not_started' : 'not_completed',
          description: '不应发送的说明',
          work_type: 'personal',
          attachments: [{ id: 1 }]
        });
      }
      for (let id = 101; id <= 105; id += 1) {
        items.push({
          id,
          title: `完成样本 ${id}`,
          kind: 'assignment',
          deadline: `${localDate(-(id - 100))} 09:00`,
          status: 'completed',
          description: '不应发送的说明',
          work_type: 'personal'
        });
      }
      h.setDatabase(createFakeDatabase({
        settings: { ai_endpoint: MOCK_ENDPOINT, ai_model: MODEL, ai_api_key: KEY },
        items
      }));
      h.setFetch(() => Promise.resolve(chatEnvelope('{"intent":"create","message":"ok"}')));
      const result = await h.parse('新建事项');

      assert.equal(h.fetchCalls.length, 1);
      const request = h.fetchCalls[0];
      assert.equal(request.url, MOCK_ENDPOINT);
      assert.equal(request.init.method, 'POST');
      assert.equal(request.init.headers.Authorization, `Bearer ${KEY}`);

      const body = h.lastRequestBody();
      assert.deepEqual(Object.keys(body).sort(), ['messages', 'model', 'temperature']);
      assert.equal(body.temperature, 0);
      assert.equal(body.messages.length, 2);
      assert.equal(body.messages[0].role, 'system');
      assert.equal(body.messages[1].role, 'user');
      assert.ok(body.messages[0].content.includes('intent'));
      assert.ok(body.messages[0].content.includes('detectedIntents'));

      const user = JSON.parse(body.messages[1].content);
      assert.deepEqual(Object.keys(user), ['now', 'items', 'input']);
      assert.deepEqual(Object.keys(user.now), ['date', 'weekday', 'time']);
      assert.match(user.now.weekday, /^星期[一二三四五六日]$/);
      assert.equal(user.items.length, 100);
      assert.deepEqual(user.items.map(item => item.id), Array.from({ length: 100 }, (_, index) => index + 1));
      assert.ok(user.items.every(item => item.status !== 'completed'));
      assert.equal(user.items[0].deadline, `${localDate(1)} 23:59`);
      for (const item of user.items) {
        assert.deepEqual(Object.keys(item).sort(), ['deadline', 'id', 'kind', 'status', 'title']);
      }
      const rawUser = body.messages[1].content;
      for (const hidden of ['description', 'work_type', 'workType', 'attachments']) {
        assert.ok(!rawUser.includes(hidden), `user 消息不得包含 ${hidden}`);
      }
      assert.equal(result.omittedCount, 5);
    });

    test('F7.1 assistant:parse：围栏与数组 content 均可解析为 create', async () => {
      h.setDatabase(configuredDatabase());
      h.setFetch(() => Promise.resolve(chatEnvelope('```json\n{"intent":"create","message":"ok"}\n```')));
      const fenced = await h.parse('新建事项');
      assert.equal(fenced.ok, true);
      assert.equal(fenced.intent, 'create');

      h.setFetch(() => Promise.resolve(chatEnvelope([{ type: 'text', text: '{"intent":"create","message":"ok"}' }])));
      const arrayContent = await h.parse('新建事项');
      assert.equal(arrayContent.ok, true);
      assert.equal(arrayContent.intent, 'create');
    });

    test('F7.1 assistant:parse：多意图归一化为 clarify 且无计划字段', async () => {
      h.setDatabase(configuredDatabase());
      h.setFetch(() => Promise.resolve(chatEnvelope('{"intent":"multiple","detectedIntents":["create","delete"],"message":"mixed"}')));
      const result = await h.parse('既新建又删除');
      assert.equal(result.ok, true);
      assert.equal(result.intent, 'clarify');
      assert.ok(result.message.includes('新增'));
      assert.ok(result.message.includes('删除'));
      assert.ok(result.message.includes('拆开'));
      for (const field of ['create', 'update', 'delete', 'cleanup', 'query']) {
        assert.equal(result[field], undefined);
      }

      h.setFetch(() => Promise.resolve(chatEnvelope('{"intent":"multiple","message":"mixed"}')));
      const emptyCategories = await h.parse('多类操作');
      assert.equal(emptyCategories.intent, 'clarify');
      assert.ok(emptyCategories.message.includes('多类操作'));
      assert.ok(emptyCategories.message.includes('拆开'));
    });

    test('F7.1 assistant:parse：未知意图与 unsupported 的行为', async () => {
      h.setDatabase(configuredDatabase());
      h.setFetch(() => Promise.resolve(chatEnvelope('{"intent":"whatever"}')));
      const unknown = await h.parse('随便说说');
      assert.equal(unknown.intent, 'clarify');
      assert.equal(unknown.message, UNKNOWN_INTENT_MESSAGE);

      h.setFetch(() => Promise.resolve(chatEnvelope('{"intent":"unsupported","message":"不支持生成周报。"}')));
      const unsupported = await h.parse('写周报');
      assert.equal(unsupported.ok, true);
      assert.equal(unsupported.intent, 'unsupported');
      assert.equal(unsupported.message, '不支持生成周报。');
    });

    test('F7.1 assistant:parse：HTTP 错误映射且错误文案不含 Key/地址/上游响应体', async () => {
      h.setDatabase(configuredDatabase());
      const cases = [
        [401, 'http_401', false],
        [429, 'http_429', true],
        [500, 'http_5xx', true],
        [418, 'http_other', true]
      ];
      for (const [status, code, retryable] of cases) {
        h.fetchCalls.length = 0;
        h.setFetch(() => Promise.resolve(httpResponse({ status, body: '{"error":{"message":"secret-body"}}' })));
        const result = await h.parse('新建事项');
        assert.equal(result.ok, false);
        assert.equal(result.code, code);
        assert.equal(result.retryable, retryable);
        assert.ok(!result.message.includes(KEY));
        assert.ok(!result.message.includes(MOCK_ENDPOINT));
        assert.ok(!result.message.includes('secret-body'));
        assert.deepEqual(Object.keys(result).sort(), ['code', 'message', 'ok', 'retryable']);
        assert.equal(h.fetchCalls.length, 1, '失败请求不应自动重试');
      }
    });

    test('F7.1 assistant:parse：空/非 JSON/截断/无 choices 响应均按响应错误处理', async () => {
      h.setDatabase(configuredDatabase());
      const cases = [
        [chatEnvelope(''), 'empty_response'],
        [chatEnvelope('抱歉，我不能…'), 'invalid_response'],
        [chatEnvelope('{"intent":"create"}', { finishReason: 'length' }), 'invalid_response'],
        [httpResponse({ status: 200, body: '{"choices":[]}' }), 'invalid_response']
      ];
      for (const [response, code] of cases) {
        h.setFetch(() => Promise.resolve(response));
        const result = await h.parse('新建事项');
        assert.equal(result.ok, false);
        assert.equal(result.code, code);
        assert.equal(result.retryable, true);
      }
    });

    test('F7.1 assistant:parse：请求超时返回 timeout（retryable=true）', async () => {
      h.setDatabase(configuredDatabase());
      const previous = process.env.DEADLINE_DESK_AI_TIMEOUT_MS;
      try {
        process.env.DEADLINE_DESK_AI_TIMEOUT_MS = '40';
        h.setFetch((_url, init) => new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }));
        const started = Date.now();
        const result = await h.parse('新建事项');
        assert.ok(Date.now() - started < 1000);
        assert.equal(result.ok, false);
        assert.equal(result.code, 'timeout');
        assert.equal(result.message, TIMEOUT_MESSAGE);
        assert.equal(result.retryable, true);
      } finally {
        if (previous === undefined) delete process.env.DEADLINE_DESK_AI_TIMEOUT_MS;
        else process.env.DEADLINE_DESK_AI_TIMEOUT_MS = previous;
      }
    });

    test('F7.1 assistant:parse：连接失败返回 network（retryable=true）', async () => {
      h.setDatabase(configuredDatabase());
      h.setFetch(() => Promise.reject(Object.assign(new Error('net::ERR_CONNECTION_REFUSED'), { code: 'ERR_CONNECTION_REFUSED' })));
      const result = await h.parse('新建事项');
      assert.equal(result.ok, false);
      assert.equal(result.code, 'network');
      assert.equal(result.message, NETWORK_MESSAGE);
      assert.equal(result.retryable, true);
      assert.equal(h.fetchCalls.length, 1, '网络失败不应自动重试');
    });

    test('F7.1 assistant:parse：未预期异常收口为 unknown，处理器永不 reject', async () => {
      const db = configuredDatabase();
      db.state.failPrepare = true;
      h.setDatabase(db);
      await assert.doesNotReject(async () => {
        const result = await h.parse('新建事项');
        assert.deepEqual(plain(result), {
          ok: false,
          code: 'unknown',
          message: UNKNOWN_MESSAGE,
          retryable: true
        });
      });
    });

    test('F7.1 查询集成：成功路径恰好两次请求并返回 query 结果', async () => {
      h.setDatabase(seedQueryItems());
      const label = plain(h.fn('resolveRange')({ type: 'this_month' }, h.now())).label;
      h.setFetch((_url, init) => {
        const user = JSON.parse(JSON.parse(init.body).messages[1].content);
        if ('question' in user) {
          return Promise.resolve(chatEnvelope('按截止时间在本月内：已完成 1 个。'));
        }
        return Promise.resolve(chatEnvelope(JSON.stringify({
          intent: 'query',
          query: { range: { type: 'this_month' }, kind: 'all', status: 'completed', shape: 'count' }
        })));
      });
      const result = await h.parse('查询本月已完成的事项');
      assert.equal(result.ok, true);
      assert.equal(result.intent, 'query');
      assert.equal(result.message, '');
      assert.equal(result.omittedCount, 0);
      assert.equal(result.query.answer, '按截止时间在本月内：已完成 1 个。');
      assert.equal(result.query.fallback, false);
      assert.equal(result.query.meta.rangeLabel, label);
      assert.equal(result.query.meta.kindLabel, '全部类型');
      assert.equal(result.query.meta.statusLabel, '已完成');
      assert.deepEqual(plain(result.query.meta.counts), {
        total: 2,
        assignment: { total: 1, pending: 0, completed: 1 },
        activity: { total: 1, pending: 1, completed: 0 }
      });
      assert.deepEqual(plain(result.query.meta.entries.map(entry => entry.id)), [1]);
      assert.equal(h.fetchCalls.length, 2);
      const question = JSON.parse(h.fetchCalls[1].init.body).messages[1].content;
      assert.equal(JSON.parse(question).question, '查询本月已完成的事项');
    });

    test('F7.1 查询集成：第二次调用失败回落模板，仍为两次请求', async () => {
      h.setDatabase(seedQueryItems());
      const lastLabel = plain(h.fn('resolveRange')({ type: 'last_month' }, h.now())).label;
      h.setFetch((_url, init) => {
        const user = JSON.parse(JSON.parse(init.body).messages[1].content);
        if ('question' in user) {
          return Promise.resolve(httpResponse({ status: 500, body: '{"error":{"message":"secret-body"}}' }));
        }
        return Promise.resolve(chatEnvelope(JSON.stringify({
          intent: 'query',
          query: { range: { type: 'last_month' }, status: 'completed' }
        })));
      });
      const result = await h.parse('查询上月完成了什么');
      assert.equal(result.ok, true);
      assert.equal(result.intent, 'query');
      assert.equal(result.query.fallback, true);
      assert.ok(result.query.answer.includes('按截止时间'));
      assert.ok(result.query.answer.includes(lastLabel));
      assert.ok(!result.query.answer.includes('secret-body'));
      assert.deepEqual(plain(result.query.meta.counts), {
        total: 1,
        assignment: { total: 1, pending: 0, completed: 1 },
        activity: { total: 0, pending: 0, completed: 0 }
      });
      assert.equal(h.fetchCalls.length, 2);
    });

    test('F7.1 查询集成：缺时间范围只发一次请求并提示补充', async () => {
      h.setDatabase(seedQueryItems());
      h.setFetch(() => Promise.resolve(chatEnvelope(JSON.stringify({ intent: 'query', query: {} }))));
      const result = await h.parse('查一下事项');
      assert.equal(result.ok, true);
      assert.equal(result.intent, 'clarify');
      assert.equal(result.message, NO_RANGE_MESSAGE);
      assert.equal(h.fetchCalls.length, 1);
    });

    test('F7.1 只读性：assistant:parse 全流程不改动设置与事项数据', async () => {
      const db = seedQueryItems();
      h.setDatabase(db);
      const settingsBefore = JSON.stringify(settingsSnapshot(db));
      const itemsBefore = h.itemsSnapshot();
      h.setFetch((_url, init) => {
        const user = JSON.parse(JSON.parse(init.body).messages[1].content);
        if ('question' in user) return Promise.resolve(chatEnvelope('本月已完成 1 个。'));
        return Promise.resolve(chatEnvelope(JSON.stringify({
          intent: 'query',
          query: { range: { type: 'this_month' }, status: 'completed', shape: 'count' }
        })));
      });
      await h.parse('查本月完成情况');
      assert.equal(JSON.stringify(settingsSnapshot(db)), settingsBefore);
      assert.equal(h.itemsSnapshot(), itemsBefore);
    });
  });

  // ============ F8 preload 最小桥接 ============

  describe('F8 preload 最小桥接', () => {
    function loadPreload() {
      const invocations = [];
      const exposed = {};
      const fakeElectron = {
        contextBridge: {
          exposeInMainWorld: (name, api) => {
            exposed[name] = api;
          }
        },
        ipcRenderer: {
          invoke: (...args) => {
            invocations.push(args);
            return Promise.resolve({ args });
          },
          on() {},
          send() {}
        }
      };
      const context = vm.createContext({
        require: name => (name === 'electron' ? fakeElectron : require(name)),
        console
      });
      vm.runInContext(preloadSource, context, { filename: preloadPath });
      return { api: exposed.deadlineDesk, invocations };
    }

    test('F8 assistant.parse 透传 assistant:parse 通道并返回主进程结果', async () => {
      const { api, invocations } = loadPreload();
      assert.deepEqual(Object.keys(api.assistant), ['parse']);
      const result = await api.assistant.parse('新建事项');
      assert.deepEqual(invocations[0], ['assistant:parse', '新建事项']);
      assert.deepEqual(result, { args: ['assistant:parse', '新建事项'] });
    });

    test('F8 settings.saveAi 透传 settings:set-ai 通道且不改写 payload', async () => {
      const { api, invocations } = loadPreload();
      const payload = { endpoint: MOCK_ENDPOINT, model: MODEL, apiKey: KEY };
      await api.settings.saveAi(payload);
      assert.deepEqual(invocations[0], ['settings:set-ai', payload]);
      assert.equal(invocations[0][1], payload, 'payload 应原样透传，不做校验或改写');
    });

    test('F8 既有 settings 桥接不受影响，透传不做输入校验', async () => {
      const { api, invocations } = loadPreload();
      await api.settings.get();
      assert.deepEqual(invocations[0], ['settings:get']);
      await api.assistant.parse(null);
      assert.deepEqual(invocations[1], ['assistant:parse', null]);
      await api.settings.saveAi({ weird: true });
      assert.deepEqual(invocations[2], ['settings:set-ai', { weird: true }]);
    });
  });
});
