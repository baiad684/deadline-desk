const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deadlineDesk', {
  items: {
    list: () => ipcRenderer.invoke('items:list'),
    create: input => ipcRenderer.invoke('items:create', input),
    update: (id, input) => ipcRenderer.invoke('items:update', id, input),
    setStatus: (id, status) => ipcRenderer.invoke('items:status', id, status),
    remove: id => ipcRenderer.invoke('items:delete', id)
  },
  attachments: {
    select: () => ipcRenderer.invoke('attachments:add'),
    save: (itemId, files) => ipcRenderer.invoke('attachments:save', itemId, files),
    open: id => ipcRenderer.invoke('attachments:open', id),
    remove: id => ipcRenderer.invoke('attachments:delete', id)
  },
  diary: {
    get: date => ipcRenderer.invoke('diary:get', date),
    save: (date, content) => ipcRenderer.invoke('diary:save', date, content),
    listDates: () => ipcRenderer.invoke('diary:list-dates'),
    remove: date => ipcRenderer.invoke('diary:delete', date)
  },
  habits: {
    list: () => ipcRenderer.invoke('habits:list'),
    calendar: (year, month) => ipcRenderer.invoke('habits:calendar', year, month),
    create: input => ipcRenderer.invoke('habits:create', input),
    update: (id, input) => ipcRenderer.invoke('habits:update', id, input),
    remove: id => ipcRenderer.invoke('habits:delete', id),
    setArchived: (id, archived) => ipcRenderer.invoke('habits:archive', id, archived),
    toggleCheckin: (id, date) => ipcRenderer.invoke('habits:toggle-checkin', id, date),
    onChanged: callback => ipcRenderer.on('habits:changed', () => callback())
  },
  data: {
    backup: () => ipcRenderer.invoke('data:backup'),
    restore: () => ipcRenderer.invoke('data:restore'),
    clear: () => ipcRenderer.invoke('data:clear')
  },
  widget: {
    getData: () => ipcRenderer.invoke('widget:get'),
    setPinned: pinned => ipcRenderer.invoke('widget:set-pinned', pinned),
    openMain: () => ipcRenderer.invoke('widget:open-main'),
    resize: height => ipcRenderer.invoke('widget:resize', height),
    dragStart: (x, y) => ipcRenderer.send('widget:drag-start', x, y),
    dragMove: (x, y) => ipcRenderer.send('widget:drag-move', x, y),
    dragEnd: () => ipcRenderer.send('widget:drag-end'),
    toggleCheckin: id => ipcRenderer.invoke('widget:toggle-checkin', id),
    onData: callback => ipcRenderer.on('widget:data', (_event, snapshot) => callback(snapshot))
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    setNotifications: enabled => ipcRenderer.invoke('settings:set-notifications', enabled),
    setWidget: enabled => ipcRenderer.invoke('settings:set-widget', enabled),
    showDataFolder: () => ipcRenderer.invoke('app:show-data-folder')
  }
});
