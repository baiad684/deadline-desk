const { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const archiver = require('archiver');
const extract = require('extract-zip');
const initSqlJs = require('sql.js');

let mainWindow;
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
  `);
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
  const initialHeight = snapshot.count ? 80 + 41 * Math.min(snapshot.count, 5) : 142;
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
  widgetWindow.on('closed', () => { widgetWindow = null; });
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
  return { count: items.length, items: items.slice(0, 5), pinned: isWidgetPinned() };
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

function validateDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('截止日期格式不正确');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error('截止日期无效');
  return value;
}

function validateItem(input) {
  const kind = input?.kind;
  if (!['assignment', 'activity'].includes(kind)) throw new Error('事项类型无效');
  const title = ensureText(input.title, kind === 'assignment' ? '课程名称' : '活动名称', 120);
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 10000) : '';
  const deadline = validateDate(input.deadline);
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

function registerWidgetHandlers() {
  ipcMain.handle('widget:get', () => buildWidgetSnapshot());
  ipcMain.handle('widget:open-main', () => showMainWindow());
  ipcMain.handle('widget:resize', (event, height) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return false;
    const target = Math.max(140, Math.min(300, Math.round(Number(height) || WIDGET_HEIGHT)));
    const [width, current] = win.getSize();
    if (Math.abs(current - target) < 2) return true;
    const [x, y] = win.getPosition();
    win.setBounds({ x, y, width, height: target });
    return true;
  });
  ipcMain.handle('widget:set-pinned', (event, pinned) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(Boolean(pinned));
    setSetting('widget_pinned', pinned ? 'true' : 'false');
    return Boolean(pinned);
  });
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
    database.exec('DELETE FROM notification_log; DELETE FROM attachments; DELETE FROM items;');
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
  const [year, month, day] = dateString.split('-').map(Number);
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
    const timing = days < 0 ? `已逾期 ${Math.abs(days)} 天` : days === 0 ? '今天到期' : `${days} 天后到期`;
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
    registerDataHandlers();
    registerWidgetHandlers();
    createWindow();
    createTray();
    if (isWidgetEnabled()) createWidgetWindow();
    setTimeout(checkNotifications, 3000);
    notificationTimer = setInterval(checkNotifications, 15 * 60 * 1000);
    app.on('activate', showMainWindow);
  });

  app.on('before-quit', () => { quitting = true; clearInterval(notificationTimer); });
}

app.on('window-all-closed', event => event.preventDefault());
app.on('quit', () => { if (database?.open) database.close(); });
// app.exit() 不经过 before-quit/quit，落盘兜底只能挂在进程退出钩子上
process.on('exit', () => { try { if (database?.open) database.persist(); } catch {} });
