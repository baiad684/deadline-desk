const { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, screen, shell } = require('electron');
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
    dataPath: getPaths().root
  }));

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
