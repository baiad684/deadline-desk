const { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, net, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const archiver = require('archiver');
const extract = require('extract-zip');
const initSqlJs = require('sql.js');

// 探针隔离：指定数据目录时同步接管 userData（localStorage 与单实例锁随数据目录走），正式运行不受影响
if (process.env.DEADLINE_DESK_DATA_DIR) {
  app.setPath('userData', path.join(process.env.DEADLINE_DESK_DATA_DIR, 'user-data'));
}

let mainWindow;
let mainReady = false;
let pendingOpenItemId = null;
let widgetWindow;
let tray;
let database;
let SQL;
let quitting = false;
let notificationTimer;

const APP_NAME = '截止线';

const AI_SETTING_KEYS = { endpoint: 'ai_endpoint', model: 'ai_model', apiKey: 'ai_api_key' };
const AI_INPUT_MAX_LENGTH = 3000;
const AI_SUMMARY_LIMIT = 100;
const AI_MODEL_MAX_LENGTH = 200;
const AI_KEY_MAX_LENGTH = 4096;
const AI_DEFAULT_TIMEOUT_MS = 60000;
const AI_TIMEOUT_SENTINEL = Object.freeze({ assistantTimeout: true });
const AI_INTENT_LABELS = { create: '新增', update: '修改', delete: '删除', cleanup: '清理已完成', query: '查询' };
const AI_ALLOWED_INTENTS = ['create', 'update', 'delete', 'cleanup', 'query', 'unsupported'];
const WEEKDAY_FULL = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const WEEKDAY_SHORT = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const AI_QUERY_KIND_LABELS = { assignment: '大作业', activity: '活动', all: '全部类型' };
const AI_QUERY_STATUS_LABELS = { pending: '未完成', completed: '已完成', all: '全部状态' };
const AI_ERROR_TABLE = {
  not_configured: { message: '尚未完成 AI 配置，请到设置页填写接口地址、API Key 与模型名', retryable: false },
  invalid_input: { message: '请输入要处理的内容', retryable: false },
  invalid_endpoint: { message: '接口地址格式不正确，请在设置页填写完整的 http/https 地址', retryable: false },
  http_400: { message: '接口地址或模型名不正确，或请求被服务端拒绝（400）', retryable: false },
  http_401: { message: 'API Key 无效或没有访问权限（401/403）', retryable: false },
  http_403: { message: 'API Key 无效或没有访问权限（401/403）', retryable: false },
  http_404: { message: '接口地址或模型名不存在（404）', retryable: false },
  http_429: { message: '请求过于频繁，请稍后再试（429）', retryable: true },
  http_5xx: { message: '模型服务暂时不可用（5xx），请稍后重试', retryable: true },
  network: { message: '无法连接模型服务，请检查网络、接口地址或系统代理', retryable: true },
  timeout: { message: '请求超时（60 秒），请重试', retryable: true },
  empty_response: { message: '模型没有返回内容，请重试', retryable: true },
  invalid_response: { message: '模型返回内容无法解析，请重试；若持续失败，请确认接口与模型支持 Chat Completions', retryable: true },
  forbidden: { message: '当前窗口无权执行该操作', retryable: false },
  unknown: { message: '处理失败，请重试', retryable: true }
};

const AI_ASSIGNMENT_STATUSES = ['not_started', 'in_progress', 'completed'];
const AI_ACTIVITY_STATUSES = ['not_completed', 'completed'];
const AI_STATUS_BY_KIND = { assignment: AI_ASSIGNMENT_STATUSES, activity: AI_ACTIVITY_STATUSES };
const AI_DEFAULT_STATUS_BY_KIND = { assignment: 'not_started', activity: 'not_completed' };
const AI_DUPLICATE_TIME_WINDOW_MS = 60 * 60 * 1000;
const AI_DUPLICATE_DICE_THRESHOLD = 0.75;
const AI_CREATE_EMPTY_MESSAGE = '没有识别到可新增的事项。';
const AI_UPDATE_NO_MATCH_MESSAGE = '没有找到匹配的事项。';
const AI_UPDATE_KIND_MESSAGE = '助手不能修改事项类型，请到对应列表的编辑表单操作。';
const AI_UPDATE_NO_CHANGES_MESSAGE = '请说明要修改的内容。';
const AI_DELETE_NO_MATCH_MESSAGE = '没有找到匹配的事项。';
const AI_CLEANUP_NO_RANGE_MESSAGE = '请补充清理范围（例如上个月、本月、今年、某个具体月份或全部已完成）。';
const AI_CLEANUP_EMPTY_MESSAGE = '没有符合条件的已完成事项。';
const AI_NOTE_MISSING_IDS = '未找到事项 id：';
const AI_NOTE_OUT_OF_RANGE_IDS = '超出本次可操作范围的事项 id：';
const AI_CREATE_IGNORED_REASONS = { kind: '事项类型无效', title: '缺少明确标题', shape: '候选格式无效' };

function getPaths() {
  const root = process.env.DEADLINE_DESK_DATA_DIR || app.getPath('userData');
  return {
    root,
    database: path.join(root, 'deadline-desk.db'),
    attachments: path.join(root, 'attachments')
  };
}

const PERSIST_DEBOUNCE_MS = 300;

class SqliteAdapter {
  constructor(sqliteDatabase, filePath) {
    this.sqlite = sqliteDatabase;
    this.filePath = filePath;
    this.open = true;
    this.persistTimer = null;
  }

  exec(sql) {
    this.sqlite.exec(sql);
    this.schedulePersist();
  }

  prepare(sql) {
    const adapter = this;
    return {
      run(...parameters) {
        const normalized = normalizeParameters(parameters);
        adapter.sqlite.run(sql, normalized);
        const result = adapter.sqlite.exec('SELECT last_insert_rowid() AS id, changes() AS changes');
        adapter.schedulePersist();
        return {
          lastInsertRowid: result[0]?.values[0]?.[0] || 0,
          changes: result[0]?.values[0]?.[1] || 0
        };
      },
      get(...parameters) {
        const rows = queryRows(adapter.sqlite, sql, normalizeParameters(parameters));
        return rows[0];
      },
      all(...parameters) {
        return queryRows(adapter.sqlite, sql, normalizeParameters(parameters));
      }
    };
  }

  schedulePersist() {
    if (!this.open || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, PERSIST_DEBOUNCE_MS);
  }

  persist() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (!this.open) return;
    fs.writeFileSync(this.filePath, Buffer.from(this.sqlite.export()));
  }

  close() {
    if (!this.open) return;
    this.persist();
    this.sqlite.close();
    this.open = false;
  }
}

function normalizeParameters(parameters) {
  if (parameters.length === 1 && parameters[0] && typeof parameters[0] === 'object' && !Array.isArray(parameters[0])) {
    return Object.fromEntries(Object.entries(parameters[0]).map(([key, value]) => [`@${key}`, value]));
  }
  return parameters;
}

function queryRows(sqliteDatabase, sql, parameters = []) {
  const statement = sqliteDatabase.prepare(sql);
  try {
    statement.bind(parameters);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally {
    statement.free();
  }
}

async function initializeDatabase() {
  const paths = getPaths();
  fs.mkdirSync(paths.attachments, { recursive: true });
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: file => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
    });
  }
  const data = fs.existsSync(paths.database) ? fs.readFileSync(paths.database) : undefined;
  const sqliteDatabase = data?.length ? new SQL.Database(data) : new SQL.Database();
  database = new SqliteAdapter(sqliteDatabase, paths.database);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('assignment', 'activity')),
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      deadline TEXT NOT NULL,
      status TEXT NOT NULL,
      work_type TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_log (
      item_id INTEGER NOT NULL,
      notification_date TEXT NOT NULL,
      PRIMARY KEY (item_id, notification_date),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS diary_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_date TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS habit_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS habit_checkins (
      task_id INTEGER NOT NULL REFERENCES habit_tasks(id) ON DELETE CASCADE,
      checkin_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (task_id, checkin_date)
    );
  `);
  // v1.1：截止时间升级为分钟精度，老数据统一补成当天 23:59（幂等，每次启动都执行）
  database.exec("UPDATE items SET deadline = deadline || ' 23:59' WHERE LENGTH(deadline) = 10");
  database.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('notifications_enabled', 'true');
}

function createWindow() {
  const appIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
  mainWindow = new BrowserWindow({
    width: 1260,
    height: 820,
    minWidth: 920,
    minHeight: 620,
    show: false,
    backgroundColor: '#f4f6f5',
    autoHideMenuBar: true,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainReady = false;
  // 主窗口当前只创建一次；若未来支持重建，丢弃旧窗口遗留的待投递请求
  pendingOpenItemId = null;
  mainWindow.webContents.on('did-start-loading', () => { mainReady = false; });
  mainWindow.webContents.on('did-finish-load', () => {
    mainReady = true;
    if (pendingOpenItemId != null && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('items:open-request', pendingOpenItemId);
      pendingOpenItemId = null;
    }
  });
  // 加载失败不重试，也不把旧请求留到下一次重载
  mainWindow.webContents.on('did-fail-load', () => { pendingOpenItemId = null; });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', event => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

const WIDGET_WIDTH = 316;
const WIDGET_HEIGHT = 244;

function getSetting(key) {
  return database.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
}

function setSetting(key, value) {
  database.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function isWidgetEnabled() {
  return getSetting('widget_enabled') !== 'false';
}

function isWidgetPinned() {
  return getSetting('widget_pinned') === 'true';
}

function defaultWidgetPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + workArea.width - WIDGET_WIDTH - 32, y: workArea.y + workArea.height - WIDGET_HEIGHT - 32 };
}

function restoreWidgetBounds() {
  try {
    const saved = JSON.parse(getSetting('widget_bounds') || 'null');
    if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return defaultWidgetPosition();
    const visible = screen.getAllDisplays().some(display => {
      const area = display.workArea;
      return saved.x >= area.x - WIDGET_WIDTH + 80 && saved.x < area.x + area.width - 80
        && saved.y >= area.y - WIDGET_HEIGHT + 40 && saved.y < area.y + area.height - 40;
    });
    return visible ? { x: saved.x, y: saved.y } : defaultWidgetPosition();
  } catch {
    return defaultWidgetPosition();
  }
}

function saveWidgetBounds() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  setSetting('widget_bounds', JSON.stringify(widgetWindow.getBounds()));
}

function scheduleSaveWidgetBounds() {
  clearTimeout(scheduleSaveWidgetBounds.timer);
  scheduleSaveWidgetBounds.timer = setTimeout(saveWidgetBounds, 400);
}

function createWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.show();
    return widgetWindow;
  }
  const snapshot = buildWidgetSnapshot();
  // 初始高度按默认截止视图估算：页头 + tab 栏 + 列表（每行 44），空态取固定值；
  // 上次停在打卡 tab 时的首帧偏差由 widget:resize 的自然高上报在校正
  const listHeight = snapshot.count ? 44 * Math.min(snapshot.count, 4) : 120;
  const initialHeight = Math.max(140, Math.min(300, 88 + listHeight));
  widgetWindow = new BrowserWindow({
    width: WIDGET_WIDTH,
    height: initialHeight,
    ...restoreWidgetBounds(),
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: isWidgetPinned(),
    skipTaskbar: true,
    fullscreenable: false,
    maximizable: false,
    icon: nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  widgetWindow.loadFile(path.join(__dirname, 'src', 'widget.html'));
  widgetWindow.once('ready-to-show', () => { if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.show(); });
  widgetWindow.on('moved', scheduleSaveWidgetBounds);
  widgetWindow.on('close', saveWidgetBounds);
  widgetWindow.on('closed', () => { widgetWindow = null; endWidgetDragSession(false); });
  return widgetWindow;
}

function toggleWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.close();
  else createWidgetWindow();
}

function buildWidgetSnapshot() {
  const items = database.prepare("SELECT id, kind, title, deadline FROM items WHERE status != 'completed'").all()
    .map(item => ({ ...item, days: daysFromToday(item.deadline) }))
    .filter(item => item.days <= 7)
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  const habits = listHabitTasks()
    .filter(task => !task.archived_at)
    .map(task => ({ id: task.id, title: task.title, streak: task.streak, done: task.checked_today }));
  // 全量下发，列表区内部滚动容纳（窗口高度仍受 widget:resize 上限约束）
  return { count: items.length, items, habits, pinned: isWidgetPinned() };
}

function notifyWidgets() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  widgetWindow.webContents.send('widget:data', buildWidgetSnapshot());
}

function createTray() {
  const trayImage = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-32.png')).resize({ width: 16, height: 16 });
  tray = new Tray(trayImage);
  tray.setImage(trayImage);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开截止线', click: showMainWindow },
    { label: '显示 / 隐藏桌面小组件', click: toggleWidgetWindow },
    { type: 'separator' },
    { label: '彻底退出', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('double-click', showMainWindow);
}

function showMainWindow() {
  if (!mainWindow) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function ensureText(value, label, maxLength = 5000) {
  if (typeof value !== 'string') throw new Error(`${label}格式不正确`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`请填写${label}`);
  if (trimmed.length > maxLength) throw new Error(`${label}内容过长`);
  return trimmed;
}

function validateDeadline(value) {
  if (typeof value !== 'string') throw new Error('截止时间格式不正确');
  const match = value.replace('T', ' ').match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/);
  if (!match) throw new Error('截止时间格式不正确');
  const [, year, month, day, hour = '23', minute = '59'] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) throw new Error('截止时间无效');
  if (Number(hour) > 23 || Number(minute) > 59) throw new Error('截止时间无效');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

// 复用截止时间的正则与真实日历校验（拒绝 2026-02-31 这类日期）
function validateDiaryDate(value) {
  try {
    return validateDeadline(value).slice(0, 10);
  } catch {
    throw new Error('日记日期无效');
  }
}

function validateItem(input) {
  const kind = input?.kind;
  if (!['assignment', 'activity'].includes(kind)) throw new Error('事项类型无效');
  const title = ensureText(input.title, kind === 'assignment' ? '课程名称' : '活动名称', 120);
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 10000) : '';
  const deadline = validateDeadline(input.deadline);
  const validStatuses = kind === 'assignment' ? ['not_started', 'in_progress', 'completed'] : ['not_completed', 'completed'];
  const status = validStatuses.includes(input.status) ? input.status : validStatuses[0];
  const workType = kind === 'assignment' && ['personal', 'team'].includes(input.workType) ? input.workType : null;
  return { kind, title, description, deadline, status, workType };
}

function getItem(id) {
  const item = database.prepare('SELECT * FROM items WHERE id = ?').get(Number(id));
  if (!item) throw new Error('事项不存在');
  return item;
}

function listItems() {
  const items = database.prepare('SELECT * FROM items ORDER BY deadline ASC, created_at DESC').all();
  const attachmentStatement = database.prepare('SELECT id, item_id, original_name, mime_type, size, created_at FROM attachments WHERE item_id = ? ORDER BY created_at ASC');
  return items.map(item => ({ ...item, attachments: attachmentStatement.all(item.id) }));
}

// 手动拖动会话：app-region 的命中图会随窗口内任何滚动整体失效（Electron 28 / Chromium 120），
// 改由渲染进程上报指针位移、主进程按会话锁定的尺寸跟随窗口。
// 位移用渲染层上报的屏幕坐标（screenX/Y）差值计算——若用视口 clientX/Y，窗口移动会改变坐标系，形成正反馈抖动；
// 必须用定尺寸 setBounds 而非 setPosition——后者在缩放屏（如 125% DPI）上每次调用累积 +1 DIP，会把窗口越拖越大
let widgetDrag = null;
const WIDGET_DRAG_TIMEOUT_MS = 10 * 1000;

function endWidgetDragSession(save) {
  if (!widgetDrag) return;
  widgetDrag = null;
  // 程序化移动不触发 'moved' 事件（Windows 实测），落盘需显式触发
  if (save) scheduleSaveWidgetBounds();
}

function registerWidgetHandlers() {
  ipcMain.handle('widget:get', () => buildWidgetSnapshot());
  ipcMain.handle('widget:open-main', () => showMainWindow());
  ipcMain.handle('widget:open-item', (event, id) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    // 与 resize / set-pinned 同款来源校验：主窗口共用 preload，不能借用该通道
    if (!win || win.isDestroyed() || win !== widgetWindow) return false;
    const itemId = Number(id);
    if (!Number.isSafeInteger(itemId) || itemId <= 0) return false;
    showMainWindow();
    if (mainReady && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('items:open-request', itemId);
    } else {
      // 应用启动极短窗口内主窗口尚未加载完成：只保留最后一次请求
      pendingOpenItemId = itemId;
    }
    return true;
  });
  ipcMain.handle('widget:resize', (event, height) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    // 仅小组件窗口可用：主窗口与小组件共用 preload，防止主界面误调把主窗口改小
    if (!win || win.isDestroyed() || win !== widgetWindow) return false;
    // 拖动会话中窗口尺寸锁定，忽略高度上报，避免与拖动的 setBounds 竞争
    if (widgetDrag && widgetDrag.win === win) return true;
    const target = Math.max(140, Math.min(300, Math.round(Number(height) || WIDGET_HEIGHT)));
    const [, current] = win.getSize();
    if (Math.abs(current - target) < 2) return true;
    const [x, y] = win.getPosition();
    // 宽度用常量：getSize 回写在缩放屏上有慢漂移
    win.setBounds({ x, y, width: WIDGET_WIDTH, height: target });
    return true;
  });
  ipcMain.on('widget:drag-start', (event, screenX, screenY) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || win !== widgetWindow) return;
    widgetDrag = {
      win,
      originWinPos: win.getPosition(),
      originPointer: { x: Number(screenX) || 0, y: Number(screenY) || 0 },
      size: win.getSize(),
      expires: Date.now() + WIDGET_DRAG_TIMEOUT_MS
    };
  });
  ipcMain.on('widget:drag-move', (event, screenX, screenY) => {
    if (!widgetDrag) return;
    const { win, originWinPos, originPointer, size, expires } = widgetDrag;
    if (win.isDestroyed() || event.sender !== win.webContents) { endWidgetDragSession(false); return; }
    if (Date.now() > expires) { endWidgetDragSession(true); return; }
    // 会话超时只为兜底清理丢失 drag-end 的情况；持续收到 move 说明拖动还在进行，滚动续期避免慢拖脱钩
    widgetDrag.expires = Date.now() + WIDGET_DRAG_TIMEOUT_MS;
    const x = originWinPos[0] + Math.round((Number(screenX) || 0) - originPointer.x);
    const y = originWinPos[1] + Math.round((Number(screenY) || 0) - originPointer.y);
    win.setBounds({ x, y, width: size[0], height: size[1] });
  });
  ipcMain.on('widget:drag-end', event => {
    if (!widgetDrag || event.sender !== widgetDrag.win.webContents) return;
    endWidgetDragSession(true);
  });
  ipcMain.handle('widget:set-pinned', (event, pinned) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || win !== widgetWindow) return false;
    win.setAlwaysOnTop(Boolean(pinned));
    setSetting('widget_pinned', pinned ? 'true' : 'false');
    return Boolean(pinned);
  });
  ipcMain.handle('widget:toggle-checkin', (_event, id) => toggleCheckin(id, localDateString()));
}

function registerItemHandlers() {
  ipcMain.handle('items:list', () => listItems());

  ipcMain.handle('items:create', (_event, input) => {
    const item = validateItem(input);
    const result = database.prepare(`
      INSERT INTO items (kind, title, description, deadline, status, work_type)
      VALUES (@kind, @title, @description, @deadline, @status, @workType)
    `).run(item);
    checkNotifications();
    notifyWidgets();
    return getItem(result.lastInsertRowid);
  });

  ipcMain.handle('items:update', (_event, id, input) => {
    getItem(id);
    const item = validateItem(input);
    database.prepare(`
      UPDATE items SET kind = @kind, title = @title, description = @description,
        deadline = @deadline, status = @status, work_type = @workType,
        updated_at = CURRENT_TIMESTAMP WHERE id = @id
    `).run({ ...item, id: Number(id) });
    notifyWidgets();
    return getItem(id);
  });

  ipcMain.handle('items:status', (_event, id, status) => {
    const item = getItem(id);
    const valid = item.kind === 'assignment' ? ['not_started', 'in_progress', 'completed'] : ['not_completed', 'completed'];
    if (!valid.includes(status)) throw new Error('状态无效');
    database.prepare('UPDATE items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, Number(id));
    notifyWidgets();
    return getItem(id);
  });

  ipcMain.handle('items:delete', (_event, id) => {
    const item = getItem(id);
    const attachments = database.prepare('SELECT stored_name FROM attachments WHERE item_id = ?').all(item.id);
    database.prepare('DELETE FROM items WHERE id = ?').run(item.id);
    for (const attachment of attachments) {
      const filePath = path.join(getPaths().attachments, attachment.stored_name);
      try { fs.unlinkSync(filePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    notifyWidgets();
    return true;
  });
}

function registerAttachmentHandlers() {
  ipcMain.handle('attachments:add', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择附件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '支持的附件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'doc', 'docx', 'ppt', 'pptx'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (result.canceled) return [];
    return result.filePaths.map(filePath => ({ path: filePath, name: path.basename(filePath), size: fs.statSync(filePath).size }));
  });

  ipcMain.handle('attachments:save', (_event, itemId, selectedFiles) => {
    getItem(itemId);
    if (!Array.isArray(selectedFiles) || selectedFiles.length > 9) throw new Error('单次最多添加 9 个附件');
    const insert = database.prepare('INSERT INTO attachments (item_id, original_name, stored_name, mime_type, size) VALUES (?, ?, ?, ?, ?)');
    const paths = getPaths();
    const saved = [];
    for (const selected of selectedFiles) {
      if (!selected || typeof selected.path !== 'string') continue;
      const source = path.resolve(selected.path);
      const stat = fs.statSync(source);
      if (!stat.isFile() || stat.size > 50 * 1024 * 1024) throw new Error(`${path.basename(source)} 超过 50MB 或不是有效文件`);
      const extension = path.extname(source).toLowerCase();
      const storedName = `${crypto.randomUUID()}${extension}`;
      fs.copyFileSync(source, path.join(paths.attachments, storedName));
      const result = insert.run(Number(itemId), path.basename(source), storedName, '', stat.size);
      saved.push({ id: result.lastInsertRowid, name: path.basename(source) });
    }
    return saved;
  });

  ipcMain.handle('attachments:open', async (_event, attachmentId) => {
    const attachment = database.prepare('SELECT * FROM attachments WHERE id = ?').get(Number(attachmentId));
    if (!attachment) throw new Error('附件不存在');
    const error = await shell.openPath(path.join(getPaths().attachments, attachment.stored_name));
    if (error) throw new Error(error);
    return true;
  });

  ipcMain.handle('attachments:delete', (_event, attachmentId) => {
    const attachment = database.prepare('SELECT * FROM attachments WHERE id = ?').get(Number(attachmentId));
    if (!attachment) throw new Error('附件不存在');
    database.prepare('DELETE FROM attachments WHERE id = ?').run(attachment.id);
    try { fs.unlinkSync(path.join(getPaths().attachments, attachment.stored_name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return true;
  });
}

function registerDiaryHandlers() {
  ipcMain.handle('diary:get', (_event, date) => {
    const entryDate = validateDiaryDate(date);
    const entry = database.prepare('SELECT entry_date, content, created_at, updated_at FROM diary_entries WHERE entry_date = ?').get(entryDate);
    return entry || { entry_date: entryDate, content: '' };
  });

  ipcMain.handle('diary:save', (_event, date, content) => {
    const entryDate = validateDiaryDate(date);
    const text = typeof content === 'string' ? content.slice(0, 10000) : '';
    if (!text) {
      database.prepare('DELETE FROM diary_entries WHERE entry_date = ?').run(entryDate);
    } else {
      database.prepare(`
        INSERT INTO diary_entries (entry_date, content) VALUES (?, ?)
        ON CONFLICT(entry_date) DO UPDATE SET content = excluded.content, updated_at = CURRENT_TIMESTAMP
      `).run(entryDate, text);
    }
    return { entry_date: entryDate, content: text };
  });

  ipcMain.handle('diary:list-dates', () => database.prepare('SELECT entry_date FROM diary_entries ORDER BY entry_date DESC').all().map(row => row.entry_date));

  ipcMain.handle('diary:delete', (_event, date) => {
    const entryDate = validateDiaryDate(date);
    database.prepare('DELETE FROM diary_entries WHERE entry_date = ?').run(entryDate);
    return true;
  });
}

function getHabitTask(id) {
  const task = database.prepare('SELECT * FROM habit_tasks WHERE id = ?').get(Number(id));
  if (!task) throw new Error('任务不存在');
  return task;
}

// 打卡只允许今天及过去 6 天（最近 7 天），与前端点阵范围一致
function validateCheckinDate(value) {
  let dateValue;
  try {
    dateValue = validateDeadline(value).slice(0, 10);
  } catch {
    throw new Error('打卡日期无效');
  }
  const offset = daysFromToday(dateValue);
  if (offset > 0 || offset < -6) throw new Error('只能补打或撤销最近 7 天的打卡');
  return dateValue;
}

function listHabitTasks() {
  const tasks = database.prepare('SELECT * FROM habit_tasks ORDER BY archived_at IS NULL DESC, created_at ASC').all();
  const checked = new Set(
    database.prepare('SELECT task_id, checkin_date FROM habit_checkins').all().map(row => `${row.task_id}|${row.checkin_date}`)
  );
  const totalStatement = database.prepare('SELECT COUNT(*) AS total FROM habit_checkins WHERE task_id = ?');
  const today = localDateString();
  return tasks.map(task => {
    const last7 = [];
    for (let back = 6; back >= 0; back -= 1) {
      const cursor = new Date();
      cursor.setDate(cursor.getDate() - back);
      const dateValue = localDateString(cursor);
      last7.push({ date: dateValue, done: checked.has(`${task.id}|${dateValue}`) });
    }
    // 连击：今天已打卡则从今天往回数，否则从昨天往回数（今天没打不算断签）
    let streak = 0;
    const cursor = new Date();
    if (!checked.has(`${task.id}|${localDateString(cursor)}`)) cursor.setDate(cursor.getDate() - 1);
    while (checked.has(`${task.id}|${localDateString(cursor)}`)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return {
      id: task.id,
      title: task.title,
      note: task.note,
      archived_at: task.archived_at,
      created_at: task.created_at,
      last7,
      streak,
      total: totalStatement.get(task.id).total,
      checked_today: checked.has(`${task.id}|${today}`)
    };
  });
}

function broadcastHabitsChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('habits:changed');
}

function toggleCheckin(id, date) {
  const task = getHabitTask(id);
  if (task.archived_at) throw new Error('已归档的任务不能打卡');
  const dateValue = validateCheckinDate(date);
  const existing = database.prepare('SELECT 1 AS one FROM habit_checkins WHERE task_id = ? AND checkin_date = ?').get(Number(id), dateValue);
  if (existing) database.prepare('DELETE FROM habit_checkins WHERE task_id = ? AND checkin_date = ?').run(Number(id), dateValue);
  else database.prepare('INSERT INTO habit_checkins (task_id, checkin_date) VALUES (?, ?)').run(Number(id), dateValue);
  broadcastHabitsChanged();
  notifyWidgets();
  return { checked: !existing };
}

// 统计页月度打卡日历：逐日聚合「当天活跃任务中打卡了多少」。
// created_at/archived_at 是 UTC 串，转本地日再比较。
//
// ── 单日三档口径 ──
//   expected(D) 应打卡数 = 创建日 ≤ D < 归档日（未归档则无上界）的任务数——即「D 当天该任务在岗」
//   checked(D)  已打卡数 = D 当天在岗、且 D 有打卡记录的任务数
//                （habit_checkins 主键 (task_id, checkin_date) 保证同一天重复打卡只算一次）
//   level 0 未打卡    checked = 0
//   level 1 部分完成  0 < checked < expected（expected 必然 ≥ 2：只有一项任务时非 0 即满）
//   level 2 全部完成  checked = expected > 0
//   level null 无应打卡任务（含未来日期）：格子里性，不参与本月打卡率
//
// ── 本月打卡率 ──
//   rate = Σchecked / Σexpected，只累计 D ∈ [月初, min(今天, 月末)] 且 expected(D) > 0 的日子。
//   边界约定：
//   · 未来日期不进分母——还没到的日子不算欠账；
//   · 今天进分母：它是真实的应打卡义务（「到今天为止共欠多少」的口径），所以早晨看会比当晚略低，
//     随着当天打卡逐格收起而回升。备选方案「今天进分子就一并进分母」会导致「打了卡反而掉分」
//     （如 15/15 打 1 个变 16/18），已否决；备选方案「今天完全不计」则打卡后主指标纹丝不动，同样不可取；
//   · 创建日之前的补卡既不计分子也不计分母（任务还不存在的那天无从谈起），仅以 stray 标记
//     让界面能解释「这天为什么没上色」；
//   · 归档当天起不再计入应打卡（归档后 toggleCheckin 会拦死，算进分母等于派一个打不了的欠账），
//     当天的打卡记录同样跳过，保证 checked ≤ expected；恢复归档会抹掉归档区间、历史区间被重新计入，
//     而超出 7 天补卡窗口的日期已无法补卡，属罕见操作，接受并记录在文档里；
//   · 删除任务会级联删除其打卡记录，统计不残留孤儿数据；
//   · Σexpected = 0（无任务或本月尚无应打卡日）时返回 null，界面显示「—」；
//   · 取整规则：有打卡就不显示 0%，没全完成就不显示 100%，避免「打过 1 次却是 0%」「差一格却是 100%」。
function habitMonthRate(checked, expected) {
  if (!Number.isFinite(checked) || !Number.isFinite(expected) || expected <= 0) return null;
  if (checked <= 0) return 0;
  if (checked >= expected) return 100;
  return Math.min(99, Math.max(1, Math.round(checked / expected * 100)));
}

function buildHabitCalendar(year, month) {
  const now = new Date();
  let targetYear = Number(year);
  let targetMonth = Number(month);
  if (!Number.isInteger(targetYear) || !Number.isInteger(targetMonth) || targetMonth < 1 || targetMonth > 12 || targetYear < 2000 || targetYear > 2100) {
    targetYear = now.getFullYear();
    targetMonth = now.getMonth() + 1;
  }
  const monthPrefix = `${targetYear}-${String(targetMonth).padStart(2, '0')}-`;
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
  // checkin_date 已过 validateDeadline 校验，字符串 BETWEEN 对任意月长都正确
  const checkins = database.prepare('SELECT task_id, checkin_date FROM habit_checkins WHERE checkin_date BETWEEN ? AND ?').all(`${monthPrefix}01`, `${monthPrefix}${String(daysInMonth).padStart(2, '0')}`);
  const tasks = database.prepare('SELECT id, created_at, archived_at FROM habit_tasks').all();

  const toLocalDate = utcString => {
    if (!utcString) return null;
    const parsed = new Date(String(utcString).replace(' ', 'T') + 'Z');
    // 时间串损坏时返回 null（该任务整月不计入），避免 NaN 比较把「未创建」算成「已存在」
    return Number.isNaN(parsed.getTime()) ? null : localDateString(parsed);
  };
  // 归档日的口径：归档当天起就不再计入应打卡——归档任务已被 toggleCheckin 拦死，
  // 若把归档日算进分母，就是给用户派了一个「打不上卡却算欠账」的日子。
  // 对应的打卡记录同样跳过，保证 checked ≤ expected 恒成立。
  const ranges = tasks.map(task => ({ id: task.id, start: toLocalDate(task.created_at), end: task.archived_at ? toLocalDate(task.archived_at) : null }));
  const isActiveOn = (range, dateValue) => Boolean(range.start) && range.start <= dateValue && (!range.end || range.end > dateValue);
  const rawCheckinDates = new Set(checkins.map(row => row.checkin_date));
  const checkedByDate = new Map();
  for (const row of checkins) {
    const range = ranges.find(entry => entry.id === row.task_id);
    if (!range || !range.start) continue;
    if (row.checkin_date < range.start || (range.end && row.checkin_date >= range.end)) continue;
    if (!checkedByDate.has(row.checkin_date)) checkedByDate.set(row.checkin_date, new Set());
    checkedByDate.get(row.checkin_date).add(row.task_id);
  }

  // 聚合区间用「本地日期串」比较收口（月初 ~ min(今天, 月末)），不靠 Date 对象累加，
  // 避免夏令时切换日 cursor.setDate(+1) 停在同一格或跨过一格
  const today = localDateString(now);
  const monthStart = `${monthPrefix}01`;
  const monthEnd = `${monthPrefix}${String(daysInMonth).padStart(2, '0')}`;
  const lastAgg = today < monthStart ? null : today < monthEnd ? today : monthEnd;
  const days = [];
  let monthChecked = 0;
  let monthExpected = 0;
  const summary = { activeDays: 0, fullDays: 0, partialDays: 0, missedDays: 0 };
  for (let dayNumber = 1; dayNumber <= daysInMonth && lastAgg; dayNumber += 1) {
    const dateValue = `${monthPrefix}${String(dayNumber).padStart(2, '0')}`;
    if (dateValue > lastAgg) break;
    const expected = ranges.filter(range => isActiveOn(range, dateValue)).length;
    if (!expected) {
      // 当天无活跃任务：若有补卡记录（任务尚未创建时的补卡），标记 stray 供前端说明
      days.push({ date: dateValue, checked: 0, expected: 0, level: null, stray: rawCheckinDates.has(dateValue) });
      continue;
    }
    const checkedSet = checkedByDate.get(dateValue);
    // 理论上不会超过 expected，兜底钳制避免界面出现「5 / 4」这种自相矛盾的读数
    const checked = Math.min(checkedSet ? checkedSet.size : 0, expected);
    const level = checked === 0 ? 0 : checked >= expected ? 2 : 1;
    days.push({ date: dateValue, checked, expected, level, stray: false });
    monthChecked += checked;
    monthExpected += expected;
    summary.activeDays += 1;
    if (level === 0) summary.missedDays += 1;
    else if (level === 1) summary.partialDays += 1;
    else summary.fullDays += 1;
  }
  return {
    year: targetYear,
    month: targetMonth,
    days,
    monthChecked,
    monthExpected,
    monthRate: habitMonthRate(monthChecked, monthExpected),
    summary,
    // 与本次响应同源的当前任务数，供渲染层写 caption（不要用渲染层的旧 state，避免两处不同步）
    activeTasks: tasks.filter(task => !task.archived_at).length
  };
}

function registerHabitHandlers() {
  ipcMain.handle('habits:list', () => listHabitTasks());
  ipcMain.handle('habits:calendar', (_event, year, month) => buildHabitCalendar(year, month));

  ipcMain.handle('habits:create', (_event, input) => {
    const title = ensureText(input?.title, '任务名称', 60);
    const note = typeof input?.note === 'string' ? input.note.trim().slice(0, 200) : '';
    database.prepare('INSERT INTO habit_tasks (title, note) VALUES (?, ?)').run(title, note);
    broadcastHabitsChanged();
    notifyWidgets();
    return listHabitTasks();
  });

  ipcMain.handle('habits:update', (_event, id, input) => {
    getHabitTask(id);
    const title = ensureText(input?.title, '任务名称', 60);
    const note = typeof input?.note === 'string' ? input.note.trim().slice(0, 200) : '';
    database.prepare('UPDATE habit_tasks SET title = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(title, note, Number(id));
    broadcastHabitsChanged();
    notifyWidgets();
    return listHabitTasks();
  });

  ipcMain.handle('habits:delete', (_event, id) => {
    getHabitTask(id);
    database.prepare('DELETE FROM habit_tasks WHERE id = ?').run(Number(id));
    broadcastHabitsChanged();
    notifyWidgets();
    return true;
  });

  ipcMain.handle('habits:archive', (_event, id, archived) => {
    getHabitTask(id);
    if (archived) database.prepare('UPDATE habit_tasks SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(Number(id));
    else database.prepare('UPDATE habit_tasks SET archived_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(Number(id));
    broadcastHabitsChanged();
    notifyWidgets();
    return listHabitTasks();
  });

  ipcMain.handle('habits:toggle-checkin', (_event, id, date) => toggleCheckin(id, date));
}

function createBackupArchive(destination) {
  return new Promise((resolve, reject) => {
    const paths = getPaths();
    database.persist();
    const output = fs.createWriteStream(destination);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.file(paths.database, { name: 'deadline-desk.db' });
    archive.directory(paths.attachments, 'attachments');
    archive.append(JSON.stringify({ app: 'Deadline Desk', version: 1, createdAt: new Date().toISOString() }, null, 2), { name: 'manifest.json' });
    archive.finalize();
  });
}

async function restoreBackupArchive(source) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deadline-desk-restore-'));
  try {
    await extract(source, { dir: tempDir });
    const backupDatabase = path.join(tempDir, 'deadline-desk.db');
    const manifestPath = path.join(tempDir, 'manifest.json');
    if (!fs.existsSync(backupDatabase) || !fs.existsSync(manifestPath)) throw new Error('这不是有效的截止线备份文件');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.app !== 'Deadline Desk' || manifest.version !== 1) throw new Error('备份版本不受支持');
    const verification = new SQL.Database(fs.readFileSync(backupDatabase));
    const table = queryRows(verification, "SELECT name FROM sqlite_master WHERE type='table' AND name='items'")[0];
    verification.close();
    if (!table) throw new Error('备份数据库无效');

    const paths = getPaths();
    database.close();
    fs.copyFileSync(backupDatabase, paths.database);
    fs.rmSync(paths.attachments, { recursive: true, force: true });
    fs.mkdirSync(paths.attachments, { recursive: true });
    const backupAttachments = path.join(tempDir, 'attachments');
    if (fs.existsSync(backupAttachments)) fs.cpSync(backupAttachments, paths.attachments, { recursive: true });
    await initializeDatabase();
    notifyWidgets();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function readAiConfig() {
  return {
    endpoint: (getSetting(AI_SETTING_KEYS.endpoint) || '').trim(),
    model: (getSetting(AI_SETTING_KEYS.model) || '').trim(),
    apiKey: (getSetting(AI_SETTING_KEYS.apiKey) || '').trim()
  };
}

function isValidAiEndpoint(value) {
  try {
    const text = String(value).trim();
    if (!text) return false;
    const parsed = new URL(text);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function maskApiKey(key) {
  if (!key) return '';
  if (key.length >= 12) return `${key.slice(0, 4)}••••${key.slice(-4)}`;
  return '••••';
}

function buildAiSettingsView() {
  const config = readAiConfig();
  return {
    configured: config.endpoint !== '' && config.model !== '' && config.apiKey !== '' && isValidAiEndpoint(config.endpoint),
    endpoint: config.endpoint,
    model: config.model,
    keyMask: maskApiKey(config.apiKey)
  };
}

function isMainWindowSender(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  return Boolean(win && !win.isDestroyed() && win === mainWindow);
}

function readItemsForAssistant() {
  return database.prepare('SELECT id, title, kind, deadline, status FROM items ORDER BY id ASC').all()
    .map(row => ({ id: row.id, title: row.title, kind: row.kind, deadline: row.deadline, status: row.status }));
}

function parseLocalDateTime(deadline) {
  const match = String(deadline).slice(0, 16).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!match) return NaN;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])).getTime();
}

function buildAssistantSummary(now, rows = readItemsForAssistant()) {
  const nowValue = now.getTime();
  const distanceOf = item => {
    const distance = Math.abs(parseLocalDateTime(item.deadline) - nowValue);
    return Number.isNaN(distance) ? Infinity : distance;
  };
  const byDistance = (a, b) => {
    const left = distanceOf(a);
    const right = distanceOf(b);
    if (left !== right) return left - right;
    return a.id - b.id;
  };
  const pending = rows.filter(item => item.status !== 'completed').sort(byDistance);
  const completed = rows.filter(item => item.status === 'completed').sort(byDistance);
  const ordered = pending.concat(completed);
  return {
    items: ordered.slice(0, AI_SUMMARY_LIMIT),
    omittedCount: Math.max(0, rows.length - AI_SUMMARY_LIMIT)
  };
}

class AssistantFailure extends Error {
  constructor(code, message, retryable) {
    super(message);
    this.name = 'AssistantFailure';
    this.code = code;
    this.retryable = retryable;
  }
}

function createHttpFailure(status) {
  if (status >= 500 && status <= 599) {
    const entry = AI_ERROR_TABLE.http_5xx;
    return new AssistantFailure('http_5xx', entry.message, entry.retryable);
  }
  const entry = AI_ERROR_TABLE[`http_${status}`];
  if (entry) return new AssistantFailure(`http_${status}`, entry.message, entry.retryable);
  return new AssistantFailure('http_other', `请求失败（状态码 ${status}）`, true);
}

function resolveAiTimeoutMs() {
  const configured = Number(process.env.DEADLINE_DESK_AI_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : AI_DEFAULT_TIMEOUT_MS;
}

function classifyFetchFailure(error) {
  if (error === AI_TIMEOUT_SENTINEL) return 'timeout';
  if (error && typeof error === 'object' && error.assistantTimeout === true) return 'timeout';
  if (error && typeof error === 'object' && error.name === 'AbortError') return 'timeout';
  const text = [error?.message, error?.code, error?.cause?.message, error?.cause?.code, error?.cause?.errno]
    .filter(value => value !== undefined && value !== null)
    .join(' ');
  if (/net::ERR_|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ERR_SOCKET_/.test(text)) return 'network';
  return 'unknown';
}

async function callChatCompletion(options) {
  const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : resolveAiTimeoutMs();
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
  let guardTimer;
  const requestPromise = (async () => {
    const response = await net.fetch(options.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${options.apiKey}`
      },
      body: JSON.stringify({ model: options.model, temperature: 0, messages: options.messages }),
      signal: controller.signal
    });
    const text = await response.text();
    return { status: response.status, ok: response.ok, text };
  })();
  // 竞速结束后请求才失败时，避免 unhandledRejection
  requestPromise.catch(() => {});
  const guardPromise = new Promise((_resolve, reject) => {
    guardTimer = setTimeout(() => reject(AI_TIMEOUT_SENTINEL), timeoutMs);
  });
  try {
    return await Promise.race([requestPromise, guardPromise]);
  } catch (error) {
    const kind = classifyFetchFailure(error);
    const entry = AI_ERROR_TABLE[kind];
    throw new AssistantFailure(kind, entry.message, entry.retryable);
  } finally {
    clearTimeout(abortTimer);
    clearTimeout(guardTimer);
  }
}

function readChatText(chat) {
  if (!chat.ok) throw createHttpFailure(chat.status);
  let payload;
  try {
    payload = JSON.parse(chat.text);
  } catch {
    throw new AssistantFailure('invalid_response', AI_ERROR_TABLE.invalid_response.message, AI_ERROR_TABLE.invalid_response.retryable);
  }
  const choices = payload && typeof payload === 'object' ? payload.choices : null;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new AssistantFailure('invalid_response', AI_ERROR_TABLE.invalid_response.message, AI_ERROR_TABLE.invalid_response.retryable);
  }
  const choice = choices[0];
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
    throw new AssistantFailure('invalid_response', AI_ERROR_TABLE.invalid_response.message, AI_ERROR_TABLE.invalid_response.retryable);
  }
  const message = choice.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new AssistantFailure('invalid_response', AI_ERROR_TABLE.invalid_response.message, AI_ERROR_TABLE.invalid_response.retryable);
  }
  if (choice.finish_reason === 'length') {
    throw new AssistantFailure('invalid_response', AI_ERROR_TABLE.invalid_response.message, AI_ERROR_TABLE.invalid_response.retryable);
  }
  const content = message.content;
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    text = content
      .filter(part => part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
      .map(part => part.text)
      .join('');
  }
  if (!text.trim()) throw new AssistantFailure('empty_response', AI_ERROR_TABLE.empty_response.message, AI_ERROR_TABLE.empty_response.retryable);
  return text;
}

function extractJsonObject(text) {
  const source = String(text).replace(/```[A-Za-z]*/g, '').trim();
  const start = source.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(source.slice(start, index + 1));
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
          return parsed;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function readAssistantPayload(chat) {
  const parsed = extractJsonObject(readChatText(chat));
  if (!parsed) throw new AssistantFailure('invalid_response', AI_ERROR_TABLE.invalid_response.message, AI_ERROR_TABLE.invalid_response.retryable);
  return parsed;
}

function buildMultiIntentMessage(categories) {
  const labels = Object.keys(AI_INTENT_LABELS).filter(name => categories.includes(name)).map(name => AI_INTENT_LABELS[name]);
  const suffix = '；一次只能处理一类，请拆开分别提交。';
  if (labels.length === 0) return `识别到多类操作${suffix}`;
  if (labels.length === 1) return `识别到「${labels[0]}」类操作${suffix}`;
  if (labels.length === 2) return `识别到「${labels[0]}」和「${labels[1]}」两类操作${suffix}`;
  const head = labels.slice(0, -1).map(label => `「${label}」`).join('、');
  return `识别到${head}和「${labels[labels.length - 1]}」多类操作${suffix}`;
}

function normalizeAssistantIntent(payload) {
  const intent = payload?.intent;
  const rawDetected = Array.isArray(payload?.detectedIntents) ? payload.detectedIntents : [];
  const detected = Array.from(new Set(rawDetected.filter(value => AI_ALLOWED_INTENTS.includes(value))));
  const categories = detected.filter(value => value !== 'unsupported');
  if (categories.length >= 2 || intent === 'multiple') {
    return { intent: 'clarify', message: buildMultiIntentMessage(categories) };
  }
  if (!AI_ALLOWED_INTENTS.includes(intent)) {
    return { intent: 'clarify', message: '没有理解这条指令，请换一种说法或补充信息。' };
  }
  if (intent === 'unsupported') {
    const message = typeof payload.message === 'string' && payload.message.trim() ? payload.message : '暂不支持这类操作。';
    return { intent: 'unsupported', message };
  }
  return { intent, message: typeof payload.message === 'string' ? payload.message : '' };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function statusesForKind(kind) {
  return Object.prototype.hasOwnProperty.call(AI_STATUS_BY_KIND, kind) ? AI_STATUS_BY_KIND[kind] : [];
}

function defaultStatusForKind(kind) {
  const status = AI_DEFAULT_STATUS_BY_KIND[kind];
  return typeof status === 'string' ? status : null;
}

function isStatusAllowed(kind, status) {
  return statusesForKind(kind).includes(status);
}

function normalizeAssistantTitle(title) {
  let text = String(title).normalize('NFKC').toLowerCase().replace(/\s|\p{P}|\p{S}/gu, '');
  for (const prefix of ['关于', '报名', '参加']) {
    if (text.startsWith(prefix)) {
      text = text.slice(prefix.length);
      break;
    }
  }
  for (const suffix of ['课程设计', '课程报告', '实验报告', '大作业', '比赛', '报名', '活动', '作业', '课设', '报告']) {
    if (text.endsWith(suffix)) {
      text = text.slice(0, -suffix.length);
      break;
    }
  }
  return text;
}

function buildTitleBigrams(text) {
  if (typeof text !== 'string' || text.length < 2) return [];
  const bigrams = [];
  for (let index = 0; index < text.length - 1; index += 1) bigrams.push(text.slice(index, index + 2));
  return bigrams;
}

function diceCoefficient(leftBigrams, rightBigrams) {
  const total = leftBigrams.length + rightBigrams.length;
  if (total === 0) return 0;
  const counts = new Map();
  for (const gram of leftBigrams) counts.set(gram, (counts.get(gram) || 0) + 1);
  let overlap = 0;
  for (const gram of rightBigrams) {
    const count = counts.get(gram);
    if (count > 0) {
      counts.set(gram, count - 1);
      overlap += 1;
    }
  }
  return (2 * overlap) / total;
}

function hasTitleSignal(leftTitle, rightTitle) {
  const left = normalizeAssistantTitle(leftTitle);
  const right = normalizeAssistantTitle(rightTitle);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (shorter.length >= 3 && longer.includes(shorter)) return true;
  if (left.length >= 3 && right.length >= 3
    && diceCoefficient(buildTitleBigrams(left), buildTitleBigrams(right)) >= AI_DUPLICATE_DICE_THRESHOLD) return true;
  return false;
}

function isDeadlineClose(leftDeadline, rightDeadline, windowMs) {
  const left = parseLocalDateTime(leftDeadline);
  const right = parseLocalDateTime(rightDeadline);
  if (Number.isNaN(left) || Number.isNaN(right)) return false;
  return Math.abs(left - right) <= windowMs;
}

function composePlanMessage(modelMessage, notes) {
  const parts = [];
  if (typeof modelMessage === 'string' && modelMessage.trim()) parts.push(modelMessage.trim());
  for (const note of Array.isArray(notes) ? notes : []) {
    if (typeof note === 'string' && note.trim()) parts.push(note.trim());
  }
  return parts.join('；');
}

function parseTargetIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const ids = [];
  for (const item of value) {
    if (typeof item !== 'number' && typeof item !== 'string') continue;
    const number = Number(item);
    if (!Number.isSafeInteger(number) || number <= 0) continue;
    if (seen.has(number)) continue;
    seen.add(number);
    ids.push(number);
  }
  return ids;
}

function classifyTargetIds(targetIds, allItems, summaryItems) {
  const allIds = new Set((Array.isArray(allItems) ? allItems : []).map(item => item.id));
  const summaryIds = new Set((Array.isArray(summaryItems) ? summaryItems : []).map(item => item.id));
  const missingIds = [];
  const outOfRangeIds = [];
  const resolvedIds = [];
  for (const id of targetIds) {
    if (!allIds.has(id)) missingIds.push(id);
    else if (!summaryIds.has(id)) outOfRangeIds.push(id);
    else resolvedIds.push(id);
  }
  return { missingIds, outOfRangeIds, resolvedIds };
}

function buildPlanNotes(missingIds, outOfRangeIds) {
  const notes = [];
  if (missingIds.length > 0) notes.push(AI_NOTE_MISSING_IDS + missingIds.join('、'));
  if (outOfRangeIds.length > 0) notes.push(AI_NOTE_OUT_OF_RANGE_IDS + outOfRangeIds.join('、'));
  return notes;
}

function collectPlanTargetIds(resolvedIds, allItems) {
  const rows = Array.isArray(allItems) ? allItems : [];
  const titles = new Set();
  for (const id of resolvedIds) {
    const row = rows.find(item => item.id === id);
    if (row) titles.add(String(row.title).trim());
  }
  const extras = rows
    .filter(row => !resolvedIds.includes(row.id) && titles.has(String(row.title).trim()))
    .sort((a, b) => a.id - b.id)
    .map(row => row.id);
  return resolvedIds.concat(extras);
}

function isAmbiguousTitle(title, allItems) {
  const normalized = String(title).trim();
  const count = (Array.isArray(allItems) ? allItems : []).filter(item => String(item.title).trim() === normalized).length;
  return count >= 2;
}

function detectDuplicateCandidate(candidate, items) {
  const list = Array.isArray(items) ? items : [];
  const title = typeof candidate?.title === 'string' ? candidate.title : '';
  const deadlineMs = parseLocalDateTime(candidate?.deadline);
  let best = null;
  let bestRank = Infinity;
  let bestDistance = Infinity;
  for (const item of list) {
    const titleHit = title !== '' && hasTitleSignal(title, item.title);
    const timeHit = isDeadlineClose(candidate?.deadline, item.deadline, AI_DUPLICATE_TIME_WINDOW_MS);
    if (!titleHit && !timeHit) continue;
    const rank = titleHit ? 0 : 1;
    const itemMs = parseLocalDateTime(item.deadline);
    const distance = Number.isNaN(deadlineMs) || Number.isNaN(itemMs) ? Infinity : Math.abs(deadlineMs - itemMs);
    const better = best === null
      || rank < bestRank
      || (rank === bestRank && distance < bestDistance)
      || (rank === bestRank && distance === bestDistance && item.id < best.id);
    if (better) {
      best = item;
      bestRank = rank;
      bestDistance = distance;
    }
  }
  return best ? { id: best.id, title: best.title, deadline: best.deadline } : null;
}

function normalizeCreatePlan(options) {
  const { payload, allItems, now, omittedCount } = options;
  const source = isPlainObject(payload?.create) ? payload.create : null;
  const candidates = source && Array.isArray(source.candidates) ? source.candidates : [];
  const modelIgnored = source && Array.isArray(source.ignored) ? source.ignored : [];
  const ignored = [];
  for (const entry of modelIgnored) {
    if (!isPlainObject(entry)) continue;
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') continue;
    ignored.push({ text: typeof entry.text === 'string' ? entry.text.trim() : '', reason: entry.reason.trim() });
  }
  const normalized = [];
  candidates.forEach((raw, index) => {
    if (!isPlainObject(raw)) {
      ignored.push({ text: '', reason: AI_CREATE_IGNORED_REASONS.shape });
      return;
    }
    if (!['assignment', 'activity'].includes(raw.kind)) {
      ignored.push({ text: typeof raw.title === 'string' ? raw.title.trim() : '', reason: AI_CREATE_IGNORED_REASONS.kind });
      return;
    }
    if (typeof raw.title !== 'string' || raw.title.trim() === '') {
      ignored.push({ text: '', reason: AI_CREATE_IGNORED_REASONS.title });
      return;
    }
    const kind = raw.kind;
    const title = raw.title.trim();
    const titleTooLong = title.length > 120;
    let deadline = null;
    let deadlineIssue = null;
    if (raw.deadline === null || raw.deadline === undefined
      || (typeof raw.deadline === 'string' && raw.deadline.trim() === '')) {
      deadlineIssue = 'missing';
    } else if (typeof raw.deadline !== 'string') {
      deadlineIssue = 'invalid';
    } else {
      try {
        deadline = validateDeadline(raw.deadline.trim());
      } catch {
        deadline = null;
        deadlineIssue = 'invalid';
      }
    }
    let status = null;
    let statusInvalid = false;
    if (raw.status === null || raw.status === undefined
      || (typeof raw.status === 'string' && raw.status.trim() === '')) {
      status = defaultStatusForKind(kind);
    } else if (typeof raw.status === 'string' && isStatusAllowed(kind, raw.status.trim())) {
      status = raw.status.trim();
    } else {
      statusInvalid = true;
    }
    const workType = kind === 'assignment' ? (raw.workType === 'team' ? 'team' : 'personal') : null;
    const description = typeof raw.description === 'string' ? raw.description.trim().slice(0, 10000) : '';
    const expired = deadlineIssue === null && parseLocalDateTime(deadline) < now.getTime();
    const duplicate = detectDuplicateCandidate({ title, deadline }, allItems);
    const executable = !titleTooLong && deadlineIssue === null && status !== null && isStatusAllowed(kind, status);
    const selected = executable && duplicate === null;
    normalized.push({
      rowId: `c${index}`,
      title,
      kind,
      status,
      description,
      workType,
      deadline,
      deadlineIssue,
      titleTooLong,
      statusInvalid,
      statusAdjusted: false,
      expired,
      duplicate,
      selected,
      executable
    });
  });
  if (normalized.length === 0 && ignored.length === 0) {
    return { ok: true, intent: 'clarify', message: AI_CREATE_EMPTY_MESSAGE, omittedCount };
  }
  return {
    ok: true,
    intent: 'create',
    message: typeof payload?.message === 'string' ? payload.message : '',
    omittedCount,
    create: { candidates: normalized, ignored }
  };
}

function normalizeUpdatePlan(options) {
  const { payload, summaryItems, allItems, omittedCount } = options;
  if (!isPlainObject(payload?.update)) {
    return { ok: true, intent: 'clarify', message: AI_UPDATE_NO_MATCH_MESSAGE, omittedCount };
  }
  const targetIds = parseTargetIds(payload.update.targetIds);
  if (targetIds.length === 0) {
    return { ok: true, intent: 'clarify', message: AI_UPDATE_NO_MATCH_MESSAGE, omittedCount };
  }
  const { missingIds, outOfRangeIds, resolvedIds } = classifyTargetIds(targetIds, allItems, summaryItems);
  if (resolvedIds.length === 0) {
    return {
      ok: true,
      intent: 'clarify',
      message: composePlanMessage(AI_UPDATE_NO_MATCH_MESSAGE, buildPlanNotes(missingIds, outOfRangeIds)),
      omittedCount
    };
  }
  const orderedIds = collectPlanTargetIds(resolvedIds, allItems);
  const targets = orderedIds.map(id => {
    const row = allItems.find(item => item.id === id);
    return {
      id: row.id,
      title: row.title,
      kind: row.kind,
      deadline: row.deadline,
      status: row.status,
      isAmbiguous: isAmbiguousTitle(row.title, allItems)
    };
  });
  const ambiguous = targets.length > 1 || targets.some(target => target.isAmbiguous);
  const applyToId = targets.length === 1 ? targets[0].id : null;

  const sourceChanges = isPlainObject(payload.update.changes) ? payload.update.changes : {};
  const explicitKinds = resolvedIds.map(id => (allItems.find(item => item.id === id) || {}).kind);
  if (typeof sourceChanges.kind === 'string' && !explicitKinds.every(kind => kind === sourceChanges.kind)) {
    return { ok: true, intent: 'clarify', message: AI_UPDATE_KIND_MESSAGE, omittedCount };
  }

  const changes = {};
  let statusInvalid = false;
  let deadlineInvalid = false;
  let titleTooLong = false;

  const hasDeadline = !(sourceChanges.deadline === null || sourceChanges.deadline === undefined
    || (typeof sourceChanges.deadline === 'string' && sourceChanges.deadline.trim() === ''));
  if (hasDeadline) {
    if (typeof sourceChanges.deadline === 'string') {
      try {
        changes.deadline = validateDeadline(sourceChanges.deadline.trim());
      } catch {
        changes.deadline = null;
        deadlineInvalid = true;
      }
    } else {
      changes.deadline = null;
      deadlineInvalid = true;
    }
  }

  const hasStatus = !(sourceChanges.status === null || sourceChanges.status === undefined
    || (typeof sourceChanges.status === 'string' && sourceChanges.status.trim() === ''));
  if (hasStatus) {
    const status = typeof sourceChanges.status === 'string' ? sourceChanges.status.trim() : null;
    if (status !== null && explicitKinds.every(kind => isStatusAllowed(kind, status))) {
      changes.status = status;
    } else {
      changes.status = null;
      statusInvalid = true;
    }
  }

  if (typeof sourceChanges.title === 'string') {
    const title = sourceChanges.title.trim();
    if (title !== '') {
      titleTooLong = title.length > 120;
      changes.title = title;
    }
  }

  if (typeof sourceChanges.description === 'string') {
    changes.description = sourceChanges.description.trim().slice(0, 10000);
  }

  if (sourceChanges.workType === 'personal' || sourceChanges.workType === 'team') {
    changes.workType = sourceChanges.workType;
  }

  if (Object.keys(changes).length === 0 && !statusInvalid && !deadlineInvalid) {
    return { ok: true, intent: 'clarify', message: AI_UPDATE_NO_CHANGES_MESSAGE, omittedCount };
  }

  const message = composePlanMessage(payload.message, buildPlanNotes(missingIds, outOfRangeIds));
  return {
    ok: true,
    intent: 'update',
    message,
    omittedCount,
    update: {
      targets,
      ambiguous,
      applyToId,
      changes,
      statusInvalid,
      deadlineInvalid,
      titleTooLong,
      message
    }
  };
}

function normalizeDeletePlan(options) {
  const { payload, summaryItems, allItems, omittedCount } = options;
  if (!isPlainObject(payload?.delete)) {
    return { ok: true, intent: 'clarify', message: AI_DELETE_NO_MATCH_MESSAGE, omittedCount };
  }
  const targetIds = parseTargetIds(payload.delete.targetIds);
  if (targetIds.length === 0) {
    return { ok: true, intent: 'clarify', message: AI_DELETE_NO_MATCH_MESSAGE, omittedCount };
  }
  const { missingIds, outOfRangeIds, resolvedIds } = classifyTargetIds(targetIds, allItems, summaryItems);
  if (resolvedIds.length === 0) {
    return {
      ok: true,
      intent: 'clarify',
      message: composePlanMessage(AI_DELETE_NO_MATCH_MESSAGE, buildPlanNotes(missingIds, outOfRangeIds)),
      omittedCount
    };
  }
  const orderedIds = collectPlanTargetIds(resolvedIds, allItems);
  const targets = orderedIds.map(id => {
    const row = allItems.find(item => item.id === id);
    const isAmbiguous = isAmbiguousTitle(row.title, allItems);
    return {
      id: row.id,
      title: row.title,
      kind: row.kind,
      deadline: row.deadline,
      status: row.status,
      selected: !isAmbiguous,
      isAmbiguous
    };
  });
  return {
    ok: true,
    intent: 'delete',
    message: composePlanMessage(payload.message, buildPlanNotes(missingIds, outOfRangeIds)),
    omittedCount,
    delete: { targets }
  };
}

function normalizeCleanupPlan(options) {
  const { payload, allItems, now, omittedCount } = options;
  const range = resolveRange(payload?.cleanup?.range, now, { allowAll: true });
  if (!range) {
    return { ok: true, intent: 'clarify', message: AI_CLEANUP_NO_RANGE_MESSAGE, omittedCount };
  }
  const targets = (Array.isArray(allItems) ? allItems : [])
    .filter(item => item.status === 'completed'
      && ['assignment', 'activity'].includes(item.kind)
      && String(item.deadline).slice(0, 10) >= range.start
      && String(item.deadline).slice(0, 10) <= range.end)
    .sort((a, b) => a.deadline.localeCompare(b.deadline) || a.id - b.id)
    .map(item => ({ id: item.id, title: item.title, kind: item.kind, deadline: item.deadline, status: item.status, selected: true }));
  return {
    ok: true,
    intent: 'cleanup',
    message: targets.length === 0
      ? AI_CLEANUP_EMPTY_MESSAGE
      : (typeof payload.message === 'string' ? payload.message : ''),
    omittedCount,
    cleanup: { targets, rangeLabel: range.label }
  };
}

function buildAssistantSystemPrompt() {
  return [
    '你是「截止线」的事项助手，只做意图识别与结构化输出：不写库、不解释推理过程。',
    '',
    '只输出一个 JSON 对象；禁止 Markdown、代码围栏、前后说明。',
    '',
    'JSON schema：',
    '{',
    '  "intent": "create | update | delete | cleanup | query | multiple | unsupported",',
    '  "detectedIntents": ["create | update | delete | cleanup | query | unsupported"],',
    '  "message": "给用户的简短说明",',
    '  "create": { "candidates": [ { "title": "事项标题", "kind": "assignment | activity", "deadline": "YYYY-MM-DD HH:MM", "status": "该类型允许的状态", "description": "说明", "workType": "personal | team | null" } ], "ignored": [ { "text": "片段", "reason": "忽略原因" } ] },',
    '  "update": { "targetIds": [1, 2], "changes": { "title": "...", "deadline": "...", "status": "...", "description": "...", "workType": "..." } },',
    '  "delete": { "targetIds": [1, 2] },',
    '  "cleanup": { "range": { "type": "..." } },',
    '  "query": { "range": { "type": "..." }, "kind": "assignment | activity | all", "status": "pending | completed | all", "shape": "list | count", "needsScope": true }',
    '}',
    '',
    'range.type 取值：this_week、next_week、last_week、this_month、next_month、last_month、this_year、last_year、month{year,month}、week{date}、custom{start,end}、all。',
    '',
    '协议约束：',
    '1. 只输出 JSON，不输出 Markdown、代码围栏或解释。',
    '2. deadline 必须是绝对时间 YYYY-MM-DD HH:MM；只给日期补 23:59；不得编造日期，无法确定输出 null。',
    '3. kind 只能是 assignment / activity；status 只能是该类型允许的状态。',
    '4. 新增候选必须有明确标题；空标题、泛泛片段不生成候选。',
    '5. update / delete 的 targetIds 只能取自输入摘要的 id；不得改事项大类；不得输出按时间范围批量删除未完成事项。',
    '6. cleanup 只针对已完成事项且必须给出 range；无范围时让 range 缺失（本地提示补充）。',
    '7. 一次输入出现多个类别时 intent = multiple，并在 detectedIntents 列出全部类别。',
    '8. 日常任务、日记、周报/复盘/建议等越界请求用 unsupported 并在 message 说明。',
    '9. 相对时间以输入 now.date / now.weekday / now.time 为唯一基准，周一为一周第一天；所指日期已过去时按「最近的下一个同名日期」理解。',
    '10. 不复述事项说明、附件等未提供的信息。',
    '11. 「删除上个月所有未完成事项」这类按范围批量删除属越界，用 unsupported 说明并建议逐条处理；已完成批量删除走 cleanup。',
    '12. 询问「完成动作发生在某月/某周」时说明数据无独立完成时间，只能按截止时间归属 + 当前已完成状态统计。',
    '13. 「取消 / 删掉 / 删除某事项」一律理解为永久删除该事项，不改状态、不归档。',
    '14. 查询未说明状态时，列表型问题默认回答范围内未完成事项；明确问完成情况时按已完成统计。'
  ].join('\n');
}

function buildAssistantNow(now) {
  return {
    date: localDateString(now),
    weekday: WEEKDAY_FULL[now.getDay()],
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  };
}

function buildAssistantUserMessage(now, items, input) {
  return JSON.stringify({ now: buildAssistantNow(now), items, input });
}

function buildQuerySystemPrompt() {
  return [
    '你是「截止线」的事项查询助手。只能使用用户消息中给定的统计与条目作答，不得编造条目或数字。',
    '用简洁中文回答，必要时说明「按截止时间」的统计口径。',
    '只输出纯文本，不输出 JSON、Markdown 代码围栏或多余解释。'
  ].join('\n');
}

function buildQueryUserMessage(meta, question) {
  return JSON.stringify({
    question,
    rangeLabel: meta.rangeLabel,
    kindLabel: meta.kindLabel,
    statusLabel: meta.statusLabel,
    counts: meta.counts,
    entries: meta.entries
  });
}

function weekStart(date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

function addDays(date, amount) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function formatYmd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatRangeLabel(startDate, endDate, withWeekday) {
  const weekday = date => (withWeekday ? `（${WEEKDAY_SHORT[date.getDay()]}）` : '');
  const startText = `${startDate.getFullYear()}年${startDate.getMonth() + 1}月${startDate.getDate()}日`;
  const endText = startDate.getFullYear() === endDate.getFullYear()
    ? `${endDate.getMonth() + 1}月${endDate.getDate()}日`
    : `${endDate.getFullYear()}年${endDate.getMonth() + 1}月${endDate.getDate()}日`;
  return `${startText}${weekday(startDate)}–${endText}${weekday(endDate)}`;
}

function buildResolvedRange(startDate, endDate, withWeekday) {
  return {
    start: formatYmd(startDate),
    end: formatYmd(endDate),
    label: formatRangeLabel(startDate, endDate, Boolean(withWeekday))
  };
}

function resolveRange(range, baseDate, options = {}) {
  if (!range || typeof range !== 'object' || Array.isArray(range) || typeof range.type !== 'string') return null;
  const base = baseDate instanceof Date && !Number.isNaN(baseDate.getTime()) ? baseDate : new Date();
  const monday = weekStart(base);
  const year = base.getFullYear();
  const monthIndex = base.getMonth();
  switch (range.type) {
    case 'all':
      return options?.allowAll === true
        ? { start: '0000-01-01', end: '9999-12-31', label: '全部时间' }
        : null;
    case 'this_week':
      return buildResolvedRange(monday, addDays(monday, 6), true);
    case 'next_week':
      return buildResolvedRange(addDays(monday, 7), addDays(monday, 13), true);
    case 'last_week':
      return buildResolvedRange(addDays(monday, -7), addDays(monday, -1), true);
    case 'this_month':
      return buildResolvedRange(new Date(year, monthIndex, 1), new Date(year, monthIndex + 1, 0), false);
    case 'next_month':
      return buildResolvedRange(new Date(year, monthIndex + 1, 1), new Date(year, monthIndex + 2, 0), false);
    case 'last_month':
      return buildResolvedRange(new Date(year, monthIndex - 1, 1), new Date(year, monthIndex, 0), false);
    case 'this_year':
      return buildResolvedRange(new Date(year, 0, 1), new Date(year, 11, 31), false);
    case 'last_year':
      return buildResolvedRange(new Date(year - 1, 0, 1), new Date(year - 1, 11, 31), false);
    case 'month': {
      if (!Number.isInteger(range.year) || range.year < 2000 || range.year > 2100) return null;
      if (!Number.isInteger(range.month) || range.month < 1 || range.month > 12) return null;
      return buildResolvedRange(new Date(range.year, range.month - 1, 1), new Date(range.year, range.month, 0), false);
    }
    case 'week': {
      let value;
      try {
        value = validateDeadline(range.date);
      } catch {
        return null;
      }
      const [weekYear, weekMonth, weekDay] = value.slice(0, 10).split('-').map(Number);
      const start = weekStart(new Date(weekYear, weekMonth - 1, weekDay));
      return buildResolvedRange(start, addDays(start, 6), true);
    }
    case 'custom': {
      let startValue;
      let endValue;
      try {
        startValue = validateDeadline(range.start);
        endValue = validateDeadline(range.end);
      } catch {
        return null;
      }
      const toDate = value => {
        const [customYear, customMonth, customDay] = value.slice(0, 10).split('-').map(Number);
        return new Date(customYear, customMonth - 1, customDay);
      };
      let start = toDate(startValue);
      let end = toDate(endValue);
      if (start.getTime() > end.getTime()) {
        const swap = start;
        start = end;
        end = swap;
      }
      return buildResolvedRange(start, end, false);
    }
    default:
      return null;
  }
}

function normalizeQueryFilters(query) {
  const source = query && typeof query === 'object' && !Array.isArray(query) ? query : {};
  return {
    kind: ['assignment', 'activity', 'all'].includes(source.kind) ? source.kind : 'all',
    status: ['pending', 'completed', 'all'].includes(source.status) ? source.status : 'pending',
    shape: ['list', 'count'].includes(source.shape) ? source.shape : 'list'
  };
}

function collectQueryData(rows, range, kind, status) {
  const byKind = rows.filter(item => {
    const datePart = String(item.deadline).slice(0, 10);
    if (datePart < range.start || datePart > range.end) return false;
    return kind === 'all' || item.kind === kind;
  });
  const counts = {
    total: 0,
    assignment: { total: 0, pending: 0, completed: 0 },
    activity: { total: 0, pending: 0, completed: 0 }
  };
  for (const item of byKind) {
    const bucket = counts[item.kind];
    if (!bucket) continue;
    bucket.total += 1;
    if (item.status === 'completed') bucket.completed += 1;
    else bucket.pending += 1;
  }
  counts.total = counts.assignment.total + counts.activity.total;
  const entries = byKind
    .filter(item => status === 'all' || (status === 'completed' ? item.status === 'completed' : item.status !== 'completed'))
    .sort((a, b) => a.deadline.localeCompare(b.deadline) || a.id - b.id)
    .map(item => ({ id: item.id, title: item.title, kind: item.kind, deadline: item.deadline, status: item.status }));
  return { counts, entries };
}

function buildQueryFallback(meta, shape) {
  if (meta.counts.total === 0 || (shape === 'list' && meta.entries.length === 0)) {
    return `按截止时间在 ${meta.rangeLabel} 内没有符合条件的事项。`;
  }
  if (shape === 'count') {
    const assignment = meta.counts.assignment;
    const activity = meta.counts.activity;
    return `按截止时间在 ${meta.rangeLabel} 内：共 ${meta.counts.total} 个事项，其中大作业 ${assignment.total} 个（未完成 ${assignment.pending}、已完成 ${assignment.completed}），活动 ${activity.total} 个（未完成 ${activity.pending}、已完成 ${activity.completed}）。`;
  }
  const lines = meta.entries.map(entry => `\n${entry.deadline} · ${AI_QUERY_KIND_LABELS[entry.kind]} · ${entry.title}`).join('');
  return `按截止时间在 ${meta.rangeLabel} 内，共 ${meta.counts.total} 个${meta.statusLabel}事项：${lines}`;
}

async function handleAssistantQuery(options) {
  const { payload, config, now, input, omittedCount } = options;
  const range = resolveRange(payload?.query?.range, now);
  if (!range) {
    return { ok: true, intent: 'clarify', message: '请补充时间范围（例如本周、下个月、今年）后重试。', omittedCount };
  }
  const filters = normalizeQueryFilters(payload?.query);
  const rows = readItemsForAssistant();
  const { counts, entries } = collectQueryData(rows, range, filters.kind, filters.status);
  const meta = {
    rangeLabel: range.label,
    kindLabel: AI_QUERY_KIND_LABELS[filters.kind],
    statusLabel: AI_QUERY_STATUS_LABELS[filters.status],
    counts,
    entries
  };
  let answer;
  let fallback = false;
  try {
    const chat = await callChatCompletion({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      model: config.model,
      messages: [
        { role: 'system', content: buildQuerySystemPrompt() },
        { role: 'user', content: buildQueryUserMessage(meta, input) }
      ],
      timeoutMs: resolveAiTimeoutMs()
    });
    answer = readChatText(chat);
  } catch {
    answer = buildQueryFallback(meta, filters.shape);
    fallback = true;
  }
  return { ok: true, intent: 'query', message: '', omittedCount, query: { answer, fallback, meta } };
}

function registerAssistantHandlers() {
  ipcMain.handle('assistant:parse', async (event, input) => {
    try {
      if (!isMainWindowSender(event)) {
        return { ok: false, code: 'forbidden', message: AI_ERROR_TABLE.forbidden.message, retryable: AI_ERROR_TABLE.forbidden.retryable };
      }
      const config = readAiConfig();
      if (!config.endpoint || !config.model || !config.apiKey) {
        return { ok: false, code: 'not_configured', message: AI_ERROR_TABLE.not_configured.message, retryable: AI_ERROR_TABLE.not_configured.retryable };
      }
      if (!isValidAiEndpoint(config.endpoint)) {
        return { ok: false, code: 'invalid_endpoint', message: AI_ERROR_TABLE.invalid_endpoint.message, retryable: AI_ERROR_TABLE.invalid_endpoint.retryable };
      }
      const invalidInput = message => ({ ok: false, code: 'invalid_input', message, retryable: false });
      if (typeof input !== 'string') return invalidInput(AI_ERROR_TABLE.invalid_input.message);
      const text = input.trim();
      if (!text) return invalidInput(AI_ERROR_TABLE.invalid_input.message);
      if (text.length > AI_INPUT_MAX_LENGTH) return invalidInput(`内容超过 ${AI_INPUT_MAX_LENGTH} 字符，请精简后再提交`);
      const now = new Date();
      const allItems = readItemsForAssistant();
      const summary = buildAssistantSummary(now, allItems);
      const chat = await callChatCompletion({
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        model: config.model,
        messages: [
          { role: 'system', content: buildAssistantSystemPrompt() },
          { role: 'user', content: buildAssistantUserMessage(now, summary.items, text) }
        ],
        timeoutMs: resolveAiTimeoutMs()
      });
      const payload = readAssistantPayload(chat);
      const planOptions = {
        payload,
        summaryItems: summary.items,
        allItems,
        now,
        omittedCount: summary.omittedCount
      };
      const normalized = normalizeAssistantIntent(payload);
      if (normalized.intent === 'query') {
        return await handleAssistantQuery({ payload, config, now, input: text, omittedCount: summary.omittedCount });
      }
      if (normalized.intent === 'create') return normalizeCreatePlan(planOptions);
      if (normalized.intent === 'update') return normalizeUpdatePlan(planOptions);
      if (normalized.intent === 'delete') return normalizeDeletePlan(planOptions);
      if (normalized.intent === 'cleanup') return normalizeCleanupPlan(planOptions);
      return { ok: true, intent: normalized.intent, message: normalized.message, omittedCount: summary.omittedCount };
    } catch (error) {
      if (error instanceof AssistantFailure) {
        return { ok: false, code: error.code, message: error.message, retryable: error.retryable };
      }
      return { ok: false, code: 'unknown', message: AI_ERROR_TABLE.unknown.message, retryable: AI_ERROR_TABLE.unknown.retryable };
    }
  });
}

function registerDataHandlers() {
  ipcMain.handle('data:backup', async () => {
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出截止线备份',
      defaultPath: path.join(app.getPath('documents'), `截止线备份_${stamp}.zip`),
      filters: [{ name: '截止线备份', extensions: ['zip'] }]
    });
    if (result.canceled || !result.filePath) return null;
    await createBackupArchive(result.filePath);
    return result.filePath;
  });

  ipcMain.handle('data:restore', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择截止线备份',
      properties: ['openFile'],
      filters: [{ name: '截止线备份', extensions: ['zip'] }]
    });
    if (result.canceled || !result.filePaths[0]) return false;
    await restoreBackupArchive(result.filePaths[0]);
    return true;
  });

  ipcMain.handle('data:clear', () => {
    const paths = getPaths();
    database.exec('DELETE FROM notification_log; DELETE FROM attachments; DELETE FROM items; DELETE FROM diary_entries; DELETE FROM habit_checkins; DELETE FROM habit_tasks;');
    fs.rmSync(paths.attachments, { recursive: true, force: true });
    fs.mkdirSync(paths.attachments, { recursive: true });
    notifyWidgets();
    return true;
  });

  ipcMain.handle('settings:get', () => ({
    notificationsEnabled: database.prepare('SELECT value FROM settings WHERE key = ?').get('notifications_enabled')?.value !== 'false',
    widgetEnabled: isWidgetEnabled(),
    dataPath: getPaths().root,
    ai: buildAiSettingsView()
  }));

  ipcMain.handle('settings:set-ai', (event, payload) => {
    try {
      if (!isMainWindowSender(event)) return { ok: false, message: '当前窗口无权执行该操作' };
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, message: 'AI 配置格式不正确' };
      if (typeof payload.endpoint !== 'string') return { ok: false, message: 'AI 配置格式不正确' };
      if (typeof payload.model !== 'string') return { ok: false, message: 'AI 配置格式不正确' };
      if (payload.apiKey !== undefined && typeof payload.apiKey !== 'string') return { ok: false, message: 'AI 配置格式不正确' };
      const endpoint = payload.endpoint.trim();
      const model = payload.model.trim();
      const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : '';
      if (endpoint && !isValidAiEndpoint(endpoint)) return { ok: false, message: '接口地址格式不正确，请填写完整的 http/https 地址' };
      if (model.length > AI_MODEL_MAX_LENGTH) return { ok: false, message: '模型名内容过长' };
      if (apiKey.length > AI_KEY_MAX_LENGTH) return { ok: false, message: 'API Key 内容过长' };
      setSetting(AI_SETTING_KEYS.endpoint, endpoint);
      setSetting(AI_SETTING_KEYS.model, model);
      if (apiKey) setSetting(AI_SETTING_KEYS.apiKey, apiKey);
      return { ok: true, ai: buildAiSettingsView() };
    } catch {
      return { ok: false, message: '保存失败，请重试' };
    }
  });

  ipcMain.handle('settings:set-widget', (_event, enabled) => {
    setSetting('widget_enabled', enabled ? 'true' : 'false');
    if (enabled) createWidgetWindow();
    else if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.close();
    return Boolean(enabled);
  });

  ipcMain.handle('settings:set-notifications', (_event, enabled) => {
    database.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('notifications_enabled', enabled ? 'true' : 'false');
    if (enabled) checkNotifications();
    return Boolean(enabled);
  });

  ipcMain.handle('app:show-data-folder', () => shell.openPath(getPaths().root));
}

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function daysFromToday(dateString) {
  const [year, month, day] = dateString.slice(0, 10).split('-').map(Number);
  const target = new Date(year, month - 1, day);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - start) / 86400000);
}

function checkNotifications() {
  if (!Notification.isSupported() || !database) return;
  const enabled = database.prepare('SELECT value FROM settings WHERE key = ?').get('notifications_enabled')?.value !== 'false';
  if (!enabled) return;
  const today = localDateString();
  const items = database.prepare("SELECT * FROM items WHERE status != 'completed' ORDER BY deadline ASC").all();
  if (!items.length) return;
  const notifiedIds = new Set(
    database.prepare('SELECT item_id FROM notification_log WHERE notification_date = ?').all(today).map(row => row.item_id)
  );
  const addLog = database.prepare('INSERT OR IGNORE INTO notification_log (item_id, notification_date) VALUES (?, ?)');
  for (const item of items) {
    const days = daysFromToday(item.deadline);
    if (days > 7 || notifiedIds.has(item.id)) continue;
    const timePart = item.deadline.split(' ')[1];
    const timeSuffix = timePart && timePart !== '23:59' ? ` ${timePart}` : '';
    const timing = days < 0 ? `已逾期 ${Math.abs(days)} 天`
      : days === 0 ? `今天${timeSuffix}到期`
      : days === 1 ? `明天${timeSuffix}到期`
      : `${days} 天后到期`;
    const notification = new Notification({ title: `${APP_NAME} · ${timing}`, body: item.title, silent: false });
    notification.on('click', showMainWindow);
    notification.show();
    addLog.run(item.id, today);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);

  app.whenReady().then(async () => {
    app.setName(APP_NAME);
    await initializeDatabase();
    registerItemHandlers();
    registerAttachmentHandlers();
    registerDiaryHandlers();
    registerHabitHandlers();
    registerDataHandlers();
    registerAssistantHandlers();
    registerWidgetHandlers();
    createWindow();
    createTray();
    if (isWidgetEnabled()) createWidgetWindow();
  setTimeout(checkNotifications, 3000);
  notificationTimer = setInterval(checkNotifications, 60 * 60 * 1000);
    app.on('activate', showMainWindow);
  });

  app.on('before-quit', () => { quitting = true; clearInterval(notificationTimer); });
}

app.on('window-all-closed', event => event.preventDefault());
app.on('quit', () => { if (database?.open) database.close(); });
// app.exit() 不经过 before-quit/quit，落盘兜底只能挂在进程退出钩子上
process.on('exit', () => { try { if (database?.open) database.persist(); } catch {} });
