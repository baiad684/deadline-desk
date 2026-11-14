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

const archiver = require('archiver');
const extract = require('extract-zip');
const initSqlJs = require('sql.js');

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
const SET_AI_INVALID_PROTOCOL = '接口协议不正确';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_MAX_TOKENS = 4096;

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

function anthropicBody(textOrParts, { stopReason = 'end_turn', extra } = {}) {
  const content = Array.isArray(textOrParts) ? textOrParts : [{ type: 'text', text: textOrParts }];
  return JSON.stringify({
    id: 'mock',
    type: 'message',
    role: 'assistant',
    content,
    stop_reason: stopReason,
    ...extra
  });
}

function anthropicEnvelope(textOrParts, { status = 200, stopReason } = {}) {
  return httpResponse({ status, body: anthropicBody(textOrParts, { stopReason }) });
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

// detail_v2 写意图计划的输入行（与 readItemsForAssistant 返回列一致）
function assistantRow(id, overrides = {}) {
  return {
    id,
    title: `事项 ${id}`,
    kind: 'assignment',
    deadline: `${localDate(1)} 23:59`,
    status: 'not_started',
    ...overrides
  };
}

function planOptions(payload, allItems, overrides = {}) {
  return {
    payload,
    summaryItems: overrides.summaryItems === undefined ? allItems : overrides.summaryItems,
    allItems,
    now: overrides.now === undefined ? h.now() : overrides.now,
    omittedCount: overrides.omittedCount === undefined ? 0 : overrides.omittedCount
  };
}

// ---------- 备份 / 恢复 fixture ----------

const BACKUP_ENDPOINT = 'https://api.backup.example/v1/chat/completions';
const BACKUP_MODEL = 'backup-model';
const BACKUP_KEY = 'sk-backup-key-111111';
const BACKUP_KEY_MASK = 'sk-b••••1111';

let sqlJsPromise = null;

function loadSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({ locateFile: file => path.join(projectDir, 'node_modules', 'sql.js', 'dist', file) });
  }
  return sqlJsPromise;
}

async function readSettingsFile(file) {
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

function createZipArchive(destination, files) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destination);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.file(files.database, { name: 'deadline-desk.db' });
    archive.append(files.manifest, { name: 'manifest.json' });
    archive.finalize();
  });
}

async function createBackupFixture(destination, options) {
  const SQL = await loadSqlJs();
  const databaseFile = `${destination}.db`;
  const db = new SQL.Database();
  try {
    db.exec(`
      CREATE TABLE items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        deadline TEXT NOT NULL,
        status TEXT NOT NULL,
        work_type TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['ai_endpoint', options.endpoint]);
    db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['ai_model', options.model]);
    db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['ai_api_key', options.apiKey]);
    if (typeof options.protocol === 'string') db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['ai_protocol', options.protocol]);
    db.run(
      'INSERT INTO items (kind, title, description, deadline, status, work_type) VALUES (?, ?, ?, ?, ?, ?)',
      ['assignment', options.title, '', `${localDate(1)} 23:59`, 'not_started', 'personal']
    );
    fs.writeFileSync(databaseFile, Buffer.from(db.export()));
  } finally {
    db.close();
  }
  await createZipArchive(destination, {
    database: databaseFile,
    manifest: JSON.stringify({ app: 'Deadline Desk', version: 1, createdAt: '2026-11-07T00:00:00.000Z' })
  });
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
        protocol: 'openai',
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
      assert.deepEqual(plain(view), { configured: false, protocol: 'openai', endpoint: '', model: '', keyMask: '' });
    });

    test('F1.4 buildAiSettingsView：三项合法时 configured=true 且返回首尾掩码', () => {
      h.setDatabase(configuredDatabase());
      assert.deepEqual(plain(h.fn('buildAiSettingsView')()), {
        configured: true,
        protocol: 'openai',
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
      assert.equal(badEndpoint.protocol, 'openai');
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
        ai: { configured: false, protocol: 'openai', endpoint: '', model: '', keyMask: '' }
      });
      assert.equal(Object.keys(result.ai).length, 5);
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
        protocol: 'openai',
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
        protocol: 'openai',
        endpoint: MOCK_ENDPOINT,
        model: MODEL,
        keyMask: KEY_MASK
      });
      assert.equal(h.database.settings.get('ai_endpoint'), MOCK_ENDPOINT);
      assert.equal(h.database.settings.get('ai_model'), MODEL);
      assert.equal(h.database.settings.get('ai_api_key'), KEY);
      assert.equal(h.database.settings.get('ai_protocol'), 'openai');
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
        protocol: 'openai',
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
        ai_protocol: 'openai',
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
        protocol: 'openai',
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
      assert.equal(success.intent, 'clarify');
      assert.equal(success.message, '没有识别到可新增的事项。');
      assert.equal(success.omittedCount, 0);
      for (const field of ['create', 'update', 'delete', 'cleanup', 'query']) {
        assert.equal(success[field], undefined);
      }
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
      h.setFetch(() => Promise.resolve(chatEnvelope('{"intent":"unsupported","message":"不支持这类操作。"}')));
      const result = await h.parse('新建事项');
      assert.deepEqual(plain(result), {
        ok: true,
        intent: 'unsupported',
        message: '不支持这类操作。',
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
      const createContent = JSON.stringify({
        intent: 'create',
        message: 'ok',
        create: {
          candidates: [{ title: '围栏候选', kind: 'assignment', deadline: `${localDate(3)} 23:59`, status: 'not_started' }]
        }
      });
      h.setFetch(() => Promise.resolve(chatEnvelope(`\`\`\`json\n${createContent}\n\`\`\``)));
      const fenced = await h.parse('新建事项');
      assert.equal(fenced.ok, true);
      assert.equal(fenced.intent, 'create');
      assert.equal(fenced.create.candidates.length, 1);
      assert.equal(fenced.create.candidates[0].rowId, 'c0');

      h.setFetch(() => Promise.resolve(chatEnvelope([{ type: 'text', text: createContent }])));
      const arrayContent = await h.parse('新建事项');
      assert.equal(arrayContent.ok, true);
      assert.equal(arrayContent.intent, 'create');
      assert.equal(arrayContent.create.candidates.length, 1);
      assert.equal(arrayContent.create.candidates[0].rowId, 'c0');
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

  // ============ F10–F16 写意图归一化（detail_v2） ============

  describe('F10 公共工具', () => {
    test('F10.4 normalizeAssistantTitle：NFKC、大小写与空白标点符号', () => {
      const normalize = h.fn('normalizeAssistantTitle');
      assert.equal(normalize(' 数据库 课程设计 '), '数据库');
      assert.equal(normalize('ＤＢ课设'), 'db');
      assert.equal(normalize('Data Base 课程设计'), 'database');
    });

    test('F10.4 normalizeAssistantTitle：只去掉一个前导词', () => {
      const normalize = h.fn('normalizeAssistantTitle');
      assert.equal(normalize('关于数据库'), '数据库');
      assert.equal(normalize('报名比赛'), '');
      assert.equal(normalize('参加活动'), '');
      assert.equal(normalize('关于关于数据库'), '关于数据库');
    });

    test('F10.4 normalizeAssistantTitle：结尾词最长优先且只去一次', () => {
      const normalize = h.fn('normalizeAssistantTitle');
      assert.equal(normalize('关于课程设计报告'), '课程设计');
      assert.equal(normalize('大作业'), '');
      assert.equal(normalize('课程设计'), '');
      assert.equal(normalize('数据库系统实验报告'), '数据库系统');
    });

    test('F10.4 normalizeAssistantTitle：归一化结果可为空串', () => {
      const normalize = h.fn('normalizeAssistantTitle');
      assert.equal(normalize('活动'), '');
      assert.equal(normalize('报告'), '');
      assert.equal(normalize('...'), '');
      assert.equal(normalize('！！！'), '');
    });

    test('F10.5 buildTitleBigrams：连续二字组与长度边界', () => {
      const bigrams = h.fn('buildTitleBigrams');
      assert.deepEqual(plain(bigrams('abcd')), ['ab', 'bc', 'cd']);
      assert.deepEqual(plain(bigrams('aaa')), ['aa', 'aa']);
      assert.deepEqual(plain(bigrams('a')), []);
      assert.deepEqual(plain(bigrams('')), []);
      assert.deepEqual(plain(bigrams(123)), []);
    });

    test('F10.6 diceCoefficient：多重集交集与空集', () => {
      const dice = h.fn('diceCoefficient');
      assert.equal(dice(['ab', 'bc', 'cd'], ['ab', 'bc', 'cd']), 1);
      assert.equal(dice(['ab'], ['cd']), 0);
      assert.equal(dice(['aa', 'aa', 'ab'], ['aa']), 0.5);
      assert.equal(dice([], []), 0);
      assert.equal(dice(['ab', 'bc', 'cd', 'de'], ['ab', 'bc', 'cd', 'xx']), 0.75);
      assert.equal(dice(
        ['ab', 'bc', 'cd', 'de', 'ef', 'fg', 'gh', 'hi', 'ij'],
        ['ab', 'bc', 'cd', 'de', 'ef', 'fg', 'gh', 'hx', 'xy', 'yz', 'zz']
      ), 0.7);
    });

    test('F10.7 hasTitleSignal：相等与包含', () => {
      const has = h.fn('hasTitleSignal');
      assert.equal(has('数据库', '数据库'), true);
      assert.equal(has('数据库', '数据库系统'), true);
      assert.equal(has('数据库系统', '数据库'), true);
    });

    test('F10.7 hasTitleSignal：短串 <3、空串与 Dice 阈值', () => {
      const has = h.fn('hasTitleSignal');
      assert.equal(has('数据', '数据结构'), false);
      assert.equal(has('', '课程'), false);
      assert.equal(has('报告', '物理'), false);
      assert.equal(has('abcde', 'abcdx'), true);
      assert.equal(has('abcdefghij', 'abcdefghxyzz'), false);
    });

    test('F10.8 isDeadlineClose：窗口含边界与非法时间', () => {
      const close = h.fn('isDeadlineClose');
      const windowMs = 60 * 60 * 1000;
      assert.equal(close('2026-11-20 10:00', '2026-11-20 11:00', windowMs), true);
      assert.equal(close('2026-11-20 10:00', '2026-11-20 11:01', windowMs), false);
      assert.equal(close('2026-11-20 10:00', 'bad', windowMs), false);
      assert.equal(close(null, '2026-11-20 10:00', windowMs), false);
    });

    test('F10.1–F10.3 状态集合：按类型取默认与合法性', () => {
      const statuses = h.fn('statusesForKind');
      const fallback = h.fn('defaultStatusForKind');
      const allowed = h.fn('isStatusAllowed');
      assert.deepEqual(plain(statuses('assignment')), ['not_started', 'in_progress', 'completed']);
      assert.deepEqual(plain(statuses('activity')), ['not_completed', 'completed']);
      assert.deepEqual(plain(statuses('other')), []);
      assert.deepEqual(plain(statuses(undefined)), []);
      assert.equal(fallback('assignment'), 'not_started');
      assert.equal(fallback('activity'), 'not_completed');
      assert.equal(fallback('other'), null);
      assert.equal(allowed('assignment', 'in_progress'), true);
      assert.equal(allowed('activity', 'in_progress'), false);
      assert.equal(allowed('assignment', ''), false);
    });

    test('F10.9 composePlanMessage：trim、丢弃空项与分号拼接', () => {
      const compose = h.fn('composePlanMessage');
      assert.equal(compose('已识别', ['未找到事项 id：9']), '已识别；未找到事项 id：9');
      assert.equal(compose('  ', ['  ', null, 42, '', '注']), '注');
      assert.equal(compose(123, []), '');
      assert.equal(compose(undefined, ['甲', '乙']), '甲；乙');
    });

    test('F10.10 parseTargetIds：类型、正整数、去重与保序', () => {
      const ids = h.fn('parseTargetIds');
      assert.deepEqual(plain(ids([3, '2', 1])), [3, 2, 1]);
      assert.deepEqual(plain(ids([1, 1, '1', '01'])), [1]);
      assert.deepEqual(plain(ids([0, -1, 1.5, '', null, true, {}, [], 'abc', NaN, Infinity])), []);
      assert.deepEqual(plain(ids('3')), []);
      assert.deepEqual(plain(ids(null)), []);
      assert.deepEqual(plain(ids([2, '02', 3])), [2, 3]);
    });

    test('F10.11 内部辅助：id 分类、note 文案、同名扩展与歧义判定', () => {
      const classify = h.fn('classifyTargetIds');
      const notes = h.fn('buildPlanNotes');
      const collect = h.fn('collectPlanTargetIds');
      const ambiguous = h.fn('isAmbiguousTitle');
      const rows = [
        assistantRow(1, { title: '数据库课程设计' }),
        assistantRow(2, { title: '校辩论赛报名', kind: 'activity' }),
        assistantRow(3, { title: '独立事项' }),
        assistantRow(9, { title: '数据库课程设计' })
      ];
      const summary = rows.slice(0, 3);
      assert.deepEqual(plain(classify([1, 2, 5, 9], rows, summary)), {
        missingIds: [5],
        outOfRangeIds: [9],
        resolvedIds: [1, 2]
      });
      assert.deepEqual(plain(notes([5], [9])), ['未找到事项 id：5', '超出本次可操作范围的事项 id：9']);
      assert.deepEqual(plain(notes([], [])), []);
      assert.deepEqual(plain(collect([1], rows)), [1, 9]);
      assert.deepEqual(plain(collect([2], rows)), [2]);
      assert.equal(ambiguous('数据库课程设计', rows), true);
      assert.equal(ambiguous('独立事项', rows), false);
    });
  });

  describe('F11 疑似重复检测', () => {
    test('F11.1 标题信号优先于仅时间信号', () => {
      const detect = h.fn('detectDuplicateCandidate');
      const candidate = { title: '数据库', deadline: '2026-11-20 10:00' };
      const items = [
        { id: 1, title: '数据库课程设计', kind: 'assignment', deadline: '2026-11-20 12:00', status: 'not_started' },
        { id: 2, title: '无关事项', kind: 'activity', deadline: '2026-11-20 10:00', status: 'completed' }
      ];
      assert.equal(detect(candidate, items).id, 1);
    });

    test('F11.1 多个标题命中取时间差绝对值最小', () => {
      const detect = h.fn('detectDuplicateCandidate');
      const candidate = { title: '数据库', deadline: '2026-11-20 10:00' };
      const items = [
        { id: 1, title: '数据库', kind: 'assignment', deadline: '2026-11-20 11:00', status: 'not_started' },
        { id: 2, title: '数据库', kind: 'assignment', deadline: '2026-11-20 10:30', status: 'completed' }
      ];
      assert.equal(detect(candidate, items).id, 2);
    });

    test('F11.1 时间差并列取 id 升序', () => {
      const detect = h.fn('detectDuplicateCandidate');
      const candidate = { title: '', deadline: '2026-11-20 10:00' };
      const items = [
        { id: 3, title: '完全无关的甲', kind: 'assignment', deadline: '2026-11-20 10:00', status: 'not_started' },
        { id: 1, title: '完全无关的乙', kind: 'activity', deadline: '2026-11-20 10:00', status: 'not_completed' }
      ];
      assert.equal(detect(candidate, items).id, 1);
    });

    test('F11.1 候选无截止时间只走标题信号', () => {
      const detect = h.fn('detectDuplicateCandidate');
      const unrelated = [{ id: 1, title: '无关', kind: 'assignment', deadline: '2026-11-20 10:00', status: 'not_started' }];
      assert.equal(detect({ title: '数据库', deadline: null }, unrelated), null);
      const same = [{ id: 2, title: '数据库课设', kind: 'activity', deadline: '2026-11-20 10:00', status: 'completed' }];
      assert.equal(detect({ title: '数据库', deadline: null }, same).id, 2);
    });

    test('F11.1 跨类型、已完成、逾期事项均参与检测', () => {
      const detect = h.fn('detectDuplicateCandidate');
      const items = [
        { id: 7, title: '数据库课程设计', kind: 'activity', deadline: '2020-01-01 00:00', status: 'completed' }
      ];
      const result = detect({ title: '数据库', deadline: null }, items);
      assert.equal(result.id, 7);
      assert.equal(result.title, '数据库课程设计');
    });

    test('F11.1 无命中返回 null，命中仅返回 id/title/deadline', () => {
      const detect = h.fn('detectDuplicateCandidate');
      assert.equal(detect({ title: '不存在的标题', deadline: null }, [
        { id: 1, title: '别的', kind: 'assignment', deadline: '2026-11-20 10:00', status: 'not_started' }
      ]), null);
      const hit = detect({ title: '数据库', deadline: '2026-11-20 10:00' }, [
        { id: 1, title: '数据库课程设计', kind: 'assignment', deadline: '2026-11-20 10:00', status: 'not_started' }
      ]);
      assert.deepEqual(plain(hit), { id: 1, title: '数据库课程设计', deadline: '2026-11-20 10:00' });
      assert.deepEqual(Object.keys(hit).sort(), ['deadline', 'id', 'title']);
    });
  });

  describe('F12 新增计划 normalizeCreatePlan', () => {
    const createPlan = (payload, allItems = []) => h.fn('normalizeCreatePlan')(planOptions(payload, allItems));

    test('F12 截止时间：date-only 补 23:59，完整时间原样保留', () => {
      const dateOnly = createPlan({ create: { candidates: [{ title: '新作业', kind: 'assignment', deadline: localDate(5), status: 'not_started' }] } });
      assert.equal(dateOnly.intent, 'create');
      assert.equal(dateOnly.create.candidates[0].deadline, `${localDate(5)} 23:59`);
      const full = createPlan({ create: { candidates: [{ title: '新作业', kind: 'assignment', deadline: `${localDate(6)} 10:30`, status: 'not_started' }] } });
      assert.equal(full.create.candidates[0].deadline, `${localDate(6)} 10:30`);
    });

    test('F12 说明：trim、10000 截断与非字符串回落空串', () => {
      const trimmed = createPlan({ create: { candidates: [{ title: '说明', kind: 'assignment', deadline: `${localDate(5)} 23:59`, description: '  x  ' }] } });
      assert.equal(trimmed.create.candidates[0].description, 'x');
      const long = createPlan({ create: { candidates: [{ title: '长说明', kind: 'assignment', deadline: `${localDate(5)} 23:59`, description: 'y'.repeat(10001) }] } });
      assert.equal(long.create.candidates[0].description.length, 10000);
      const nonString = createPlan({ create: { candidates: [{ title: '空说明', kind: 'assignment', deadline: `${localDate(5)} 23:59`, description: null }] } });
      assert.equal(nonString.create.candidates[0].description, '');
    });

    test('F12 workType：大作业仅 team 保留，活动恒为 null', () => {
      const candidates = [
        { title: '团队作业', kind: 'assignment', deadline: `${localDate(5)} 23:59`, workType: 'team' },
        { title: '个人作业', kind: 'assignment', deadline: `${localDate(5)} 23:59`, workType: 'other' },
        { title: '活动一项', kind: 'activity', deadline: `${localDate(5)} 23:59`, workType: 'team' }
      ];
      const result = createPlan({ create: { candidates } });
      assert.equal(result.create.candidates[0].workType, 'team');
      assert.equal(result.create.candidates[1].workType, 'personal');
      assert.equal(result.create.candidates[2].workType, null);
    });

    test('F12 deadlineIssue：缺失 / 非法 / 合法', () => {
      const missing = createPlan({ create: { candidates: [{ title: '缺时间', kind: 'assignment' }] } });
      assert.deepEqual(plain(missing.create.candidates[0].deadlineIssue), 'missing');
      assert.equal(missing.create.candidates[0].deadline, null);
      assert.equal(missing.create.candidates[0].executable, false);
      const blank = createPlan({ create: { candidates: [{ title: '空白时间', kind: 'assignment', deadline: '   ' }] } });
      assert.equal(blank.create.candidates[0].deadlineIssue, 'missing');
      for (const deadline of ['2026-02-31', 123, {}]) {
        const invalid = createPlan({ create: { candidates: [{ title: '非法时间', kind: 'assignment', deadline }] } });
        assert.equal(invalid.create.candidates[0].deadlineIssue, 'invalid', `${JSON.stringify(deadline)} 应判为非法`);
        assert.equal(invalid.create.candidates[0].deadline, null);
      }
      const valid = createPlan({ create: { candidates: [{ title: '合法时间', kind: 'assignment', deadline: `${localDate(5)} 23:59` }] } });
      assert.equal(valid.create.candidates[0].deadlineIssue, null);
      assert.equal(valid.create.candidates[0].executable, true);
    });

    test('F12 status：缺失取默认、合法保留、非法标记且置 null', () => {
      const missing = createPlan({ create: { candidates: [
        { title: '大作业缺状态', kind: 'assignment', deadline: `${localDate(5)} 23:59` },
        { title: '活动缺状态', kind: 'activity', deadline: `${localDate(5)} 23:59` }
      ] } });
      assert.equal(missing.create.candidates[0].status, 'not_started');
      assert.equal(missing.create.candidates[1].status, 'not_completed');
      const kept = createPlan({ create: { candidates: [{ title: '已完成作业', kind: 'assignment', deadline: `${localDate(5)} 23:59`, status: 'completed' }] } });
      assert.equal(kept.create.candidates[0].status, 'completed');
      assert.equal(kept.create.candidates[0].statusInvalid, false);
      const invalid = createPlan({ create: { candidates: [{ title: '错状态作业', kind: 'assignment', deadline: `${localDate(5)} 23:59`, status: 'not_completed' }] } });
      assert.equal(invalid.create.candidates[0].statusInvalid, true);
      assert.equal(invalid.create.candidates[0].status, null);
      assert.equal(invalid.create.candidates[0].executable, false);
    });

    test('F12 标题长度：120 可执行、121 保留但不可执行', () => {
      const allowed = createPlan({ create: { candidates: [{ title: '标'.repeat(120), kind: 'assignment', deadline: `${localDate(5)} 23:59`, status: 'not_started' }] } });
      assert.equal(allowed.create.candidates[0].titleTooLong, false);
      assert.equal(allowed.create.candidates[0].executable, true);
      const tooLong = createPlan({ create: { candidates: [{ title: '标'.repeat(121), kind: 'assignment', deadline: `${localDate(5)} 23:59`, status: 'not_started' }] } });
      assert.equal(tooLong.create.candidates[0].titleTooLong, true);
      assert.equal(tooLong.create.candidates[0].executable, false);
      assert.equal(tooLong.create.candidates[0].selected, false);
    });

    test('F12 标题为空或非字符串时记入 ignored', () => {
      const result = createPlan({ create: { candidates: [
        { title: '   ', kind: 'assignment' },
        { title: 42, kind: 'activity' }
      ] } });
      assert.equal(result.intent, 'create');
      assert.equal(result.create.candidates.length, 0);
      assert.deepEqual(plain(result.create.ignored), [
        { text: '', reason: '缺少明确标题' },
        { text: '', reason: '缺少明确标题' }
      ]);
    });

    test('F12 kind 非法与非对象候选：候选格式无效', () => {
      const result = createPlan({ create: { candidates: [
        { title: ' 随手记 ', kind: 'diary' },
        null,
        [],
        'x'
      ] } });
      assert.equal(result.create.candidates.length, 0);
      assert.deepEqual(plain(result.create.ignored), [
        { text: '随手记', reason: '事项类型无效' },
        { text: '', reason: '候选格式无效' },
        { text: '', reason: '候选格式无效' },
        { text: '', reason: '候选格式无效' }
      ]);
    });

    test('F12 ignored 合并：模型项在前并过滤非法项，本地项在后', () => {
      const result = createPlan({
        create: {
          candidates: [{ title: '', kind: 'assignment' }],
          ignored: [
            { text: ' 随手一提 ', reason: ' 没有明确标题 ' },
            { text: '无效', reason: '   ' },
            'x',
            { text: '无原因' }
          ]
        }
      });
      assert.deepEqual(plain(result.create.ignored), [
        { text: '随手一提', reason: '没有明确标题' },
        { text: '', reason: '缺少明确标题' }
      ]);
    });

    test('F12 expired：过去为 true 且不影响默认勾选', () => {
      const past = createPlan({ create: { candidates: [{ title: '旧作业', kind: 'assignment', deadline: `${localDate(-3)} 02:00`, status: 'not_started' }] } });
      assert.equal(past.create.candidates[0].expired, true);
      assert.equal(past.create.candidates[0].selected, true);
      const future = createPlan({ create: { candidates: [{ title: '新作业', kind: 'assignment', deadline: `${localDate(5)} 23:59`, status: 'not_started' }] } });
      assert.equal(future.create.candidates[0].expired, false);
      const missing = createPlan({ create: { candidates: [{ title: '缺时间', kind: 'assignment' }] } });
      assert.equal(missing.create.candidates[0].expired, false);
    });

    test('F12 疑似重复：命中则默认不勾选，未命中可勾选', () => {
      const allItems = [assistantRow(1, { title: '数据库课程设计', deadline: `${localDate(5)} 23:59` })];
      const hit = createPlan({ create: { candidates: [{ title: '数据库课设', kind: 'assignment', deadline: `${localDate(5)} 23:59`, status: 'not_started' }] } }, allItems);
      assert.deepEqual(plain(hit.create.candidates[0].duplicate), {
        id: 1,
        title: '数据库课程设计',
        deadline: `${localDate(5)} 23:59`
      });
      assert.equal(hit.create.candidates[0].selected, false);
      const miss = createPlan({ create: { candidates: [{ title: '全新事项', kind: 'assignment', deadline: `${localDate(9)} 23:59`, status: 'not_started' }] } }, allItems);
      assert.equal(miss.create.candidates[0].duplicate, null);
      assert.equal(miss.create.candidates[0].selected, true);
    });

    test('F12 rowId：按模型原始下标，丢弃候选项留空号', () => {
      const result = createPlan({ create: { candidates: [
        { title: '有效甲', kind: 'assignment', deadline: `${localDate(5)} 23:59`, status: 'not_started' },
        null,
        { title: '有效乙', kind: 'assignment', deadline: `${localDate(5)} 23:59`, status: 'not_started' },
        { title: '有效丙', kind: 'activity', deadline: `${localDate(5)} 23:59`, status: 'not_completed' }
      ] } });
      assert.deepEqual(plain(result.create.candidates.map(candidate => candidate.rowId)), ['c0', 'c2', 'c3']);
    });

    test('F12 空计划：无候选无 ignored 为 clarify，有 ignored 无候选仍为 create', () => {
      const empty = createPlan({ create: { candidates: [], ignored: [] } });
      assert.deepEqual(plain(empty), {
        ok: true,
        intent: 'clarify',
        message: '没有识别到可新增的事项。',
        omittedCount: 0
      });
      const onlyIgnored = createPlan({ create: { candidates: [], ignored: [{ text: '随口', reason: '无标题' }] } });
      assert.equal(onlyIgnored.intent, 'create');
      assert.equal(onlyIgnored.create.candidates.length, 0);
      assert.equal(onlyIgnored.create.ignored.length, 1);
    });
  });

  describe('F13 修改计划 normalizeUpdatePlan', () => {
    const updatePlan = (payload, allItems, overrides) => h.fn('normalizeUpdatePlan')(planOptions(payload, allItems, overrides));
    const baseItems = () => [
      assistantRow(1, { title: '数据库课程设计', deadline: `${localDate(3)} 23:59` }),
      assistantRow(2, { title: '校辩论赛报名', kind: 'activity', deadline: `${localDate(2)} 23:59`, status: 'not_completed' })
    ];

    test('F13.1 targetIds 缺失 / 非数组 / 空 → clarify 固定文案且无计划字段', () => {
      const allItems = baseItems();
      for (const payload of [
        {},
        { update: null },
        { update: [] },
        { update: {} },
        { update: { targetIds: [] } },
        { update: { targetIds: '1' } }
      ]) {
        const result = updatePlan(payload, allItems);
        assert.deepEqual(plain(result), {
          ok: true,
          intent: 'clarify',
          message: '没有找到匹配的事项。',
          omittedCount: 0
        });
        assert.equal(result.update, undefined);
      }
    });

    test('F13.1 不存在 id 的 note 追加在说明后', () => {
      const result = updatePlan({ message: '改一下', update: { targetIds: [1, 9], changes: { title: '新标题' } } }, baseItems());
      assert.equal(result.intent, 'update');
      assert.equal(result.update.targets.length, 1);
      assert.equal(result.message, '改一下；未找到事项 id：9');
    });

    test('F13.1 超出摘要 id 的 note 与目标解析', () => {
      const allItems = baseItems().concat([assistantRow(101, { title: '摘要外事项' })]);
      const result = updatePlan(
        { message: '改一下', update: { targetIds: [1, 101], changes: { title: '新标题' } } },
        allItems,
        { summaryItems: baseItems() }
      );
      assert.equal(result.update.targets.length, 1);
      assert.equal(result.message, '改一下；超出本次可操作范围的事项 id：101');
    });

    test('F13.1 targetIds 非空但全无效 → clarify 且带真实 note', () => {
      const allItems = baseItems().concat([assistantRow(101, { title: '摘要外事项' })]);
      const result = updatePlan({ update: { targetIds: [101], changes: { title: '新标题' } } }, allItems, { summaryItems: baseItems() });
      assert.equal(result.intent, 'clarify');
      assert.equal(result.message, '没有找到匹配的事项。；超出本次可操作范围的事项 id：101');
      assert.equal(result.update, undefined);
    });

    test('F13.1 唯一目标与多目标的 applyToId / ambiguous', () => {
      const allItems = baseItems();
      const unique = updatePlan({ update: { targetIds: [1], changes: { title: '新标题' } } }, allItems);
      assert.equal(unique.update.applyToId, 1);
      assert.equal(unique.update.ambiguous, false);
      const multi = updatePlan({ update: { targetIds: [1, 2], changes: { title: '新标题' } } }, allItems);
      assert.equal(multi.update.applyToId, null);
      assert.equal(multi.update.ambiguous, true);
      assert.deepEqual(plain(multi.update.targets.map(target => target.id)), [1, 2]);
    });

    test('F13.1 同名扩展：进入 targets、显式在前扩展按 id 升序', () => {
      const allItems = [
        assistantRow(1, { title: '同名事项' }),
        assistantRow(2, { title: '另一个事项' }),
        assistantRow(9, { title: '同名事项', kind: 'activity' })
      ];
      const result = updatePlan(
        { update: { targetIds: [1], changes: { title: '新标题' } } },
        allItems,
        { summaryItems: allItems.slice(0, 2) }
      );
      assert.deepEqual(plain(result.update.targets.map(target => target.id)), [1, 9]);
      assert.equal(result.update.targets[0].isAmbiguous, true);
      assert.equal(result.update.targets[1].isAmbiguous, true);
      assert.equal(result.update.ambiguous, true);
      assert.equal(result.update.applyToId, null);
    });

    test('F13.2 changes.deadline：合法补 23:59，非法标记 deadlineInvalid', () => {
      const allItems = baseItems();
      const valid = updatePlan({ update: { targetIds: [1], changes: { deadline: localDate(6) } } }, allItems);
      assert.equal(valid.update.changes.deadline, `${localDate(6)} 23:59`);
      assert.equal(valid.update.deadlineInvalid, false);
      const invalid = updatePlan({ update: { targetIds: [1], changes: { deadline: '2026-02-31 10:00' } } }, allItems);
      assert.equal(invalid.intent, 'update');
      assert.equal(invalid.update.deadlineInvalid, true);
      assert.equal(invalid.update.changes.deadline, null);
      const nonString = updatePlan({ update: { targetIds: [1], changes: { deadline: 123 } } }, allItems);
      assert.equal(nonString.update.deadlineInvalid, true);
      assert.equal(nonString.update.changes.deadline, null);
    });

    test('F13.2 changes.title / description / workType 与未知键', () => {
      const allItems = baseItems();
      const result = updatePlan({
        update: {
          targetIds: [1],
          changes: { title: '  新标题 ', description: '', workType: 'invalid', id: 1, created_at: 'x' }
        }
      }, allItems);
      assert.deepEqual(plain(result.update.changes), { title: '新标题', description: '' });
      assert.equal(result.update.titleTooLong, false);
      const emptyTitle = updatePlan({ update: { targetIds: [1], changes: { title: '   ' } } }, allItems);
      assert.equal(emptyTitle.intent, 'clarify');
      assert.equal(emptyTitle.message, '请说明要修改的内容。');
      const tooLong = updatePlan({ update: { targetIds: [1], changes: { title: 'x'.repeat(121) } } }, allItems);
      assert.equal(tooLong.update.titleTooLong, true);
      assert.equal(tooLong.update.changes.title.length, 121);
    });

    test('F13.2 changes.status：对全部显式目标合法才保留', () => {
      const multi = updatePlan({ update: { targetIds: [1, 2], changes: { status: 'in_progress' } } }, baseItems());
      assert.equal(multi.intent, 'update');
      assert.equal(multi.update.statusInvalid, true);
      assert.equal(Object.prototype.hasOwnProperty.call(multi.update.changes, 'status'), true);
      assert.equal(multi.update.changes.status, null);
      const single = updatePlan({ update: { targetIds: [1], changes: { status: 'in_progress' } } }, baseItems());
      assert.equal(single.update.changes.status, 'in_progress');
      assert.equal(single.update.statusInvalid, false);
    });

    test('F13.3 仅非法 status 仍返回 update 计划', () => {
      const result = updatePlan({ message: '改状态', update: { targetIds: [1], changes: { status: 'not_completed' } } }, baseItems());
      assert.equal(result.intent, 'update');
      assert.equal(result.update.statusInvalid, true);
      assert.equal(result.update.changes.status, null);
      assert.equal(result.update.targets.length, 1);
      assert.equal(result.update.applyToId, 1);
      assert.equal(result.message, '改状态');
      assert.ok(!result.message.includes('请说明要修改的内容'));
    });

    test('F13.2 changes.status：非字符串视为提供了但不合法', () => {
      for (const value of [5, false, { a: 1 }, ['x']]) {
        const result = updatePlan({ message: '改状态', update: { targetIds: [1], changes: { status: value } } }, baseItems());
        assert.equal(result.intent, 'update');
        assert.equal(result.update.statusInvalid, true);
        assert.equal(Object.prototype.hasOwnProperty.call(result.update.changes, 'status'), true);
        assert.equal(result.update.changes.status, null);
        assert.equal(result.update.targets.length, 1);
        assert.ok(!result.message.includes('请说明要修改的内容'));
      }
    });

    test('F13.2 kind：等于全部显式目标则忽略，不等则 clarify', () => {
      const allItems = baseItems();
      const same = updatePlan({ update: { targetIds: [1], changes: { kind: 'assignment', title: '新标题' } } }, allItems);
      assert.equal(same.intent, 'update');
      assert.equal(Object.prototype.hasOwnProperty.call(same.update.changes, 'kind'), false);
      const conflict = updatePlan({ update: { targetIds: [1], changes: { kind: 'activity' } } }, allItems);
      assert.equal(conflict.intent, 'clarify');
      assert.equal(conflict.message, '助手不能修改事项类型，请到对应列表的编辑表单操作。');
      assert.equal(conflict.update, undefined);
    });

    test('F13.2 同名扩展类型不同不影响 kind / status 合法性判定', () => {
      const allItems = [
        assistantRow(1, { title: '同名事项', kind: 'assignment' }),
        assistantRow(2, { title: '另一个事项' }),
        assistantRow(9, { title: '同名事项', kind: 'activity' })
      ];
      const result = updatePlan(
        { update: { targetIds: [1], changes: { kind: 'assignment', status: 'in_progress' } } },
        allItems,
        { summaryItems: allItems.slice(0, 2) }
      );
      assert.equal(result.intent, 'update');
      assert.equal(result.update.statusInvalid, false);
      assert.equal(result.update.changes.status, 'in_progress');
      assert.equal(result.update.changes.kind, undefined);
    });

    test('F13.2 空变更：无键且无非法标记 → clarify，否则 update', () => {
      const allItems = baseItems();
      const empty = updatePlan({ update: { targetIds: [1], changes: {} } }, allItems);
      assert.equal(empty.intent, 'clarify');
      assert.equal(empty.message, '请说明要修改的内容。');
      assert.equal(empty.update, undefined);
      const nullable = updatePlan({ update: { targetIds: [1], changes: { deadline: null, status: '' } } }, allItems);
      assert.equal(nullable.intent, 'clarify');
    });

    test('F13.2 活动目标上的合法 workType 原样保留', () => {
      const result = updatePlan({ update: { targetIds: [2], changes: { workType: 'team' } } }, baseItems());
      assert.equal(result.intent, 'update');
      assert.equal(result.update.changes.workType, 'team');
      assert.equal(result.update.statusInvalid, false);
      assert.equal(result.update.deadlineInvalid, false);
    });
  });

  describe('F14 删除计划 normalizeDeletePlan', () => {
    const deletePlan = (payload, allItems, overrides) => h.fn('normalizeDeletePlan')(planOptions(payload, allItems, overrides));
    const baseItems = () => [
      assistantRow(1, { title: '独立事项甲' }),
      assistantRow(2, { title: '独立事项乙' }),
      assistantRow(3, { title: '校辩论赛报名', kind: 'activity' })
    ];

    test('F14 唯一点名：默认勾选', () => {
      const result = deletePlan({ delete: { targetIds: [3] } }, baseItems());
      assert.equal(result.intent, 'delete');
      assert.equal(result.delete.targets.length, 1);
      assert.equal(result.delete.targets[0].isAmbiguous, false);
      assert.equal(result.delete.targets[0].selected, true);
    });

    test('F14 同名（跨类型且含摘要外）：全部歧义且不勾选', () => {
      const allItems = [
        assistantRow(1, { title: '同名活动' }),
        assistantRow(2, { title: '同名活动', kind: 'activity' }),
        assistantRow(3, { title: '同名活动', kind: 'activity', deadline: `${localDate(5)} 18:00` })
      ];
      const result = deletePlan({ delete: { targetIds: [1] } }, allItems, { summaryItems: allItems.slice(0, 2) });
      assert.deepEqual(plain(result.delete.targets.map(target => target.id)), [1, 2, 3]);
      assert.ok(result.delete.targets.every(target => target.isAmbiguous === true && target.selected === false));
    });

    test('F14 混合同名与唯一目标：selected 按条计算', () => {
      const allItems = [
        assistantRow(1, { title: '同名活动' }),
        assistantRow(2, { title: '同名活动' }),
        assistantRow(3, { title: '独立事项' })
      ];
      const result = deletePlan({ delete: { targetIds: [1, 3] } }, allItems);
      assert.deepEqual(plain(result.delete.targets.map(target => target.id)), [1, 3, 2]);
      assert.equal(result.delete.targets[0].selected, false);
      assert.equal(result.delete.targets[1].selected, true);
      assert.equal(result.delete.targets[2].selected, false);
    });

    test('F14 note 文案与 update 规则一致', () => {
      const allItems = [assistantRow(1, { title: '独立事项甲' }), assistantRow(101, { title: '摘要外事项' })];
      const result = deletePlan({ message: '删除', delete: { targetIds: [1, 101] } }, allItems, { summaryItems: allItems.slice(0, 1) });
      assert.equal(result.message, '删除；超出本次可操作范围的事项 id：101');
      const missing = deletePlan({ message: '删除', delete: { targetIds: [1, 9] } }, allItems, { summaryItems: allItems.slice(0, 1) });
      assert.equal(missing.message, '删除；未找到事项 id：9');
    });

    test('F14 全无效 / 缺失：clarify 且不带计划字段', () => {
      const allItems = [assistantRow(1, { title: '独立事项甲' }), assistantRow(101, { title: '摘要外事项' })];
      const invalid = deletePlan({ delete: { targetIds: [101] } }, allItems, { summaryItems: allItems.slice(0, 1) });
      assert.equal(invalid.intent, 'clarify');
      assert.equal(invalid.message, '没有找到匹配的事项。；超出本次可操作范围的事项 id：101');
      assert.equal(invalid.delete, undefined);
      const missing = deletePlan({ delete: { targetIds: [1] } }, [], {});
      assert.equal(missing.intent, 'clarify');
      assert.equal(missing.message, '没有找到匹配的事项。；未找到事项 id：1');
      for (const payload of [{}, { delete: null }, { delete: {} }, { delete: { targetIds: [] } }]) {
        const result = deletePlan(payload, baseItems());
        assert.deepEqual(plain(result), {
          ok: true,
          intent: 'clarify',
          message: '没有找到匹配的事项。',
          omittedCount: 0
        });
      }
    });

    test('F14 目标顺序：显式按输入顺序，扩展按 id 升序', () => {
      const allItems = [
        assistantRow(1, { title: '甲' }),
        assistantRow(2, { title: '同名的乙' }),
        assistantRow(3, { title: '同名的乙' }),
        assistantRow(4, { title: '同名的乙' })
      ];
      const ordered = deletePlan({ delete: { targetIds: [4, 1] } }, allItems);
      assert.deepEqual(plain(ordered.delete.targets.map(target => target.id)), [4, 1, 2, 3]);
    });

    test('F14 不根据时间范围推导待删目标', () => {
      const result = deletePlan({ delete: { range: { type: 'last_month' } } }, baseItems());
      assert.equal(result.intent, 'clarify');
      assert.equal(result.message, '没有找到匹配的事项。');
      assert.equal(result.delete, undefined);
    });
  });

  describe('F15 清理计划与 resolveRange 扩展', () => {
    const cleanupPlan = (payload, allItems, overrides) => h.fn('normalizeCleanupPlan')(planOptions(payload, allItems, overrides));
    const cleanupItems = () => [
      assistantRow(1, { title: '上月已完成作业', deadline: monthDate(-1, 10, '09:00'), status: 'completed' }),
      assistantRow(2, { title: '上月未完成作业', deadline: monthDate(-1, 20, '09:00'), status: 'not_started' }),
      assistantRow(3, { title: '本月已完成活动', kind: 'activity', deadline: monthDate(0, 5, '10:00'), status: 'completed' }),
      assistantRow(4, { title: '上月已完成活动', kind: 'activity', deadline: monthDate(-1, 25, '09:00'), status: 'completed' })
    ];

    test('F15.1 resolveRange：all 仅在 allowAll 时返回全区间', () => {
      const resolve = h.fn('resolveRange');
      assert.deepEqual(plain(resolve({ type: 'all' }, h.now(), { allowAll: true })), {
        start: '0000-01-01',
        end: '9999-12-31',
        label: '全部时间'
      });
      assert.equal(resolve({ type: 'all' }, h.now()), null);
      assert.equal(resolve({ type: 'all' }, h.now(), {}), null);
    });

    test('F15.2 过滤规则：仅已完成且在范围内，跨类型包含', () => {
      const result = cleanupPlan({ cleanup: { range: { type: 'last_month' } } }, cleanupItems());
      assert.equal(result.intent, 'cleanup');
      assert.deepEqual(plain(result.cleanup.targets.map(target => target.id)), [1, 4]);
      assert.ok(result.cleanup.targets.every(target => target.status === 'completed' && target.selected === true));
    });

    test('F15.2 闭区间首尾：start 00:00 与 end 23:59 均命中', () => {
      const lastDay = new Date(h.now().getFullYear(), h.now().getMonth(), 0).getDate();
      const items = [
        assistantRow(1, { title: '首日', deadline: monthDate(-1, 1, '00:00'), status: 'completed' }),
        assistantRow(2, { title: '末日', deadline: monthDate(-1, lastDay, '23:59'), status: 'completed' })
      ];
      const result = cleanupPlan({ cleanup: { range: { type: 'last_month' } } }, items);
      assert.deepEqual(plain(result.cleanup.targets.map(target => target.id)), [1, 2]);
    });

    test('F15.2 排序：deadline 升序，同值 id 升序', () => {
      const items = [
        assistantRow(9, { title: '同刻乙', deadline: monthDate(-1, 10, '09:00'), status: 'completed' }),
        assistantRow(5, { title: '同刻甲', deadline: monthDate(-1, 10, '09:00'), status: 'completed' }),
        assistantRow(1, { title: '更早', deadline: monthDate(-1, 2, '09:00'), status: 'completed' })
      ];
      const result = cleanupPlan({ cleanup: { range: { type: 'last_month' } } }, items);
      assert.deepEqual(plain(result.cleanup.targets.map(target => target.id)), [1, 5, 9]);
      assert.ok(result.cleanup.targets.every(target => target.selected === true));
    });

    test('F15.2 空结果仍返回 cleanup 并给出固定文案与范围标签', () => {
      const result = cleanupPlan({ message: '清理一下', cleanup: { range: { type: 'next_month' } } }, cleanupItems());
      assert.equal(result.intent, 'cleanup');
      assert.deepEqual(plain(result.cleanup.targets), []);
      assert.equal(result.message, '没有符合条件的已完成事项。');
      assert.equal(result.cleanup.rangeLabel, h.fn('resolveRange')({ type: 'next_month' }, h.now()).label);
      assert.deepEqual(
        plain(result.cleanup.range),
        plain((({ start, end }) => ({ start, end }))(h.fn('resolveRange')({ type: 'next_month' }, h.now())))
      );
    });

    test('F15.2 无范围 / 非法范围：clarify 且无 cleanup', () => {
      for (const payload of [{}, { cleanup: null }, { cleanup: {} }, { cleanup: { range: { type: 'unknown' } } }]) {
        const result = cleanupPlan(payload, cleanupItems());
        assert.deepEqual(plain(result), {
          ok: true,
          intent: 'clarify',
          message: '请补充清理范围（例如上个月、本月、今年、某个具体月份或全部已完成）。',
          omittedCount: 0
        });
        assert.equal(result.cleanup, undefined);
      }
    });

    test('F15.2 all 清理：包含跨月跨年的全部已完成事项', () => {
      const result = cleanupPlan({ message: '清理全部', cleanup: { range: { type: 'all' } } }, cleanupItems());
      assert.deepEqual(plain(result.cleanup.targets.map(target => target.id)), [1, 4, 3]);
      assert.equal(result.cleanup.rangeLabel, '全部时间');
      assert.deepEqual(plain(result.cleanup.range), { start: '0000-01-01', end: '9999-12-31' });
      assert.equal(result.message, '清理全部');
    });

    test('F15.2 range 与 rangeLabel 同源（last_month）', () => {
      const result = cleanupPlan({ cleanup: { range: { type: 'last_month' } } }, cleanupItems());
      const expected = h.fn('resolveRange')({ type: 'last_month' }, h.now());
      assert.equal(result.cleanup.range.start, expected.start);
      assert.equal(result.cleanup.range.end, expected.end);
      assert.equal(result.cleanup.rangeLabel, expected.label);
    });
  });

  // ============ F28 清理计划返回范围边界（v3） ============

  describe('F28 清理计划返回范围边界（cleanup.range）', () => {
    const cleanupPlan = (payload, allItems, overrides) => h.fn('normalizeCleanupPlan')(planOptions(payload, allItems, overrides));
    const fixedNow = () => h.date(2026, 11, 7, 12, 0);
    const resolve = (range, now = fixedNow()) => h.fn('resolveRange')(range, now, { allowAll: true });

    test('F28.1 cleanup.range：各范围类型与 resolveRange 同源，且只含 start/end', () => {
      const now = fixedNow();
      const cases = [
        [{ type: 'this_week' }, { start: '2026-11-02', end: '2026-11-08' }],
        [{ type: 'next_week' }, { start: '2026-11-09', end: '2026-11-15' }],
        [{ type: 'last_week' }, { start: '2026-10-26', end: '2026-11-01' }],
        [{ type: 'this_month' }, { start: '2026-11-01', end: '2026-11-30' }],
        [{ type: 'next_month' }, { start: '2026-12-01', end: '2026-12-31' }],
        [{ type: 'last_month' }, { start: '2026-10-01', end: '2026-10-31' }],
        [{ type: 'this_year' }, { start: '2026-01-01', end: '2026-12-31' }],
        [{ type: 'last_year' }, { start: '2025-01-01', end: '2025-12-31' }],
        [{ type: 'month', year: 2024, month: 2 }, { start: '2024-02-01', end: '2024-02-29' }],
        [{ type: 'week', date: '2026-11-04' }, { start: '2026-11-02', end: '2026-11-08' }],
        [{ type: 'custom', start: '2026-01-05', end: '2026-03-09' }, { start: '2026-01-05', end: '2026-03-09' }],
        [{ type: 'all' }, { start: '0000-01-01', end: '9999-12-31' }]
      ];
      for (const [range, expected] of cases) {
        const result = cleanupPlan({ cleanup: { range } }, [], { now });
        assert.equal(result.intent, 'cleanup', `${JSON.stringify(range)} 应返回 cleanup`);
        assert.deepEqual(plain(result.cleanup.range), expected, `${JSON.stringify(range)} 的 range 不正确`);
        assert.equal(result.cleanup.rangeLabel, resolve(range, now).label, `${JSON.stringify(range)} 的 rangeLabel 与 resolveRange 不一致`);
        assert.deepEqual(Object.keys(result.cleanup.range), ['start', 'end'], `${JSON.stringify(range)} 的 range 只能含 start/end`);
        assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(result.cleanup.range.start));
        assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(result.cleanup.range.end));
      }
    });

    test('F28.1 cleanup.range：过滤以 range 为闭区间，首尾命中、越界排除', () => {
      const now = fixedNow();
      const items = [
        assistantRow(1, { title: '首日零点', deadline: '2026-11-01 00:00', status: 'completed' }),
        assistantRow(2, { title: '末日末刻', deadline: '2026-11-30 23:59', status: 'completed' }),
        assistantRow(3, { title: '前一日', deadline: '2026-10-31 23:59', status: 'completed' }),
        assistantRow(4, { title: '后一日', deadline: '2026-12-01 00:00', status: 'completed' }),
        assistantRow(5, { title: '范围内未完成', deadline: '2026-11-15 09:00', status: 'not_started' })
      ];
      const result = cleanupPlan({ cleanup: { range: { type: 'this_month' } } }, items, { now });
      assert.deepEqual(plain(result.cleanup.range), { start: '2026-11-01', end: '2026-11-30' });
      assert.deepEqual(plain(result.cleanup.targets.map(target => target.id)), [1, 2]);
    });

    test('F28.1 cleanup.range：空结果与非空结果共用同一范围来源', () => {
      const now = fixedNow();
      const range = { type: 'this_month' };
      const empty = cleanupPlan(
        { message: '清理本月', cleanup: { range } },
        [assistantRow(3, { title: '上月完成', deadline: '2026-10-20 09:00', status: 'completed' })],
        { now }
      );
      const filled = cleanupPlan(
        { message: '清理本月', cleanup: { range } },
        [assistantRow(1, { title: '本月完成', deadline: '2026-11-05 09:00', status: 'completed' })],
        { now }
      );
      assert.deepEqual(plain(empty.cleanup.targets), []);
      assert.equal(empty.message, '没有符合条件的已完成事项。');
      assert.equal(filled.message, '清理本月');
      assert.deepEqual(plain(empty.cleanup.range), plain(filled.cleanup.range));
      assert.equal(empty.cleanup.rangeLabel, filled.cleanup.rangeLabel);
    });

    test('F28.1 cleanup.range：all 固定全区间，非法范围走 clarify 且无 cleanup/range', () => {
      const now = fixedNow();
      const all = cleanupPlan({ cleanup: { range: { type: 'all' } } }, [], { now });
      assert.equal(all.intent, 'cleanup');
      assert.deepEqual(plain(all.cleanup.range), { start: '0000-01-01', end: '9999-12-31' });
      assert.equal(all.cleanup.rangeLabel, '全部时间');
      assert.equal(all.message, '没有符合条件的已完成事项。');

      for (const cleanup of [
        {},
        { range: null },
        { range: {} },
        { range: { type: 'unknown' } },
        { range: { type: 'week' } },
        { range: { type: 'month', year: 2026, month: 13 } },
        { range: { type: 'custom', start: '2026-02-31', end: '2026-03-01' } }
      ]) {
        const result = cleanupPlan({ cleanup }, [], { now });
        assert.equal(result.intent, 'clarify', `${JSON.stringify(cleanup)} 应返回 clarify`);
        assert.equal(result.cleanup, undefined);
        assert.equal(Object.prototype.hasOwnProperty.call(result, 'range'), false);
      }
    });

    test('F28.1 cleanup 对象字段顺序：targets → rangeLabel → range（仅追加）', () => {
      const now = fixedNow();
      const result = cleanupPlan(
        { cleanup: { range: { type: 'this_month' } } },
        [assistantRow(1, { title: '本月完成', deadline: '2026-11-05 09:00', status: 'completed' })],
        { now }
      );
      assert.deepEqual(Object.keys(result.cleanup), ['targets', 'rangeLabel', 'range']);
      assert.deepEqual(Object.keys(result.cleanup.range), ['start', 'end']);
      assert.equal(result.ok, true);
      assert.equal(result.intent, 'cleanup');
      assert.equal(result.omittedCount, 0);
    });

    test('F28.1 cleanup.range：custom 起止倒序归一化为正序并用于过滤', () => {
      const now = fixedNow();
      const items = [
        assistantRow(1, { title: '较晚完成', deadline: '2026-03-09 00:00', status: 'completed' }),
        assistantRow(2, { title: '较早完成', deadline: '2026-01-05 23:59', status: 'completed' }),
        assistantRow(3, { title: '越界完成', deadline: '2026-01-04 23:59', status: 'completed' })
      ];
      const result = cleanupPlan({ cleanup: { range: { type: 'custom', start: '2026-03-09', end: '2026-01-05' } } }, items, { now });
      assert.deepEqual(plain(result.cleanup.range), { start: '2026-01-05', end: '2026-03-09' });
      assert.deepEqual(plain(result.cleanup.targets.map(target => target.id)), [2, 1]);
    });

    test('F28.3 assistant:parse：cleanup 响应带 range，其他意图不带 range', async () => {
      h.setDatabase(configuredDatabase({
        items: [assistantRow(1, { title: '上月已完成作业', deadline: monthDate(-1, 10, '09:00'), status: 'completed' })]
      }));
      h.setFetch(() => Promise.resolve(chatEnvelope(JSON.stringify({
        intent: 'cleanup',
        message: '清理上月',
        cleanup: { range: { type: 'last_month' } }
      }))));
      const result = await h.parse('清理上个月');
      const expected = resolve({ type: 'last_month' }, h.now());
      assert.equal(result.intent, 'cleanup');
      assert.deepEqual(plain(result.cleanup.range), { start: expected.start, end: expected.end });
      assert.equal(result.cleanup.rangeLabel, expected.label);
      assert.deepEqual(plain(result.cleanup.targets.map(target => target.id)), [1]);

      const others = [
        [{ intent: 'create', create: { candidates: [{ title: '新事项', kind: 'assignment', deadline: `${localDate(5)} 23:59`, status: 'not_started' }] } }, 'create'],
        [{ intent: 'update', update: { targetIds: [1], changes: { title: '新标题' } } }, 'update'],
        [{ intent: 'delete', delete: { targetIds: [1] } }, 'delete']
      ];
      for (const [payload, intent] of others) {
        h.setFetch(() => Promise.resolve(chatEnvelope(JSON.stringify(payload))));
        const other = await h.parse(`其他意图 ${intent}`);
        assert.equal(other.intent, intent);
        assert.equal(Object.prototype.hasOwnProperty.call(other[intent], 'range'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(other, 'range'), false);
      }
    });
  });

  describe('F16 assistant:parse 接线', () => {
    const planDatabase = items => createFakeDatabase({
      settings: { ai_endpoint: MOCK_ENDPOINT, ai_model: MODEL, ai_api_key: KEY },
      items
    });
    const planSeedItems = () => [
      assistantRow(1, { title: '数据库课程设计', deadline: `${localDate(3)} 23:59` }),
      assistantRow(2, { title: '校辩论赛报名', kind: 'activity', deadline: `${localDate(2)} 23:59`, status: 'not_completed' }),
      assistantRow(3, { title: '上月已完成作业', deadline: monthDate(-1, 10, '09:00'), status: 'completed' })
    ];
    const planPayloads = () => [
      {
        intent: 'create',
        message: '已整理候选',
        create: {
          candidates: [{ title: '新事项', kind: 'assignment', deadline: `${localDate(5)} 23:59`, status: 'not_started' }]
        }
      },
      { intent: 'update', message: '改一下', update: { targetIds: [1], changes: { title: '新标题' } } },
      { intent: 'delete', message: '删除', delete: { targetIds: [2] } },
      { intent: 'cleanup', message: '清理', cleanup: { range: { type: 'last_month' } } }
    ];

    test('F16 四种写意图直接透传计划字段并保留 omittedCount', async () => {
      h.setDatabase(planDatabase(planSeedItems()));
      const checks = [
        result => {
          assert.equal(result.create.candidates.length, 1);
          assert.equal(result.message, '已整理候选');
        },
        result => {
          assert.equal(result.update.targets.length, 1);
          assert.equal(result.update.applyToId, 1);
          assert.equal(result.update.changes.title, '新标题');
        },
        result => {
          assert.equal(result.delete.targets.length, 1);
          assert.equal(result.delete.targets[0].selected, true);
        },
        result => {
          assert.deepEqual(plain(result.cleanup.targets.map(target => target.id)), [3]);
        }
      ];
      const payloads = planPayloads();
      for (let index = 0; index < payloads.length; index += 1) {
        h.setFetch(() => Promise.resolve(chatEnvelope(JSON.stringify(payloads[index]))));
        const result = await h.parse(`写意图 ${payloads[index].intent}`);
        assert.equal(result.ok, true);
        assert.equal(result.intent, payloads[index].intent);
        assert.equal(result.omittedCount, 0);
        checks[index](result);
      }
    });

    test('F16 计划自身返回 clarify 时直接透传且不带计划字段', async () => {
      h.setDatabase(planDatabase(planSeedItems()));
      const scenarios = [
        [{ intent: 'create', create: { candidates: [], ignored: [] } }, '没有识别到可新增的事项。'],
        [{ intent: 'update', update: {} }, '没有找到匹配的事项。'],
        [{ intent: 'update', update: { targetIds: [1], changes: {} } }, '请说明要修改的内容。'],
        [{ intent: 'delete', delete: {} }, '没有找到匹配的事项。'],
        [{ intent: 'cleanup', cleanup: {} }, '请补充清理范围（例如上个月、本月、今年、某个具体月份或全部已完成）。']
      ];
      for (const [payload, message] of scenarios) {
        h.setFetch(() => Promise.resolve(chatEnvelope(JSON.stringify(payload))));
        const result = await h.parse('计划归一化');
        assert.equal(result.ok, true);
        assert.equal(result.intent, 'clarify');
        assert.equal(result.message, message);
        for (const field of ['create', 'update', 'delete', 'cleanup', 'query']) {
          assert.equal(result[field], undefined);
        }
      }
    });

    test('F16 四种写意图全流程零写入', async () => {
      const db = planDatabase(planSeedItems());
      h.setDatabase(db);
      const settingsBefore = JSON.stringify(settingsSnapshot(db));
      const itemsBefore = h.itemsSnapshot();
      for (const payload of planPayloads()) {
        h.setFetch(() => Promise.resolve(chatEnvelope(JSON.stringify(payload))));
        await h.parse(`写意图 ${payload.intent}`);
      }
      assert.equal(JSON.stringify(settingsSnapshot(db)), settingsBefore);
      assert.equal(h.itemsSnapshot(), itemsBefore);
    });

    test('F16 疑似重复检测使用全量而非摘要', async () => {
      const items = [];
      for (let id = 1; id <= 100; id += 1) {
        const isAssignment = id % 2 === 1;
        items.push(assistantRow(id, {
          title: `近期待办 ${id}`,
          kind: isAssignment ? 'assignment' : 'activity',
          deadline: `${localDate(id)} 23:59`,
          status: isAssignment ? 'not_started' : 'not_completed'
        }));
      }
      items.push(assistantRow(101, { title: '数据库课程设计', deadline: monthDate(-1, 3, '10:00'), status: 'completed' }));
      h.setDatabase(planDatabase(items));

      const summary = h.fn('buildAssistantSummary')(h.now(), h.fn('readItemsForAssistant')());
      assert.ok(!summary.items.some(item => item.id === 101), '第 101 条应被摘要省略');

      h.setFetch(() => Promise.resolve(chatEnvelope(JSON.stringify({
        intent: 'create',
        create: {
          candidates: [{ title: '数据库课设', kind: 'assignment', deadline: `${localDate(5)} 23:59`, status: 'not_started' }]
        }
      }))));
      const result = await h.parse('新增数据库课设');
      assert.equal(result.intent, 'create');
      assert.equal(result.omittedCount, 1);
      assert.equal(result.create.candidates[0].duplicate.id, 101);
      assert.equal(result.create.candidates[0].selected, false);
    });

    test('F16 摘要外 id：部分解析成功带 note，全部无效 clarify 带 note', async () => {
      const items = [];
      for (let id = 1; id <= 100; id += 1) {
        items.push(assistantRow(id, { title: `近期待办 ${id}`, deadline: `${localDate(id)} 23:59`, status: 'not_started' }));
      }
      items.push(assistantRow(101, { title: '摘要外事项', deadline: monthDate(-1, 3, '10:00'), status: 'completed' }));
      h.setDatabase(planDatabase(items));

      h.setFetch(() => Promise.resolve(chatEnvelope(JSON.stringify({
        intent: 'update',
        message: '改一下',
        update: { targetIds: [1, 101], changes: { title: '新标题' } }
      }))));
      const partial = await h.parse('修改两条');
      assert.equal(partial.intent, 'update');
      assert.equal(partial.update.targets.length, 1);
      assert.equal(partial.message, '改一下；超出本次可操作范围的事项 id：101');

      h.setFetch(() => Promise.resolve(chatEnvelope(JSON.stringify({
        intent: 'update',
        update: { targetIds: [101], changes: { title: '新标题' } }
      }))));
      const invalid = await h.parse('修改一条');
      assert.equal(invalid.intent, 'clarify');
      assert.ok(invalid.message.startsWith('没有找到匹配的事项。'));
      assert.ok(invalid.message.includes('超出本次可操作范围的事项 id：101'));
      assert.equal(invalid.update, undefined);
    });
  });

  // ============ F10–F16 契约补强 ============

  describe('F10–F16 契约补强', () => {
    const planRows = () => [
      assistantRow(1, { title: '数据库课程设计', deadline: `${localDate(3)} 23:59` }),
      assistantRow(2, { title: '校辩论赛报名', kind: 'activity', deadline: `${localDate(2)} 23:59`, status: 'not_completed' })
    ];
    const createPlan = (payload, allItems = []) => h.fn('normalizeCreatePlan')(planOptions(payload, allItems));
    const updatePlan = (payload, allItems, overrides) => h.fn('normalizeUpdatePlan')(planOptions(payload, allItems, overrides));
    const deletePlan = (payload, allItems, overrides) => h.fn('normalizeDeletePlan')(planOptions(payload, allItems, overrides));
    const cleanupPlan = (payload, allItems, overrides) => h.fn('normalizeCleanupPlan')(planOptions(payload, allItems, overrides));

    test('F12 候选输出：顶层与候选键顺序固定，statusAdjusted 恒为 false', () => {
      const result = createPlan({
        message: '已整理',
        create: { candidates: [{ title: '新作业', kind: 'assignment', deadline: `${localDate(5)} 23:59`, status: 'not_started' }] }
      });
      assert.deepEqual(Object.keys(result), ['ok', 'intent', 'message', 'omittedCount', 'create']);
      const candidate = result.create.candidates[0];
      assert.deepEqual(Object.keys(candidate), [
        'rowId', 'title', 'kind', 'status', 'description', 'workType',
        'deadline', 'deadlineIssue', 'titleTooLong', 'statusInvalid', 'statusAdjusted',
        'expired', 'duplicate', 'selected', 'executable'
      ]);
      assert.equal(candidate.statusAdjusted, false);
      assert.equal(candidate.rowId, 'c0');
    });

    test('F12 create 源非普通对象：缺失 / null / 数组 / 非对象均返回 clarify', () => {
      for (const payload of [{}, { create: null }, { create: [] }, { create: 'x' }, { create: 5 }]) {
        const result = createPlan(payload);
        assert.deepEqual(plain(result), {
          ok: true,
          intent: 'clarify',
          message: '没有识别到可新增的事项。',
          omittedCount: 0
        }, `${JSON.stringify(payload)} 应归一化为空计划`);
      }
    });

    test('F12 message：非字符串回落空串，字符串原值不 trim', () => {
      const valid = { create: { candidates: [{ title: '新作业', kind: 'assignment', deadline: `${localDate(5)} 23:59`, status: 'not_started' }] } };
      const nonString = createPlan({ message: 42, ...valid });
      assert.equal(nonString.message, '');
      const raw = createPlan({ message: '  已整理  ', ...valid });
      assert.equal(raw.message, '  已整理  ');
    });

    test('F12 status：空白字符串按缺失取默认，非字符串非空值标记无效', () => {
      const blank = createPlan({ create: { candidates: [{ title: '空白状态', kind: 'activity', deadline: `${localDate(5)} 23:59`, status: '   ' }] } });
      assert.equal(blank.create.candidates[0].status, 'not_completed');
      assert.equal(blank.create.candidates[0].statusInvalid, false);
      assert.equal(blank.create.candidates[0].executable, true);
      const nonString = createPlan({ create: { candidates: [{ title: '非字符串状态', kind: 'assignment', deadline: `${localDate(5)} 23:59`, status: 0 }] } });
      assert.equal(nonString.create.candidates[0].status, null);
      assert.equal(nonString.create.candidates[0].statusInvalid, true);
      assert.equal(nonString.create.candidates[0].executable, false);
    });

    test('F13 计划字段：键顺序固定、update.message 与顶层一致、omittedCount 透传', () => {
      const result = updatePlan(
        { message: '改一下', update: { targetIds: [1], changes: { title: '新标题' } } },
        planRows(),
        { omittedCount: 2 }
      );
      assert.deepEqual(Object.keys(result), ['ok', 'intent', 'message', 'omittedCount', 'update']);
      assert.deepEqual(Object.keys(result.update), [
        'targets', 'ambiguous', 'applyToId', 'changes', 'statusInvalid', 'deadlineInvalid', 'titleTooLong', 'message'
      ]);
      assert.deepEqual(Object.keys(result.update.targets[0]), ['id', 'title', 'kind', 'deadline', 'status', 'isAmbiguous']);
      assert.equal(result.update.message, result.message);
      assert.equal(result.message, '改一下');
      assert.equal(result.omittedCount, 2);
    });

    test('F13 changes 非普通对象：按无变更处理并返回 clarify', () => {
      for (const changes of [[], 'x', null]) {
        const result = updatePlan({ update: { targetIds: [1], changes } }, planRows());
        assert.equal(result.intent, 'clarify');
        assert.equal(result.message, '请说明要修改的内容。');
        assert.equal(result.update, undefined);
      }
    });

    test('F14 targetIds 非数组或元素非数字：固定 clarify，不推导范围', () => {
      for (const payload of [
        { delete: { targetIds: '3' } },
        { delete: { targetIds: {} } },
        { delete: { targetIds: [['3']] } }
      ]) {
        const result = deletePlan(payload, planRows());
        assert.deepEqual(plain(result), {
          ok: true,
          intent: 'clarify',
          message: '没有找到匹配的事项。',
          omittedCount: 0
        });
        assert.equal(result.delete, undefined);
      }
    });

    test('F15 cleanup：非字符串 message 回落空串，非法 kind 不参与清理', () => {
      const items = [
        assistantRow(1, { title: '已完成作业', deadline: monthDate(-1, 5, '09:00'), status: 'completed' }),
        assistantRow(2, { title: '已完成日记', kind: 'diary', deadline: monthDate(-1, 10, '09:00'), status: 'completed' }),
        assistantRow(3, { title: '已完成活动', kind: 'activity', deadline: monthDate(-1, 20, '09:00'), status: 'completed' })
      ];
      const result = cleanupPlan({ message: 42, cleanup: { range: { type: 'last_month' } } }, items);
      assert.equal(result.intent, 'cleanup');
      assert.deepEqual(plain(result.cleanup.targets.map(target => target.id)), [1, 3]);
      assert.equal(result.message, '');
      assert.ok(result.cleanup.targets.every(target => target.kind !== 'diary'));
    });

    test('F15.1 resolveRange：options 为 null 时不崩溃，all 仍返回 null', () => {
      const resolve = h.fn('resolveRange');
      assert.equal(resolve({ type: 'all' }, h.now(), null), null);
      const month = resolve({ type: 'this_month' }, h.now(), null);
      assert.ok(month, '普通范围不应受 options 影响');
      assert.equal(typeof month.start, 'string');
      assert.equal(typeof month.end, 'string');
    });

    test('F16.1 buildAssistantSummary：使用传入 rows 而非数据库，截取与 omit 计数不变', () => {
      h.setDatabase(createFakeDatabase({
        items: [assistantRow(1), assistantRow(2)]
      }));
      const build = h.fn('buildAssistantSummary');
      assert.deepEqual(plain(build(h.now(), [])), { items: [], omittedCount: 0 });
      assert.equal(build(h.now()).items.length, 2, '不传 rows 时仍自行读取数据库');

      const rows = [];
      for (let id = 1; id <= 101; id += 1) rows.push(assistantRow(id));
      const summary = build(h.now(), rows);
      assert.equal(summary.items.length, 100);
      assert.equal(summary.omittedCount, 1);
      assert.ok(!summary.items.some(item => item.id === 101), '距离最远的第 101 条应被截断');
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

  // ============ F19 助手页 DOM 契约（v3） ============

  describe('F19 助手页 DOM 契约', () => {
    const html = fs.readFileSync(path.join(projectDir, 'src/index.html'), 'utf8');
    const sidebarBottom = html.slice(html.indexOf('<div class="sidebar-bottom">'), html.indexOf('</aside>'));
    const assistantStart = html.indexOf('<section class="page" data-page-view="assistant">');
    const settingsStart = html.indexOf('<section class="page" data-page-view="settings">');
    const assistantBlock = html.slice(assistantStart, settingsStart);
    const tagOf = id => {
      const match = assistantBlock.match(new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`));
      assert.ok(match, `助手页缺少 #${id}`);
      return match[0];
    };

    test('F19.1 工作台标签：助手位于标签栏末尾，无角标且文案为「助手」；侧边栏底部只剩设置', () => {
      const pages = [...sidebarBottom.matchAll(/<button class="nav-item" data-page="([a-z]+)"/g)].map(match => match[1]);
      assert.deepEqual(pages, ['settings']);
      const tabStart = html.indexOf('<nav class="ws-tabs"');
      const tabBar = html.slice(tabStart, html.indexOf('</nav>', tabStart));
      const tabs = [...tabBar.matchAll(/<button class="ws-tab[^"]*" data-page="([a-z]+)"/g)].map(match => match[1]);
      assert.deepEqual(tabs, ['today', 'assignments', 'activities', 'overdue', 'assistant']);
      const assistantNav = tabBar.match(/<button class="ws-tab" data-page="assistant">([\s\S]*?)<\/button>/)[1];
      assert.ok(assistantNav.includes('data-icon="assistant"'));
      assert.ok(assistantNav.includes('助手'));
      assert.ok(!assistantNav.includes('nav-count'), '助手导航不应带角标');
    });

    test('F19.2 助手页位置与骨架：位于设置页之前，关键节点唯一且初始状态符合契约', () => {
      assert.ok(assistantStart > 0, '缺少助手页容器');
      assert.ok(settingsStart > assistantStart, '助手页应排在设置页之前');

      const ids = [
        'assistantConfigWarning', 'assistantGoSettings', 'assistantInput', 'assistantCounter',
        'assistantSubmit', 'assistantRetry', 'assistantResult', 'assistantRecords'
      ];
      for (const id of ids) {
        const occurrences = assistantBlock.match(new RegExp(`id="${id}"`, 'g')) || [];
        assert.equal(occurrences.length, 1, `#${id} 应恰好出现一次`);
      }

      const warningTag = tagOf('assistantConfigWarning');
      assert.ok(warningTag.includes('role="status"'));
      assert.ok(warningTag.includes('data-config="pending"'));
      assert.ok(/\bhidden\b/.test(warningTag));

      const resultTag = tagOf('assistantResult');
      assert.ok(resultTag.includes('aria-live="polite"'));
      const recordsTag = tagOf('assistantRecords');
      assert.ok(/\bhidden\b/.test(recordsTag));
      const retryTag = tagOf('assistantRetry');
      assert.ok(/\bhidden\b/.test(retryTag), '重试按钮初始应隐藏');

      const submitContent = assistantBlock.match(/<button class="primary-button" id="assistantSubmit">([\s\S]*?)<\/button>/)[1];
      assert.ok(submitContent.includes('data-icon="check"'));
      assert.ok(submitContent.includes('解析'));
      assert.ok(assistantBlock.includes('>前往设置</button>'));
    });

    test('F19.2 输入与隐私：输入框无 maxlength、计数初值 0 / 3000、隐私说明含两类字段清单', () => {
      const inputTag = tagOf('assistantInput');
      assert.ok(inputTag.startsWith('<textarea'), '#assistantInput 应为 textarea');
      assert.ok(!inputTag.includes('maxlength'), '输入框不应设 maxlength');
      assert.ok(assistantBlock.includes('>0 / 3000</span>'));

      const privacy = assistantBlock.match(/<p class="assistant-privacy">([\s\S]*?)<\/p>/)[1];
      for (const token of ['会发送到你配置的第三方接口', '不会发送', '编号、标题、类型、截止时间、状态', '事项说明、附件文件、日记']) {
        assert.ok(privacy.includes(token), `隐私说明缺少「${token}」`);
      }
    });

    test('F19.3 静态安全：助手页不含内联事件处理器与内联 style', () => {
      assert.ok(!/\son(?:click|input|change|submit|load|error|focus|blur|keydown|keyup)\s*=/i.test(assistantBlock));
      assert.ok(!assistantBlock.includes('style="'));
    });
  });

  // ============ F20 设置页 AI 配置 DOM 契约（v4） ============

  describe('F20 设置页 AI 配置 DOM 契约', () => {
    const html = fs.readFileSync(path.join(projectDir, 'src/index.html'), 'utf8');
    const settingsStart = html.indexOf('<section class="page" data-page-view="settings">');
    assert.ok(settingsStart > 0, '缺少设置页容器');
    const settingsPageEnd = html.indexOf('</main>', settingsStart);
    assert.ok(settingsPageEnd > settingsStart, '缺少设置页结束位置');
    const settingsBlock = html.slice(settingsStart, settingsPageEnd);
    const aiGroupStart = settingsBlock.lastIndexOf('<section', settingsBlock.indexOf('id="aiSettingsGroup"'));
    const backupHeading = settingsBlock.indexOf('<h2>备份与恢复</h2>');
    const aiGroupEnd = settingsBlock.lastIndexOf('<section', backupHeading);
    assert.ok(aiGroupStart > 0 && aiGroupEnd > aiGroupStart, 'AI 配置分组切片失败');
    const aiGroup = settingsBlock.slice(aiGroupStart, aiGroupEnd);
    const tagOfIn = (block, id) => {
      const match = block.match(new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`));
      assert.ok(match, `设置页缺少 #${id}`);
      return match[0];
    };

    test('F20.1 分组顺序与字段：AI 配置位于桌面小组件与备份之间，字段类型正确', () => {
      const headings = [...settingsBlock.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map(match => match[1].trim());
      assert.deepEqual(headings, ['提醒', '桌面小组件', 'AI 配置', '备份与恢复', '本地数据']);

      const groupTag = tagOfIn(aiGroup, 'aiSettingsGroup');
      assert.ok(groupTag.startsWith('<section'));
      assert.ok(aiGroup.includes('<span>助手调用的在线模型</span>'), '缺少分组副标题');

      for (const label of ['接口地址', '模型名', 'API Key', '新的 API Key']) {
        assert.ok(aiGroup.includes(`<span>${label}</span>`), `缺少字段标签「${label}」`);
      }

      const endpointTag = tagOfIn(aiGroup, 'aiEndpointInput');
      assert.ok(endpointTag.includes('type="url"'));
      assert.ok(endpointTag.includes('placeholder="https://api.example.com/v1/chat/completions"'));
      assert.ok(!endpointTag.includes('maxlength'), '接口地址输入框不应设置 maxlength');

      const modelTag = tagOfIn(aiGroup, 'aiModelInput');
      assert.ok(modelTag.includes('type="text"'));
      assert.ok(modelTag.includes('maxlength="200"'));
      assert.ok(modelTag.includes('placeholder="例如：gpt-4o-mini"'));

      const saveContent = aiGroup.match(/<button[^>]*\bid="aiSettingsSave"[^>]*>([\s\S]*?)<\/button>/)[1];
      assert.ok(saveContent.includes('data-icon="check"'));
      assert.ok(saveContent.includes('保存 AI 配置'));
    });

    test('F20.2 默认态与 Key 输入：初始未设置、Key 输入框隐藏且不含明文', () => {
      const uniqueIds = [
        'aiSettingsGroup', 'aiEndpointInput', 'aiModelInput', 'aiKeyMask', 'aiKeyEditButton',
        'aiKeyField', 'aiKeyInput', 'aiSettingsStatus', 'aiSettingsSave'
      ];
      for (const id of uniqueIds) {
        const occurrences = aiGroup.match(new RegExp(`id="${id}"`, 'g')) || [];
        assert.equal(occurrences.length, 1, `#${id} 应恰好出现一次`);
      }
      assert.ok(!aiGroup.includes('<form'), 'AI 配置分组不应包在 <form> 内');

      assert.ok(aiGroup.includes('<strong id="aiKeyMask">未设置</strong>'));

      const keyFieldTag = tagOfIn(aiGroup, 'aiKeyField');
      assert.ok(keyFieldTag.includes('class="field full hidden"'));

      const keyInputTag = tagOfIn(aiGroup, 'aiKeyInput');
      assert.ok(keyInputTag.includes('type="password"'));
      assert.ok(keyInputTag.includes('maxlength="4096"'));
      assert.ok(keyInputTag.includes('autocomplete="new-password"'));
      assert.ok(!keyInputTag.includes('value'), 'Key 输入框不应带 value 属性');

      const statusTag = tagOfIn(aiGroup, 'aiSettingsStatus');
      assert.ok(statusTag.includes('data-ai-status="missing"'));
      const statusContent = aiGroup.match(/<div[^>]*\bid="aiSettingsStatus"[^>]*>([\s\S]*?)<\/div>/)[1];
      assert.equal(statusContent.trim(), '配置不完整，助手功能不可用');
    });

    test('F20.3 隐私说明：列出发送与不发送的字段清单', () => {
      const privacy = aiGroup.match(/<div class="setting-note">[\s\S]*?<p>([\s\S]*?)<\/p>/)[1];
      for (const token of ['会发送到你配置的第三方接口', '不会发送', '编号、标题、类型、截止时间、状态', '事项说明、附件文件、日记', '只显示掩码']) {
        assert.ok(privacy.includes(token), `隐私说明缺少「${token}」`);
      }
      assert.ok(privacy.includes('不随导出备份打包'), '隐私说明应说明 Key 不随导出备份');
      assert.ok(privacy.includes('恢复备份时保留本机 Key'), '隐私说明应说明恢复时保留本机 Key');
    });

    test('F20.4 静态安全：不含内联事件处理器、内联 style，修改按钮为 type="button"', () => {
      assert.ok(!/\son(?:click|input|change|submit|load|error|focus|blur|keydown|keyup)\s*=/i.test(aiGroup));
      assert.ok(!aiGroup.includes('style="'));
      const editTag = tagOfIn(aiGroup, 'aiKeyEditButton');
      assert.ok(editTag.startsWith('<button'));
      assert.ok(editTag.includes('type="button"'));
    });
  });

  // ============ F21 备份 / 恢复的 AI Key 治理 ============

  async function withRealDatabase(run) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deadline-desk-backup-test-'));
    const previous = process.env.DEADLINE_DESK_DATA_DIR;
    process.env.DEADLINE_DESK_DATA_DIR = dataDir;
    try {
      await h.fn('initializeDatabase')();
      const realDb = h.evalIn('database');
      await run({ realDb, dataDir });
    } finally {
      const current = h.evalIn('database');
      if (current && current.open) current.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
      if (previous === undefined) delete process.env.DEADLINE_DESK_DATA_DIR;
      else process.env.DEADLINE_DESK_DATA_DIR = previous;
    }
  }

  function seedLocalDatabase(host) {
    const { realDb } = host;
    realDb.prepare('INSERT INTO items (kind, title, description, deadline, status, work_type) VALUES (?, ?, ?, ?, ?, ?)')
      .run('assignment', '本机事项', '', `${localDate(1)} 23:59`, 'not_started', 'personal');
  }

  describe('F21 备份 / 恢复的 AI Key 治理', () => {
    test('F21.1 导出备份剔除 Key、保留地址/模型与 manifest，且不影响本机配置', async () => {
      await withRealDatabase(async host => {
        const { realDb, dataDir } = host;
        h.fn('setSetting')('ai_endpoint', MOCK_ENDPOINT);
        h.fn('setSetting')('ai_model', MODEL);
        h.fn('setSetting')('ai_api_key', KEY);
        seedLocalDatabase(host);
        realDb.persist();

        const dbFile = h.fn('getPaths')().database;
        assert.equal(fs.readFileSync(dbFile).includes(Buffer.from(KEY)), true, '前置：本机数据库应包含 Key 字节');

        const localConfig = plain(h.fn('readAiConfig')());
        const localTitles = plain(realDb.prepare('SELECT title FROM items').all().map(row => row.title));

        const backupPath = path.join(dataDir, 'backup.zip');
        const zipDir = path.join(dataDir, 'unzipped');
        await h.fn('createBackupArchive')(backupPath);
        fs.mkdirSync(zipDir, { recursive: true });
        await extract(backupPath, { dir: zipDir });
        assert.equal(fs.existsSync(path.join(zipDir, 'deadline-desk.db')), true, '备份应包含数据库');
        assert.equal(fs.existsSync(path.join(zipDir, 'manifest.json')), true, '备份应包含 manifest');

        const settings = await readSettingsFile(path.join(zipDir, 'deadline-desk.db'));
        assert.equal(settings.ai_endpoint, MOCK_ENDPOINT);
        assert.equal(settings.ai_model, MODEL);
        assert.equal(settings.ai_api_key, undefined);

        assert.equal(fs.readFileSync(path.join(zipDir, 'deadline-desk.db')).includes(Buffer.from(KEY)), false, '备份数据库不应包含 Key 字节');
        const manifestText = fs.readFileSync(path.join(zipDir, 'manifest.json'), 'utf8');
        const manifest = JSON.parse(manifestText);
        assert.equal(manifest.app, 'Deadline Desk');
        assert.equal(manifest.version, 1);
        assert.equal(manifestText.includes(KEY), false, 'manifest 不应包含 Key');

        assert.equal(plain(h.fn('readAiConfig')()).apiKey, KEY, '导出不应改动本机 Key');
        assert.equal(h.fn('buildAiSettingsView')().keyMask, KEY_MASK, '导出不应改动本机掩码');
        assert.deepEqual(plain(h.fn('readAiConfig')()), localConfig, '导出不应改动本机 AI 配置');
        assert.deepEqual(plain(realDb.prepare('SELECT title FROM items').all().map(row => row.title)), localTitles, '导出不应改动本机事项');
        assert.equal(fs.readFileSync(dbFile).includes(Buffer.from(KEY)), true, '导出后本机数据库仍应保留 Key 字节');
      });
    });

    test('F21.2 恢复备份忽略备份 Key、回填本机 Key，并覆盖事项', async () => {
      await withRealDatabase(async host => {
        const { dataDir } = host;
        h.fn('setSetting')('ai_api_key', KEY);
        seedLocalDatabase(host);

        const fixtureZip = path.join(dataDir, 'fixture.zip');
        await createBackupFixture(fixtureZip, {
          endpoint: BACKUP_ENDPOINT,
          model: BACKUP_MODEL,
          apiKey: BACKUP_KEY,
          title: '备份事项'
        });
        await h.fn('restoreBackupArchive')(fixtureZip);

        assert.deepEqual(plain(h.fn('readAiConfig')()), { protocol: 'openai', endpoint: BACKUP_ENDPOINT, model: BACKUP_MODEL, apiKey: KEY });
        const view = plain(h.fn('buildAiSettingsView')());
        assert.equal(view.configured, true);
        assert.equal(view.keyMask, KEY_MASK);

        const restoredDb = h.evalIn('database');
        assert.deepEqual(plain(restoredDb.prepare('SELECT title FROM items').all().map(row => row.title)), ['备份事项']);

        const dbFile = h.fn('getPaths')().database;
        assert.equal(fs.readFileSync(dbFile).includes(Buffer.from(KEY)), true, '恢复后应落盘本机 Key');
        assert.equal(fs.readFileSync(dbFile).includes(Buffer.from(BACKUP_KEY)), false, '备份 Key 不应在磁盘残留');
      });
    });

    test('F21.3 本机无 Key 时恢复后保持未配置', async () => {
      await withRealDatabase(async host => {
        const { dataDir } = host;
        h.fn('setSetting')('ai_endpoint', MOCK_ENDPOINT);
        h.fn('setSetting')('ai_model', MODEL);

        const fixtureZip = path.join(dataDir, 'fixture.zip');
        await createBackupFixture(fixtureZip, {
          endpoint: BACKUP_ENDPOINT,
          model: BACKUP_MODEL,
          apiKey: BACKUP_KEY,
          title: '备份事项'
        });
        await h.fn('restoreBackupArchive')(fixtureZip);

        const config = plain(h.fn('readAiConfig')());
        assert.equal(config.endpoint, BACKUP_ENDPOINT);
        assert.equal(config.model, BACKUP_MODEL);
        assert.equal(config.apiKey, '');
        const view = plain(h.fn('buildAiSettingsView')());
        assert.equal(view.configured, false);
        assert.equal(view.keyMask, '');

        const dbFile = h.fn('getPaths')().database;
        assert.equal(fs.readFileSync(dbFile).includes(Buffer.from(BACKUP_KEY)), false, '备份 Key 不应落盘');
        const settings = await readSettingsFile(dbFile);
        assert.equal(settings.ai_api_key, undefined);
      });
    });

    test('F21.4 清空全部数据不影响 AI 配置', async () => {
      await withRealDatabase(async ({ realDb }) => {
        h.fn('setSetting')('ai_endpoint', MOCK_ENDPOINT);
        h.fn('setSetting')('ai_model', MODEL);
        h.fn('setSetting')('ai_api_key', KEY);
        realDb.prepare('INSERT INTO items (kind, title, description, deadline, status, work_type) VALUES (?, ?, ?, ?, ?, ?)')
          .run('assignment', '本机事项', '', `${localDate(1)} 23:59`, 'not_started', 'personal');

        const before = plain(h.fn('readAiConfig')());
        const beforeView = plain(h.fn('buildAiSettingsView')());
        await h.call('data:clear', h.mainEvent);

        assert.deepEqual(plain(h.fn('readAiConfig')()), before);
        assert.deepEqual(plain(h.fn('buildAiSettingsView')()), beforeView);
        assert.deepEqual(plain(realDb.prepare('SELECT id FROM items').all()), []);
      });
    });

    test('F21.5 备份校验失败时抛出错误且不读取、不修改本机 Key 与事项', async () => {
      await withRealDatabase(async host => {
        const { realDb, dataDir } = host;
        h.fn('setSetting')('ai_endpoint', MOCK_ENDPOINT);
        h.fn('setSetting')('ai_model', MODEL);
        h.fn('setSetting')('ai_api_key', KEY);
        seedLocalDatabase(host);
        realDb.persist();

        const dbFile = h.fn('getPaths')().database;
        const localConfig = plain(h.fn('readAiConfig')());

        // 数据库合法但 manifest 不符版本契约，恢复应在读取本机 Key 之前终止
        const fixtureZip = path.join(dataDir, 'fixture.zip');
        await createBackupFixture(fixtureZip, {
          endpoint: BACKUP_ENDPOINT,
          model: BACKUP_MODEL,
          apiKey: BACKUP_KEY,
          title: '备份事项'
        });
        const invalidZip = path.join(dataDir, 'invalid-manifest.zip');
        await createZipArchive(invalidZip, {
          database: `${fixtureZip}.db`,
          manifest: JSON.stringify({ app: 'Other App', version: 1 })
        });

        const error = await captureRejection(h.fn('restoreBackupArchive')(invalidZip));
        assert.equal(error.message, '备份版本不受支持');

        assert.deepEqual(plain(h.fn('readAiConfig')()), localConfig, '校验失败不应改动本机 AI 配置');
        assert.deepEqual(plain(realDb.prepare('SELECT title FROM items').all().map(row => row.title)), ['本机事项'], '校验失败不应覆盖本机事项');
        assert.equal(fs.readFileSync(dbFile).includes(Buffer.from(KEY)), true, '校验失败后本机 Key 应仍在磁盘');
        assert.equal(fs.readFileSync(dbFile).includes(Buffer.from(BACKUP_KEY)), false, '校验失败不应写入备份 Key');
      });
    });

    test('F21.6 备份缺少地址与模型时恢复按空值计算且仍回填本机 Key', async () => {
      await withRealDatabase(async host => {
        const { realDb, dataDir } = host;
        h.fn('setSetting')('ai_endpoint', MOCK_ENDPOINT);
        h.fn('setSetting')('ai_model', MODEL);
        h.fn('setSetting')('ai_api_key', KEY);
        realDb.persist();

        const fixtureZip = path.join(dataDir, 'fixture.zip');
        await createBackupFixture(fixtureZip, {
          endpoint: BACKUP_ENDPOINT,
          model: BACKUP_MODEL,
          apiKey: BACKUP_KEY,
          title: '备份事项'
        });
        const SQL = await loadSqlJs();
        const db = new SQL.Database(fs.readFileSync(`${fixtureZip}.db`));
        try {
          db.run("DELETE FROM settings WHERE key IN ('ai_endpoint','ai_model')");
          fs.writeFileSync(`${fixtureZip}.db`, Buffer.from(db.export()));
        } finally {
          db.close();
        }
        await createZipArchive(fixtureZip, {
          database: `${fixtureZip}.db`,
          manifest: JSON.stringify({ app: 'Deadline Desk', version: 1, createdAt: '2026-11-07T00:00:00.000Z' })
        });

        await h.fn('restoreBackupArchive')(fixtureZip);

        const config = plain(h.fn('readAiConfig')());
        assert.equal(config.endpoint, '', '备份缺少地址时恢复后按空值计算');
        assert.equal(config.model, '', '备份缺少模型时恢复后按空值计算');
        assert.equal(config.apiKey, KEY, '本机 Key 仍应回填');
        const view = plain(h.fn('buildAiSettingsView')());
        assert.equal(view.configured, false);
        assert.equal(view.keyMask, KEY_MASK);

        const dbFile = h.fn('getPaths')().database;
        const settings = await readSettingsFile(dbFile);
        assert.equal(settings.ai_endpoint, undefined);
        assert.equal(settings.ai_model, undefined);
        assert.equal(settings.ai_api_key, KEY);
        assert.equal(fs.readFileSync(dbFile).includes(Buffer.from(BACKUP_KEY)), false, '备份 Key 不应落盘');
      });
    });
  });

  // ============ F29 接口协议与双协议契约 ============

  describe('F29 接口协议与双协议契约', () => {
    const anthropicDatabase = (extra = {}) => createFakeDatabase({
      settings: { ai_endpoint: ANTHROPIC_ENDPOINT, ai_model: MODEL, ai_api_key: KEY, ai_protocol: 'anthropic' },
      ...extra
    });

    test('F29.1 normalizeAiProtocol / readAiConfig：协议缺省与非法值回退', () => {
      const normalize = h.fn('normalizeAiProtocol');
      assert.equal(normalize('anthropic'), 'anthropic');
      for (const value of ['openai', undefined, null, '', 'OpenAI', ' anthropic ', 123, {}]) {
        assert.equal(normalize(value), 'openai', `${String(value)} 应回落 openai`);
      }

      h.setDatabase(createFakeDatabase());
      assert.deepEqual(plain(h.fn('readAiConfig')()), { protocol: 'openai', endpoint: '', model: '', apiKey: '' });

      const cases = [
        ['', 'openai'],
        ['anthropic', 'anthropic'],
        ['Anthropic', 'openai'],
        ['foo', 'openai']
      ];
      for (const [stored, expected] of cases) {
        const db = createFakeDatabase({
          settings: { ai_endpoint: MOCK_ENDPOINT, ai_model: MODEL, ai_api_key: KEY, ai_protocol: stored }
        });
        h.setDatabase(db);
        assert.equal(h.fn('readAiConfig')().protocol, expected, `${stored} 读取协议不正确`);
        assert.deepEqual(settingsSnapshot(db), {
          ai_endpoint: MOCK_ENDPOINT,
          ai_model: MODEL,
          ai_api_key: KEY,
          ai_protocol: stored
        });
      }
    });

    test('F29.2 buildAiSettingsView / settings:get：协议与既有字段同级', () => {
      h.setDatabase(createFakeDatabase());
      assert.deepEqual(plain(h.fn('buildAiSettingsView')()), {
        configured: false,
        protocol: 'openai',
        endpoint: '',
        model: '',
        keyMask: ''
      });

      h.setDatabase(anthropicDatabase());
      assert.deepEqual(plain(h.fn('buildAiSettingsView')()), {
        configured: true,
        protocol: 'anthropic',
        endpoint: ANTHROPIC_ENDPOINT,
        model: MODEL,
        keyMask: KEY_MASK
      });

      h.setDatabase(configuredDatabase());
      const legacy = plain(h.fn('buildAiSettingsView')());
      assert.equal(legacy.protocol, 'openai');
      assert.equal(legacy.configured, true);

      h.setDatabase(anthropicDatabase());
      const result = plain(h.settingsGet());
      assert.equal(result.ai.protocol, 'anthropic');
      assert.equal(Object.keys(result.ai).length, 5);
      assert.ok(!JSON.stringify(result).includes(KEY));
    });

    test('F29.3 settings:set-ai：保存 / 省略 / 非法协议与零写入', () => {
      h.setDatabase(createFakeDatabase());
      const saved = h.saveAi({ endpoint: ANTHROPIC_ENDPOINT, model: MODEL, apiKey: KEY, protocol: 'anthropic' });
      assert.equal(saved.ok, true);
      assert.equal(saved.ai.protocol, 'anthropic');
      assert.equal(h.database.settings.get('ai_protocol'), 'anthropic');

      h.setDatabase(anthropicDatabase());
      const omitted = h.saveAi({ endpoint: ANTHROPIC_ENDPOINT, model: 'next-model' });
      assert.equal(omitted.ok, true);
      assert.equal(omitted.ai.protocol, 'anthropic');
      assert.equal(h.database.settings.get('ai_protocol'), 'anthropic');
      assert.equal(h.database.settings.get('ai_model'), 'next-model');

      h.setDatabase(createFakeDatabase());
      const first = h.saveAi({ endpoint: MOCK_ENDPOINT, model: MODEL, apiKey: KEY });
      assert.equal(first.ok, true);
      assert.equal(first.ai.protocol, 'openai');
      assert.equal(h.database.settings.get('ai_protocol'), 'openai');

      h.setDatabase(anthropicDatabase());
      const switched = h.saveAi({ endpoint: MOCK_ENDPOINT, model: MODEL, protocol: 'openai' });
      assert.equal(switched.ok, true);
      assert.equal(switched.ai.protocol, 'openai');
      assert.equal(h.database.settings.get('ai_protocol'), 'openai');

      const db = anthropicDatabase();
      h.setDatabase(db);
      const before = settingsSnapshot(db);
      for (const protocol of [null, 123, {}, [], '', 'OPENAI', ' anthropic ', 'foo']) {
        const result = h.saveAi({ endpoint: MOCK_ENDPOINT, model: 'next-model', apiKey: 'next-key-12345678', protocol });
        assert.equal(result.ok, false, `${String(protocol)} 应被拒绝`);
        assert.equal(result.message, SET_AI_INVALID_PROTOCOL);
      }
      assert.deepEqual(settingsSnapshot(db), before);

      const invalidEndpoint = h.saveAi({ endpoint: 'ftp://x', model: MODEL, protocol: 'foo' });
      assert.equal(invalidEndpoint.ok, false);
      assert.equal(invalidEndpoint.message, SET_AI_INVALID_ENDPOINT);

      const broken = configuredDatabase();
      broken.state.failPrepare = true;
      h.setDatabase(broken);
      const failure = h.saveAi({ endpoint: MOCK_ENDPOINT, model: MODEL, apiKey: KEY });
      assert.equal(failure.ok, false);
      assert.equal(failure.message, SET_AI_SAVE_FAILED);
    });

    test('F29.4 callChatCompletion（openai）回归：请求头/体保持不变', async () => {
      const messages = [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'user' }
      ];
      for (const protocol of ['openai', undefined, 'foo']) {
        h.fetchCalls.length = 0;
        h.setFetch(() => Promise.resolve(httpResponse({ status: 200, body: '{"ok":true}' })));
        const chat = await h.fn('callChatCompletion')({
          endpoint: MOCK_ENDPOINT,
          apiKey: KEY,
          model: MODEL,
          messages,
          timeoutMs: 500,
          protocol
        });
        assert.deepEqual(plain(chat), { status: 200, ok: true, text: '{"ok":true}' });
        const request = h.fetchCalls[0];
        assert.equal(request.url, MOCK_ENDPOINT);
        assert.equal(request.init.method, 'POST');
        assert.deepEqual(Object.keys(request.init.headers).sort(), ['Accept', 'Authorization', 'Content-Type']);
        assert.equal(request.init.headers.Authorization, `Bearer ${KEY}`);
        const body = JSON.parse(request.init.body);
        assert.deepEqual(Object.keys(body).sort(), ['messages', 'model', 'temperature']);
        assert.deepEqual(body.messages, messages);
        assert.equal(body.system, undefined);
        assert.equal(body.max_tokens, undefined);
      }
    });

    test('F29.5 callChatCompletion（anthropic）请求契约', async () => {
      h.setFetch(() => Promise.resolve(anthropicEnvelope('ok')));
      const messages = [
        { role: 'system', content: 'A' },
        { role: 'system', content: 'B' },
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u2' }
      ];
      const chat = await h.fn('callChatCompletion')({
        endpoint: ANTHROPIC_ENDPOINT,
        apiKey: KEY,
        model: MODEL,
        messages,
        timeoutMs: 500,
        protocol: 'anthropic'
      });
      assert.equal(chat.status, 200);

      const request = h.fetchCalls[0];
      assert.equal(request.url, ANTHROPIC_ENDPOINT);
      assert.equal(request.init.method, 'POST');
      assert.deepEqual(Object.keys(request.init.headers).sort(), ['anthropic-version', 'content-type', 'x-api-key']);
      assert.equal(request.init.headers['anthropic-version'], ANTHROPIC_VERSION);
      assert.equal(request.init.headers['content-type'], 'application/json');
      assert.equal(request.init.headers['x-api-key'], KEY);
      assert.equal(request.init.headers.Authorization, undefined);
      assert.equal(request.init.headers.Accept, undefined);

      const body = JSON.parse(request.init.body);
      assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model', 'system', 'temperature']);
      assert.equal(body.model, MODEL);
      assert.equal(body.max_tokens, ANTHROPIC_MAX_TOKENS);
      assert.equal(body.temperature, 0);
      assert.equal(body.system, 'A\n\nB');
      assert.deepEqual(body.messages, [
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u2' }
      ]);
      assert.ok(request.init.signal);
      assert.equal(request.init.signal.aborted, false);

      h.fetchCalls.length = 0;
      await h.fn('callChatCompletion')({
        endpoint: ANTHROPIC_ENDPOINT,
        apiKey: KEY,
        model: MODEL,
        messages: [{ role: 'user', content: 'hi' }],
        timeoutMs: 500,
        protocol: 'anthropic'
      });
      const noSystem = JSON.parse(h.fetchCalls[0].init.body);
      assert.deepEqual(Object.keys(noSystem).sort(), ['max_tokens', 'messages', 'model', 'temperature']);

      h.fetchCalls.length = 0;
      await h.fn('callChatCompletion')({
        endpoint: ANTHROPIC_ENDPOINT,
        apiKey: KEY,
        model: MODEL,
        messages: [{ role: 'system', content: '' }, { role: 'user', content: 'hi' }],
        timeoutMs: 500,
        protocol: 'anthropic'
      });
      assert.equal(JSON.parse(h.fetchCalls[0].init.body).system, '');

      h.setFetch(() => Promise.resolve(anthropicEnvelope('error body', { status: 500 })));
      const failed = await h.fn('callChatCompletion')({
        endpoint: ANTHROPIC_ENDPOINT,
        apiKey: KEY,
        model: MODEL,
        messages: [{ role: 'user', content: 'hi' }],
        timeoutMs: 500,
        protocol: 'anthropic'
      });
      assert.equal(failed.status, 500);
      assert.equal(failed.ok, false);

      h.setFetch(() => Promise.reject(Object.assign(new Error('net::ERR_CONNECTION_REFUSED'), { code: 'ERR_CONNECTION_REFUSED' })));
      const network = await captureRejection(h.fn('callChatCompletion')({
        endpoint: ANTHROPIC_ENDPOINT,
        apiKey: KEY,
        model: MODEL,
        messages: [],
        timeoutMs: 500,
        protocol: 'anthropic'
      }));
      assert.equal(network.code, 'network');
      assert.equal(network.message, NETWORK_MESSAGE);
      assert.equal(network.retryable, true);

      h.setFetch(() => new Promise(() => {}));
      const timeout = await captureRejection(h.fn('callChatCompletion')({
        endpoint: ANTHROPIC_ENDPOINT,
        apiKey: KEY,
        model: MODEL,
        messages: [],
        timeoutMs: 40,
        protocol: 'anthropic'
      }));
      assert.equal(timeout.code, 'timeout');
      assert.equal(timeout.message, TIMEOUT_MESSAGE);
      assert.equal(timeout.retryable, true);
    });

    test('F29.6 readChatText / readAssistantPayload（anthropic）解析', () => {
      const read = h.fn('readChatText');
      const mixed = anthropicBody([
        { type: 'text', text: '{"intent":' },
        { type: 'image', source: { type: 'base64' } },
        { type: 'text', text: '"create"}' },
        { type: 'text', text: 123 }
      ]);
      assert.equal(read({ status: 200, ok: true, text: mixed }, 'anthropic'), '{"intent":"create"}');

      const raw = anthropicBody([
        { type: 'text', text: '  {"a":' },
        { type: 'text', text: '1}  ' }
      ]);
      assert.equal(read({ status: 200, ok: true, text: raw }, 'anthropic'), '  {"a":1}  ');

      const truncated = captureFailure(() => read(
        { status: 200, ok: true, text: anthropicBody([{ type: 'text', text: 'partial' }], { stopReason: 'max_tokens' }) },
        'anthropic'
      ));
      assert.equal(truncated.code, 'invalid_response');
      assert.equal(truncated.retryable, true);

      for (const content of [[], [{ type: 'text', text: '' }], [{ type: 'text', text: '   ' }], [{ type: 'image' }]]) {
        const empty = captureFailure(() => read({ status: 200, ok: true, text: anthropicBody(content) }, 'anthropic'));
        assert.equal(empty.code, 'empty_response', `${JSON.stringify(content)} 应视为空响应`);
        assert.equal(empty.message, EMPTY_RESPONSE_MESSAGE);
        assert.equal(empty.retryable, true);
      }

      for (const [status, code] of [[401, 'http_401'], [429, 'http_429'], [500, 'http_5xx'], [418, 'http_other']]) {
        const failure = captureFailure(() => read({ status, ok: false, text: '' }, 'anthropic'));
        assert.equal(failure.code, code, `HTTP ${status} 映射不正确`);
      }

      for (const text of ['not json', '{}', '{"content":null}', '{"content":"text"}', '{"content":{}}']) {
        const invalid = captureFailure(() => read({ status: 200, ok: true, text }, 'anthropic'));
        assert.equal(invalid.code, 'invalid_response', `${text} 应解析失败`);
      }

      assert.equal(read({ status: 200, ok: true, text: anthropicBody([{ type: 'text', text: 'ok' }]) }, 'anthropic'), 'ok');
      assert.equal(read({ status: 200, ok: true, text: JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }) }, 'anthropic'), 'ok');
      assert.equal(read({ status: 200, ok: true, text: JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }) }, 'anthropic'), 'ok');

      assert.deepEqual(
        plain(h.fn('readAssistantPayload')({ status: 200, ok: true, text: anthropicBody('```json\n{"intent":"create"}\n```') }, 'anthropic')),
        { intent: 'create' }
      );
      const extractFailure = captureFailure(() => h.fn('readAssistantPayload')({ status: 200, ok: true, text: anthropicBody('no json here') }, 'anthropic'));
      assert.equal(extractFailure.code, 'invalid_response');
    });

    test('F29.7 assistant:parse（anthropic）端到端：请求、查询与失败映射', async () => {
      const createPayload = {
        intent: 'create',
        message: '已整理候选',
        create: {
          candidates: [{ title: '新事项', kind: 'assignment', deadline: `${localDate(5)} 23:59`, status: 'not_started' }]
        }
      };

      h.setDatabase(anthropicDatabase());
      h.setFetch(() => Promise.resolve(anthropicEnvelope(JSON.stringify(createPayload))));
      const created = await h.parse('新增一个事项');
      assert.equal(created.ok, true);
      assert.equal(created.intent, 'create');
      assert.equal(created.create.candidates.length, 1);
      const createBody = JSON.parse(h.fetchCalls[0].init.body);
      assert.equal(createBody.system, h.fn('buildAssistantSystemPrompt')());
      assert.deepEqual(createBody.messages.map(message => message.role), ['user']);
      assert.equal(createBody.max_tokens, ANTHROPIC_MAX_TOKENS);
      assert.equal(h.fetchCalls[0].init.headers.Authorization, undefined);

      const queryItems = [
        { id: 1, title: '本月已完成大作业', kind: 'assignment', deadline: monthDate(0, 5, '09:00'), status: 'completed', work_type: 'personal' },
        { id: 2, title: '本月未完成活动', kind: 'activity', deadline: monthDate(0, 20, '18:00'), status: 'not_completed', work_type: null }
      ];
      h.fetchCalls.length = 0;
      h.setDatabase(createFakeDatabase({
        settings: { ai_endpoint: ANTHROPIC_ENDPOINT, ai_model: MODEL, ai_api_key: KEY, ai_protocol: 'anthropic' },
        items: queryItems
      }));
      h.setFetch((_url, init) => {
        const body = JSON.parse(init.body);
        const first = JSON.parse(body.messages[0].content);
        if ('question' in first) return Promise.resolve(anthropicEnvelope('按截止时间在本月内：已完成 1 个。'));
        return Promise.resolve(anthropicEnvelope(JSON.stringify({
          intent: 'query',
          query: { range: { type: 'this_month' }, kind: 'all', status: 'completed', shape: 'count' }
        })));
      });
      const queried = await h.parse('查询本月已完成的事项');
      assert.equal(queried.ok, true);
      assert.equal(queried.intent, 'query');
      assert.equal(queried.query.answer, '按截止时间在本月内：已完成 1 个。');
      assert.equal(queried.query.fallback, false);
      assert.equal(h.fetchCalls.length, 2);
      for (const call of h.fetchCalls) {
        const body = JSON.parse(call.init.body);
        assert.equal(call.init.headers.Authorization, undefined);
        assert.equal(body.max_tokens, ANTHROPIC_MAX_TOKENS);
        assert.equal(typeof body.system, 'string');
        assert.ok(body.messages.every(message => message.role !== 'system'));
      }

      h.fetchCalls.length = 0;
      h.setFetch((_url, init) => {
        const body = JSON.parse(init.body);
        const first = JSON.parse(body.messages[0].content);
        if ('question' in first) {
          return Promise.resolve(anthropicEnvelope([{ type: 'text', text: 'partial' }], { stopReason: 'max_tokens' }));
        }
        return Promise.resolve(anthropicEnvelope(JSON.stringify({
          intent: 'query',
          query: { range: { type: 'this_month' }, status: 'completed', shape: 'count' }
        })));
      });
      const degraded = await h.parse('查本月完成情况');
      assert.equal(degraded.ok, true);
      assert.equal(degraded.query.fallback, true);
      assert.equal(h.fetchCalls.length, 2);

      const db = anthropicDatabase();
      h.setDatabase(db);
      const settingsBefore = JSON.stringify(settingsSnapshot(db));
      const itemsBefore = h.itemsSnapshot();
      const scenarios = [
        [() => Promise.resolve(anthropicEnvelope([{ type: 'text', text: 'partial' }], { stopReason: 'max_tokens' })), 'invalid_response', true],
        [() => Promise.resolve(anthropicEnvelope([])), 'empty_response', true],
        [() => Promise.resolve(httpResponse({ status: 401, body: '{"error":{"message":"secret"}}' })), 'http_401', false],
        [() => Promise.reject(Object.assign(new Error('net::ERR_CONNECTION_REFUSED'), { code: 'ERR_CONNECTION_REFUSED' })), 'network', true]
      ];
      for (const [fetchImpl, code, retryable] of scenarios) {
        h.setFetch(fetchImpl);
        const result = await h.parse('新建事项');
        assert.equal(result.ok, false, `${code} 应失败`);
        assert.equal(result.code, code);
        assert.equal(result.retryable, retryable);
      }
      assert.equal(JSON.stringify(settingsSnapshot(db)), settingsBefore);
      assert.equal(h.itemsSnapshot(), itemsBefore);
    });

    test('F29.8 备份 / 恢复协议口径', async () => {
      await withRealDatabase(async host => {
        const { realDb, dataDir } = host;
        h.fn('setSetting')('ai_endpoint', ANTHROPIC_ENDPOINT);
        h.fn('setSetting')('ai_model', MODEL);
        h.fn('setSetting')('ai_api_key', KEY);
        h.fn('setSetting')('ai_protocol', 'anthropic');
        seedLocalDatabase(host);
        realDb.persist();

        const localConfig = plain(h.fn('readAiConfig')());
        const backupPath = path.join(dataDir, 'backup.zip');
        const zipDir = path.join(dataDir, 'unzipped');
        await h.fn('createBackupArchive')(backupPath);
        fs.mkdirSync(zipDir, { recursive: true });
        await extract(backupPath, { dir: zipDir });

        const settings = await readSettingsFile(path.join(zipDir, 'deadline-desk.db'));
        assert.equal(settings.ai_protocol, 'anthropic');
        assert.equal(settings.ai_api_key, undefined);
        assert.equal(fs.readFileSync(path.join(zipDir, 'deadline-desk.db')).includes(Buffer.from(KEY)), false, '备份数据库不应包含 Key 字节');
        assert.deepEqual(plain(h.fn('readAiConfig')()), localConfig, '导出不应改动本机 AI 配置');
      });

      await withRealDatabase(async host => {
        const { dataDir } = host;
        h.fn('setSetting')('ai_api_key', KEY);
        seedLocalDatabase(host);

        const fixtureZip = path.join(dataDir, 'fixture.zip');
        await createBackupFixture(fixtureZip, {
          endpoint: BACKUP_ENDPOINT,
          model: BACKUP_MODEL,
          apiKey: BACKUP_KEY,
          protocol: 'anthropic',
          title: '备份事项'
        });
        await h.fn('restoreBackupArchive')(fixtureZip);

        assert.deepEqual(plain(h.fn('readAiConfig')()), {
          protocol: 'anthropic',
          endpoint: BACKUP_ENDPOINT,
          model: BACKUP_MODEL,
          apiKey: KEY
        });
        const view = plain(h.fn('buildAiSettingsView')());
        assert.equal(view.configured, true);
        assert.equal(view.protocol, 'anthropic');
        const dbFile = h.fn('getPaths')().database;
        assert.equal(fs.readFileSync(dbFile).includes(Buffer.from(BACKUP_KEY)), false, '备份 Key 不应落盘');

        const legacyZip = path.join(dataDir, 'legacy.zip');
        await createBackupFixture(legacyZip, {
          endpoint: BACKUP_ENDPOINT,
          model: BACKUP_MODEL,
          apiKey: BACKUP_KEY,
          title: '旧备份事项'
        });
        await h.fn('restoreBackupArchive')(legacyZip);
        assert.equal(plain(h.fn('readAiConfig')()).protocol, 'openai');
      });
    });

    test('F29.9 callChatCompletion（anthropic）：system 收集边界与 messages 字段裁剪', async () => {
      h.setFetch(() => Promise.resolve(anthropicEnvelope('ok')));
      await h.fn('callChatCompletion')({
        endpoint: ANTHROPIC_ENDPOINT,
        apiKey: KEY,
        model: MODEL,
        messages: [
          { role: 'system', content: { unexpected: true } },
          { role: 'system', content: 'S1' },
          { role: 'user', content: 'hi', extra: 'drop-me' }
        ],
        timeoutMs: 500,
        protocol: 'anthropic'
      });
      const body = JSON.parse(h.fetchCalls[0].init.body);
      assert.equal(body.system, 'S1', '非字符串 content 的 system 项不进入收集');
      assert.deepEqual(body.messages, [{ role: 'user', content: 'hi' }], 'messages 元素仅复制 role/content');

      h.fetchCalls.length = 0;
      await h.fn('callChatCompletion')({
        endpoint: ANTHROPIC_ENDPOINT,
        apiKey: KEY,
        model: MODEL,
        messages: [{ role: 'system', content: { unexpected: true } }, { role: 'user', content: 'hi' }],
        timeoutMs: 500,
        protocol: 'anthropic'
      });
      const noValidSystem = JSON.parse(h.fetchCalls[0].init.body);
      assert.deepEqual(Object.keys(noValidSystem).sort(), ['max_tokens', 'messages', 'model', 'temperature']);
    });

    test('F29.10 readChatText：截断先于空文本判定，缺省/非法协议按 openai', () => {
      const read = h.fn('readChatText');
      const truncatedEmpty = captureFailure(() => read(
        { status: 200, ok: true, text: anthropicBody([], { stopReason: 'max_tokens' }) },
        'anthropic'
      ));
      assert.equal(truncatedEmpty.code, 'invalid_response');
      assert.equal(truncatedEmpty.retryable, true);

      const byDefault = captureFailure(() => read({ status: 200, ok: true, text: anthropicBody('hello') }));
      assert.equal(byDefault.code, 'invalid_response');
      const byInvalid = captureFailure(() => read({ status: 200, ok: true, text: anthropicBody('hello') }, 'foo'));
      assert.equal(byInvalid.code, 'invalid_response');
    });
  });

  // ============ F22 需求文档 v1.15（v1.16 接口协议已并入） ============

  describe('F22 需求文档 v1.15', () => {
    const doc = fs.readFileSync(path.join(projectDir, 'docs/需求文档.md'), 'utf8');

    test('F22.1 版本行：助手 v1.15 已并入当前 v1.16', () => {
      assert.ok(doc.split(/\r?\n/)[0].includes('# 「截止线」· 需求文档（v1.16'), '标题应升级到 v1.16');
      assert.ok(doc.includes('更新日期：2026-11-08（v1.16'), '更新日期应写明 v1.16');
      assert.ok(doc.includes('v1.15：新增「助手」页'), '更新日期应保留 v1.15 助手说明');
    });

    test('F22.2 模块 7、导航与离线表述', () => {
      assert.ok(doc.includes('### 模块 7：助手'), '应包含模块 7 助手');
      // v2.0 起导航改为侧边栏 + 工作台标签栏双层结构，助手位于标签栏末尾
      assert.ok(doc.includes('侧边栏（4 项）：工作台 / 日记 / 统计 / 设置'), '侧边栏应说明 4 项');
      assert.ok(doc.includes('工作台标签栏（5 项，仅工作台页显示）：今天 / 大作业 / 活动 / 已逾期 / 助手'), '标签栏应包含助手');
      assert.ok(doc.includes('「助手」页需要联网调用用户自行配置的在线模型'), '离线表述应说明助手页需联网');
    });

    test('F22.3 确认清单与模块边界', () => {
      assert.ok(doc.includes('| 24 | 助手模块（v1.15）'), '确认清单应包含第 24 条');
      assert.ok(doc.includes('仅新增「助手」1 个模块'), '模块边界应写明仅新增助手 1 个模块');
    });
  });
});
