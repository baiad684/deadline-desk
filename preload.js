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
    onData: callback => ipcRenderer.on('widget:data', (_event, snapshot) => callback(snapshot))
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    setNotifications: enabled => ipcRenderer.invoke('settings:set-notifications', enabled),
    setWidget: enabled => ipcRenderer.invoke('settings:set-widget', enabled),
    showDataFolder: () => ipcRenderer.invoke('app:show-data-folder')
  }
});
