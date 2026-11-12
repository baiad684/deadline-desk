const icons = {
  flag: '<path d="M5 22V4"/><path d="M5 5c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  ticket: '<path d="M2 9a3 3 0 0 0 0 6v4h20v-4a3 3 0 0 0 0-6V5H2z"/><path d="M13 5v2M13 17v2M13 11v2"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 16v-5M12 16V7M17 16v-3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15 4.63a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9 1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M13.7 21h-3.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/>',
  paperclip: '<path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 0 1-2.8-2.8l8.9-8.9"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  external: '<path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M17 8l-5-5-5 5M12 3v12M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  diary: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3v18"/><path d="M12 8h5M12 12h5"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  folder: '<path d="M3 5h6l2 2h10v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  warning: '<path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  inbox: '<path d="M4 4h16v16H4z"/><path d="M4 14h4l2 3h4l2-3h4"/>',
  assistant: '<path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>'
};

const ASSISTANT_INPUT_MAX_LENGTH = 3000;
const ASSISTANT_TITLE_MAX_LENGTH = 120;
const ASSISTANT_DESCRIPTION_MAX_LENGTH = 10000;
const ASSISTANT_STATUS_OPTIONS = {
  assignment: [['not_started', '未开始'], ['in_progress', '进行中'], ['completed', '已完成']],
  activity: [['not_completed', '未完成'], ['completed', '已完成']]
};
const ASSISTANT_WORK_TYPE_OPTIONS = [['personal', '个人'], ['team', '团队']];
const ASSISTANT_DEFAULT_PLACEHOLDER = '提交后会在这里显示预览或答复。';
const ASSISTANT_LOADING_TEXT = '正在处理…';
const ASSISTANT_SUMMARY_LIMIT = 100;

// 工作台内的页面（标签栏所含）；其余页面（日记 / 统计 / 设置）独占整个内容区
const WORKSPACE_PAGES = ['today', 'assignments', 'activities', 'habits', 'overdue', 'assistant'];

const state = {
  items: [],
  currentPage: 'today',
  lastWorkspacePage: 'today',
  assignmentFilter: 'all',
  activityFilter: 'all',
  search: '',
  modalKind: 'assignment',
  selectedFiles: [],
  existingAttachments: [],
  animateTodayRows: true,
  justCompletedId: null,
  confirmResolver: null,
  detailItemId: null,
  detailOrigin: 'day',
  detailOpener: null,
  itemFormBaseline: null,
  notificationsEnabled: true,
  diaryDates: new Set(),
  diaryView: { year: 0, month: 0 },
  diaryDate: '',
  diarySavedContent: '',
  diarySaveTimer: null,
  habits: [],
  habitArchivedOpen: false,
  assistant: {
    input: '',
    loading: false,
    executing: false,
    seq: 0,
    view: null,
    records: [],
    dirty: false,
    error: null
  },
  ai: { configured: false, protocol: 'openai', endpoint: '', model: '', keyMask: '', editingKey: false }
};

const api = window.deadlineDesk;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

// ---------- 对话框焦点管理 ----------
// 弹窗必须把焦点锁在 dialog 内，关闭后把焦点还给触发它的元素。
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const modalStack = [];

function focusableIn(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(node => node.getClientRects().length > 0);
}

function openModalLayer(backdrop, opener = null) {
  if (!backdrop) return;
  const existing = modalStack.find(layer => layer.backdrop === backdrop);
  if (existing) {
    // 详情已打开时再次从小组件进入：用新的显式 opener 覆盖旧值；
    // 未传 opener 时保持原值，不影响当天待办路径
    if (opener && document.contains(opener) && !backdrop.contains(opener)) existing.opener = opener;
    return;
  }
  // 显式 opener 优先；未传时沿用既有 activeElement（当天待办路径依赖）
  const active = opener && document.contains(opener) ? opener : document.activeElement;
  // 后开的弹窗必须压在先开的弹窗之上；仅靠 DOM 顺序会让详情挡住从详情打开的编辑表单
  const topZ = modalStack.reduce((max, layer) => Math.max(max, Number(layer.backdrop.style.zIndex) || 20), 20);
  modalStack.push({ backdrop, opener: active && !backdrop.contains(active) ? active : null });
  backdrop.style.zIndex = String(topZ + 1);
  const first = focusableIn(backdrop)[0];
  if (first) setTimeout(() => first.focus(), 0);
}

function closeModalLayer(backdrop) {
  const index = modalStack.findIndex(layer => layer.backdrop === backdrop);
  if (index === -1) return;
  const [layer] = modalStack.splice(index, 1);
  const next = modalStack[modalStack.length - 1];
  if (next) {
    const target = focusableIn(next.backdrop)[0];
    if (target) setTimeout(() => target.focus(), 0);
  } else if (layer.opener && document.contains(layer.opener)) {
    setTimeout(() => layer.opener.focus(), 0);
  }
}

function closeTopModal() {
  const layer = modalStack[modalStack.length - 1];
  if (!layer) return;
  const closers = {
    itemModal: closeItemModal,
    habitModal: closeHabitModal,
    dayItemsModal: closeDayItems,
    itemDetailModal: () => closeItemDetail(),
    confirmModal: () => resolveConfirmation(false)
  };
  closers[layer.backdrop.id]?.();
}

function mountIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(node => {
    if (node.querySelector('svg')) return;
    const name = node.dataset.icon;
    node.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`;
  });
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDate(value) {
  const [datePart, timePart = '23:59'] = String(value).split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

function daysUntil(value) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = parseDate(value);
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((targetDay - today) / 86400000);
}

function isCompleted(item) { return item.status === 'completed'; }
function isOverdue(item) { return !isCompleted(item) && parseDate(item.deadline) < new Date(); }
function isPending(item) { return !isCompleted(item); }

// 23:59 视为“当天截止”，不额外展示时刻
function timePartOf(value) {
  const timePart = String(value).split(' ')[1];
  return timePart && timePart !== '23:59' ? ` ${timePart}` : '';
}

function formatDate(value, includeYear = false) {
  const date = parseDate(value);
  return `${includeYear ? `${date.getFullYear()}年` : ''}${date.getMonth() + 1}月${date.getDate()}日${timePartOf(value)}`;
}

function timingLabel(item) {
  if (isCompleted(item)) return '已完成';
  const now = new Date();
  const elapsed = now - parseDate(item.deadline);
  if (elapsed > 0) {
    if (elapsed < 3600000) return `已逾期 ${Math.max(1, Math.round(elapsed / 60000))} 分钟`;
    if (elapsed < 86400000) return `已逾期 ${Math.max(1, Math.round(elapsed / 3600000))} 小时`;
    return `已逾期 ${Math.abs(daysUntil(item.deadline))} 天`;
  }
  const days = daysUntil(item.deadline);
  if (days === 0) return `今天${timePartOf(item.deadline)}到期`;
  if (days === 1) return `明天${timePartOf(item.deadline)}到期`;
  return `${days} 天后到期`;
}

function statusLabel(item) {
  const labels = {
    not_started: '未开始', in_progress: '进行中', not_completed: '未完成', completed: '已完成'
  };
  return labels[item.status] || item.status;
}

function nextStatus(item) {
  if (item.kind === 'assignment') {
    return { not_started: 'in_progress', in_progress: 'completed', completed: 'in_progress' }[item.status];
  }
  return item.status === 'completed' ? 'not_completed' : 'completed';
}

function nextStatusLabel(item) {
  return statusLabel({ status: nextStatus(item) });
}

function statusClass(item) {
  if (item.status === 'completed') return 'done';
  if (item.status === 'in_progress') return 'progress';
  return '';
}

function kindLabel(item) { return item.kind === 'assignment' ? '大作业' : '活动'; }

function matchesSearch(item) {
  if (!state.search) return true;
  const haystack = `${item.title} ${item.description || ''}`.toLowerCase();
  return haystack.includes(state.search.toLowerCase());
}

function sorted(items) {
  return [...items].sort((a, b) => {
    if (isCompleted(a) !== isCompleted(b)) return isCompleted(a) ? 1 : -1;
    return a.deadline.localeCompare(b.deadline) || b.id - a.id;
  });
}

function showToast(message, error = false) {
  const toast = $('#toast');
  $('#toastText').textContent = message;
  toast.classList.toggle('error', error);
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
}

async function execute(action, successMessage) {
  try {
    const result = await action();
    if (successMessage) showToast(successMessage);
    return result;
  } catch (error) {
    showToast(error.message || '操作失败', true);
    return null;
  }
}

function emptyState(title, description, buttonLabel = '', kind = '') {
  return `<div class="empty-state"><div><span class="empty-icon" data-icon="inbox"></span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p>${buttonLabel ? `<button class="primary-button empty-add" data-kind="${kind}"><span data-icon="plus"></span>${escapeHtml(buttonLabel)}</button>` : ''}</div></div>`;
}

function updateCurrentDate() {
  const now = new Date();
  $('#currentDate').textContent = `${now.getMonth() + 1} 月 ${now.getDate()} 日`;
  $('#currentWeekday').textContent = `${['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][now.getDay()]} · 第 ${getWeekNumber(now)} 周`;
}

function getWeekNumber(date) {
  const target = new Date(date.valueOf());
  const dayNumber = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNumber + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  return 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
}

function renderNavigation() {
  const actionable = state.items.filter(item => {
    const days = daysUntil(item.deadline);
    return isPending(item) && !isOverdue(item) && days >= 0 && days <= 7;
  }).length;
  $('#todayCount').textContent = actionable;
  $('#assignmentCount').textContent = state.items.filter(item => item.kind === 'assignment' && !isOverdue(item)).length;
  $('#activityCount').textContent = state.items.filter(item => item.kind === 'activity' && !isOverdue(item)).length;
  const overdueTotal = state.items.filter(isOverdue).length;
  $('#overdueCount').textContent = overdueTotal;
  $('#overdueCount').classList.toggle('zero', overdueTotal === 0);
  $('#habitCount').textContent = activeHabits().filter(habit => !habit.checked_today).length;
  const attachmentCount = state.items.reduce((total, item) => total + item.attachments.length, 0);
  $('#storageSummary').textContent = `${state.items.length} 条记录 · ${attachmentCount} 个附件`;
}

function statusButton(item) {
  const completed = isCompleted(item);
  const justCompleted = completed && item.id === state.justCompletedId;
  return `<button class="status-button ${completed ? 'completed' : ''} ${justCompleted ? 'just-completed' : ''}" data-action="status" data-id="${item.id}" title="切换状态" aria-label="将“${escapeHtml(item.title)}”标记为${escapeHtml(nextStatusLabel(item))}"><span class="status-ring">${completed ? `<svg class="icon sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m5 12 4 4L19 6"/></svg>` : ''}</span><span>${escapeHtml(statusLabel(item))}</span></button>`;
}

// 临近截止的分组标题：今天 / 明天 / 周X · M月D日
function dayGroupLabel(date, days) {
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  return `周${'日一二三四五六'.charAt(date.getDay())} · ${date.getMonth() + 1}月${date.getDate()}日`;
}

function renderToday() {
  const actionable = sorted(state.items.filter(item => {
    const days = daysUntil(item.deadline);
    return isPending(item) && !isOverdue(item) && days >= 0 && days <= 7 && matchesSearch(item);
  }));
  $('#todaySubtitle').textContent = actionable.length
    ? `${actionable.length} 个事项将在未来 7 天内到期。`
    : state.items.length ? '未来 7 天没有需要处理的事项。' : '添加事项后，这里会自动显示临期内容。';

  const list = $('#deadlineList');
  list.classList.toggle('entering', state.animateTodayRows);
  state.animateTodayRows = false;
  if (!actionable.length) {
    list.innerHTML = emptyState(state.items.length ? '暂无到期事项' : '从第一条截止日期开始', state.items.length ? '可以放心推进手头的事情。' : '添加大作业或活动，截止线会帮你集中追踪。', '新增事项', 'assignment');
  } else {
    let lastGroup = '';
    list.innerHTML = actionable.map(item => {
      const date = parseDate(item.deadline);
      const days = daysUntil(item.deadline);
      const group = dayGroupLabel(date, days);
      const header = group === lastGroup ? '' : `<div class="deadline-group">${group}</div>`;
      lastGroup = group;
      const badgeClass = days <= 1 ? 'warning' : 'progress';
      const typeBadge = item.kind === 'assignment' ? `<span class="badge ${item.work_type === 'team' ? 'team' : 'personal'}">${item.work_type === 'team' ? '团队' : '个人'}</span>` : '<span class="badge progress">活动</span>';
      return `${header}<article class="deadline-row">
        <div class="date-box"><strong>${date.getDate()}</strong>${date.getMonth() + 1}月</div>
        <div class="row-copy"><div class="row-title"><strong>${escapeHtml(item.title)}</strong>${typeBadge}<span class="badge ${badgeClass}">${escapeHtml(timingLabel(item))}</span></div><div class="row-sub">${escapeHtml(item.description || `${kindLabel(item)} · 暂无补充说明`)}</div></div>
        <div class="row-actions">${statusButton(item)}<button class="icon-button" data-action="edit" data-id="${item.id}" title="编辑" aria-label="编辑“${escapeHtml(item.title)}”"><span data-icon="edit"></span></button><button class="icon-button" data-action="delete" data-id="${item.id}" title="删除" aria-label="删除“${escapeHtml(item.title)}”"><span data-icon="trash"></span></button></div>
      </article>`;
    }).join('');
    // CSP 禁止内联 style 属性，交错延迟需经 CSSOM 写入
    list.querySelectorAll('.deadline-row').forEach((row, index) => row.style.setProperty('--row-delay', `${Math.min(index * 45, 200)}ms`));
  }

  renderTodayOverview();
  renderWeekStrip();
}

// 今天页顶部概览：三个数字沿用导航角标的口径，不受搜索框过滤；有逾期时同步显示提醒条
function renderTodayOverview() {
  const upcoming = state.items.filter(item => isPending(item) && !isOverdue(item) && daysUntil(item.deadline) >= 0 && daysUntil(item.deadline) <= 7);
  const dueToday = upcoming.filter(item => daysUntil(item.deadline) === 0).length;
  const overdueTotal = state.items.filter(isOverdue).length;
  $('#kpiToday').textContent = dueToday;
  $('#kpiWeek').textContent = upcoming.length;
  $('#kpiOverdueCount').textContent = overdueTotal;
  $('#kpiOverdue').classList.toggle('has-overdue', overdueTotal > 0);
  const alert = $('#overdueAlert');
  alert.classList.toggle('hidden', overdueTotal === 0);
  alert.textContent = overdueTotal ? `有 ${overdueTotal} 项已逾期，点击去处理` : '';
}

function renderWeekStrip() {
  const labels = ['日', '一', '二', '三', '四', '五', '六'];
  const today = new Date();
  const dates = Array.from({ length: 7 }, (_, index) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + index));
  $('#weekStrip').innerHTML = dates.map((date, index) => {
    const dateValue = localDate(date);
    const hasItems = state.items.some(item => isPending(item) && !isOverdue(item) && item.deadline.slice(0, 10) === dateValue);
    return `<button type="button" class="week-day ${index === 0 ? 'today' : ''} ${hasItems ? 'has-item' : ''}" aria-label="${date.getMonth() + 1}月${date.getDate()}日 周${labels[date.getDay()]}${hasItems ? '，查看当天待办' : '，没有待办'}" ${hasItems ? `data-day="${dateValue}" title="查看当天待办"` : 'disabled'}>${labels[date.getDay()]}<strong>${date.getDate()}</strong></button>`;
  }).join('');
}

function fillItemsDialog(title, subtitle, items) {
  $('#dayItemsTitle').textContent = title;
  $('#dayItemsSubtitle').textContent = subtitle;
  $('#dayItemsList').innerHTML = items.map(item => `<button type="button" class="day-item-button" data-detail-id="${item.id}">
    <span class="day-item-kind" data-icon="${item.kind === 'assignment' ? 'book' : 'ticket'}"></span>
    <span class="day-item-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.description || `${kindLabel(item)} · 暂无补充说明`)}</span></span>
    <span class="day-item-arrow" data-icon="external"></span>
  </button>`).join('');
  mountIcons($('#dayItemsList'));
  $('#dayItemsModal').classList.add('open');
  $('#dayItemsModal').setAttribute('aria-hidden', 'false');
  openModalLayer($('#dayItemsModal'));
}

function openDayItems(dateValue) {
  const items = sorted(state.items.filter(item => isPending(item) && !isOverdue(item) && item.deadline.slice(0, 10) === dateValue));
  if (!items.length) return;
  fillItemsDialog(`${formatDate(dateValue, true)}待办`, `共 ${items.length} 个未完成事项`, items);
}

// 「查看全部」展开的是 7 天内的全部事项，大作业与活动合并在同一份清单里
function openAllUpcoming() {
  const items = sorted(state.items.filter(item => isPending(item) && !isOverdue(item) && daysUntil(item.deadline) >= 0 && daysUntil(item.deadline) <= 7 && matchesSearch(item)));
  if (!items.length) return;
  const assignmentCount = items.filter(item => item.kind === 'assignment').length;
  const activityCount = items.length - assignmentCount;
  const subtitle = assignmentCount && activityCount
    ? `共 ${items.length} 个未完成事项 · 大作业 ${assignmentCount} · 活动 ${activityCount}`
    : `共 ${items.length} 个未完成事项`;
  fillItemsDialog('未来 7 天待办', subtitle, items);
}

function closeDayItems() {
  $('#dayItemsModal').classList.remove('open');
  $('#dayItemsModal').setAttribute('aria-hidden', 'true');
  closeModalLayer($('#dayItemsModal'));
}

function detailActionsHtml(item) {
  return `<button type="button" class="secondary-button" data-action="edit" data-id="${item.id}"><span data-icon="edit"></span>编辑内容</button>`;
}

function detailStatusOptions(item) {
  return item.kind === 'assignment' ? ['not_started', 'in_progress', 'completed'] : ['not_completed', 'completed'];
}

function openItemDetail(item, { origin = 'day', opener = null } = {}) {
  if (!item) return;
  const detailWasTop = modalStack[modalStack.length - 1]?.backdrop === $('#itemDetailModal');
  state.detailItemId = item.id;
  state.detailOrigin = origin;
  state.detailOpener = opener;
  $('#detailTitle').textContent = item.title;
  $('#detailSubtitle').textContent = `${kindLabel(item)} · ${formatDate(item.deadline, true)}`;
  const typeBadge = item.kind === 'assignment' ? `<span class="badge ${item.work_type === 'team' ? 'team' : 'personal'}">${item.work_type === 'team' ? '团队' : '个人'}</span>` : '<span class="badge progress">活动</span>';
  const timingClass = daysUntil(item.deadline) <= 1 ? 'warning' : 'progress';
  const statusOptions = detailStatusOptions(item)
    .map(status => `<option value="${status}"${status === item.status ? ' selected' : ''}>${escapeHtml(statusLabel({ status }))}</option>`)
    .join('');
  const attachments = item.attachments.length ? `<div class="detail-attachments"><strong>要求附件</strong>${item.attachments.map(file => `<button type="button" class="detail-attachment" data-detail-attachment="${file.id}"><span data-icon="file"></span><span class="detail-attachment-copy"><strong>${escapeHtml(file.original_name)}</strong><span>${formatSize(file.size)}</span></span><span data-icon="external"></span></button>`).join('')}</div>` : '';
  $('#itemDetailBody').innerHTML = `<div class="detail-badges">${typeBadge}<span class="badge ${statusClass(item)}">${escapeHtml(statusLabel(item))}</span><span class="badge ${timingClass}">${escapeHtml(timingLabel(item))}</span></div>
    <div class="detail-grid"><div class="detail-block"><span>截止时间</span><strong>${formatDate(item.deadline, true)}</strong></div><div class="detail-block"><span>当前状态</span><select class="detail-status-select" id="detailStatusSelect" data-id="${item.id}" aria-label="修改当前状态">${statusOptions}</select></div><div class="detail-block full"><span>要求说明</span><strong>${escapeHtml(item.description || '暂无补充说明')}</strong></div></div>${attachments}`;
  mountIcons($('#itemDetailBody'));
  $('#detailFooter').innerHTML = detailActionsHtml(item);
  mountIcons($('#detailFooter'));
  // confirmModal 在 DOM 中晚于 itemDetailModal，不先收起会压在详情上方
  if (origin === 'widget' && state.confirmResolver) resolveConfirmation(false);
  $('#dayItemsModal').classList.remove('open');
  $('#dayItemsModal').setAttribute('aria-hidden', 'true');
  $('#itemDetailModal').classList.add('open');
  $('#itemDetailModal').setAttribute('aria-hidden', 'false');
  closeModalLayer($('#dayItemsModal'));
  $('#detailBackButton').classList.toggle('hidden', origin !== 'day');
  openModalLayer($('#itemDetailModal'), opener);
  // 详情原本就是栈顶时，重渲染后主动把焦点放回第一个可聚焦元素；
  // 否则不抢焦点，由 openModalLayer 的既有逻辑处理首次打开
  if (detailWasTop) {
    const first = focusableIn($('#itemDetailModal'))[0];
    if (first) setTimeout(() => first.focus(), 0);
  }
}

function closeItemDetail(returnToDay = false) {
  $('#itemDetailModal').classList.remove('open');
  $('#itemDetailModal').setAttribute('aria-hidden', 'true');
  closeModalLayer($('#itemDetailModal'));
  state.detailItemId = null;
  state.detailOrigin = 'day';
  state.detailOpener = null;
  if (returnToDay) {
    $('#dayItemsModal').classList.add('open');
    $('#dayItemsModal').setAttribute('aria-hidden', 'false');
    openModalLayer($('#dayItemsModal'));
  }
}

function refreshOpenItemDetail() {
  if (!state.detailItemId || !$('#itemDetailModal').classList.contains('open')) return;
  const item = state.items.find(entry => entry.id === state.detailItemId);
  if (!item) {
    closeItemDetail();
    return;
  }
  // 从小组件进入时，编辑事项状态/截止时间后背景页也要跟着换到正确列表
  if (state.detailOrigin === 'widget') {
    const page = routePageForItem(item);
    if (state.currentPage !== page) {
      resetPageFilter(page);
      switchPage(page);
      renderAll();
    }
  }
  openItemDetail(item, { origin: state.detailOrigin, opener: state.detailOpener });
}

function renderAssignments() {
  let items = state.items.filter(item => item.kind === 'assignment' && !isOverdue(item) && matchesSearch(item));
  if (state.assignmentFilter !== 'all') items = items.filter(item => item.status === state.assignmentFilter);
  items = sorted(items);
  $('#assignmentResultCount').textContent = `共 ${items.length} 项`;
  const list = $('#assignmentList');
  if (!items.length) {
    list.innerHTML = `<div class="table-empty">${emptyState('还没有符合条件的大作业', state.search || state.assignmentFilter !== 'all' ? '调整搜索或筛选条件后再试。' : '添加课程任务并记录它的截止日期。', state.search || state.assignmentFilter !== 'all' ? '' : '新增大作业', 'assignment')}</div>`;
    return;
  }
  list.innerHTML = items.map(item => `<article class="table-row ${isCompleted(item) ? 'completed' : ''}">
    <div class="table-title"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.description || (item.attachments.length ? `${item.attachments.length} 个附件` : '暂无要求说明'))}</span></div>
    <div><span class="badge ${item.work_type === 'team' ? 'team' : 'personal'}">${item.work_type === 'team' ? '团队' : '个人'}</span></div>
    <div class="deadline-cell"><strong>${formatDate(item.deadline)}</strong><span>${timingLabel(item)}</span></div>
    <div><span class="badge ${statusClass(item)}">${statusLabel(item)}</span></div>
    <div class="table-actions"><button class="icon-button" data-action="edit" data-id="${item.id}" title="编辑" aria-label="编辑“${escapeHtml(item.title)}”"><span data-icon="edit"></span></button><button class="icon-button" data-action="delete" data-id="${item.id}" title="删除" aria-label="删除“${escapeHtml(item.title)}”"><span data-icon="trash"></span></button></div>
  </article>`).join('');
}

function renderActivities() {
  let items = state.items.filter(item => item.kind === 'activity' && !isOverdue(item) && matchesSearch(item));
  if (state.activityFilter !== 'all') items = items.filter(item => item.status === state.activityFilter);
  items = sorted(items);
  $('#activityResultCount').textContent = `共 ${items.length} 项`;
  const list = $('#activityList');
  if (!items.length) {
    list.innerHTML = `<div class="table-empty">${emptyState('还没有符合条件的活动', state.search || state.activityFilter !== 'all' ? '调整搜索或筛选条件后再试。' : '记录已经决定参加的活动。', state.search || state.activityFilter !== 'all' ? '' : '新增活动', 'activity')}</div>`;
    return;
  }
  list.innerHTML = items.map(item => `<article class="table-row activity ${isCompleted(item) ? 'completed' : ''}">
    <div class="table-title"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.description || '暂无补充说明')}</span></div>
    <div class="deadline-cell"><strong>${formatDate(item.deadline)}</strong><span>${timingLabel(item)}</span></div>
    <div>${statusButton(item)}</div>
    <div class="table-actions"><button class="icon-button" data-action="edit" data-id="${item.id}" title="编辑" aria-label="编辑“${escapeHtml(item.title)}”"><span data-icon="edit"></span></button><button class="icon-button" data-action="delete" data-id="${item.id}" title="删除" aria-label="删除“${escapeHtml(item.title)}”"><span data-icon="trash"></span></button></div>
  </article>`).join('');
}

function renderOverdue() {
  const items = sorted(state.items.filter(item => isOverdue(item) && matchesSearch(item)));
  $('#overdueResultCount').textContent = `共 ${items.length} 项`;
  const list = $('#overdueList');
  if (!items.length) {
    list.innerHTML = `<div class="table-empty">${emptyState('太棒了，没有逾期事项', '超过截止时刻还未完成的事项会集中出现在这里。')}</div>`;
    return;
  }
  list.innerHTML = items.map(item => {
    const typeBadge = item.kind === 'assignment' ? `<span class="badge ${item.work_type === 'team' ? 'team' : 'personal'}">${item.work_type === 'team' ? '团队' : '个人'}</span>` : '<span class="badge progress">活动</span>';
    return `<article class="table-row overdue">
    <div class="table-title"><div class="row-title"><strong>${escapeHtml(item.title)}</strong>${typeBadge}</div><span>${escapeHtml(item.description || '暂无补充说明')}</span></div>
    <div class="deadline-cell overdue"><strong>${formatDate(item.deadline)}</strong><span>${timingLabel(item)}</span></div>
    <div>${statusButton(item)}</div>
    <div class="table-actions"><button class="icon-button" data-action="edit" data-id="${item.id}" title="编辑" aria-label="编辑“${escapeHtml(item.title)}”"><span data-icon="edit"></span></button><button class="icon-button" data-action="delete" data-id="${item.id}" title="删除" aria-label="删除“${escapeHtml(item.title)}”"><span data-icon="trash"></span></button></div>
  </article>`;
  }).join('');
}

function renderStats() {
  const assignments = state.items.filter(item => item.kind === 'assignment');
  const activities = state.items.filter(item => item.kind === 'activity');
  const assignmentDone = assignments.filter(isCompleted).length;
  const activityDone = activities.filter(isCompleted).length;
  const assignmentRate = assignments.length ? Math.round(assignmentDone / assignments.length * 100) : 0;
  const activityRate = activities.length ? Math.round(activityDone / activities.length * 100) : 0;
  const circumference = 289;

  $('#assignmentStatsCaption').textContent = assignments.length ? `共 ${assignments.length} 项` : '暂无记录';
  $('#activityStatsCaption').textContent = activities.length ? `共 ${activities.length} 项` : '暂无记录';
  $('#assignmentCompletionRate').textContent = `${assignmentRate}%`;
  $('#activityCompletionRate').textContent = `${activityRate}%`;
  $('.assignment-donut').style.strokeDasharray = `${circumference * assignmentRate / 100} ${circumference}`;
  $('.activity-donut').style.strokeDasharray = `${circumference * activityRate / 100} ${circumference}`;
  $('#notStartedStat').textContent = assignments.filter(item => item.status === 'not_started').length;
  $('#inProgressStat').textContent = assignments.filter(item => item.status === 'in_progress').length;
  $('#assignmentDoneStat').textContent = assignmentDone;
  $('#assignmentOverdueStat').textContent = assignments.filter(isOverdue).length;
  $('#activityTotalStat').textContent = activities.length;
  $('#activityDoneStat').textContent = activityDone;
  $('#activityPendingStat').textContent = activities.length - activityDone;

  const active = activeHabits();
  const habitDone = active.filter(habit => habit.checked_today).length;
  // 与月历口径对齐：分母是今天的应打卡数、分子是今天已打卡数；累计打卡算上已归档任务的历史（终身口径）
  $('#habitTodayStat').textContent = `${habitDone} / ${active.length}`;
  $('#habitAllCheckinsStat').textContent = state.habits.reduce((sum, habit) => sum + habit.total, 0);
  renderHabitCalendar();

  const risks = sorted(state.items.filter(item => isPending(item) && !isOverdue(item) && daysUntil(item.deadline) <= 7)).slice(0, 6);
  $('#riskList').innerHTML = risks.length ? risks.map(item => {
    const days = daysUntil(item.deadline);
    const tone = days <= 0 ? 'danger' : days <= 1 ? 'warning' : '';
    return `<div class="risk-item ${tone}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(kindLabel(item))} · ${escapeHtml(timingLabel(item))}</span></div>`;
  }).join('') : emptyState('当前没有截止风险', '未来 7 天内到期的事项会显示在这里，逾期事项请前往「逾期」页查看。');
}

// 月度打卡日历：caption / 月率 / 格子用同一份响应填充；搜索击键等会频繁触发 renderStats，
// 请求序号防止旧响应晚到覆盖新数据
let habitCalendarSeq = 0;

async function renderHabitCalendar() {
  const seq = ++habitCalendarSeq;
  const data = await api.habits.calendar().catch(() => null);
  if (!data || seq !== habitCalendarSeq) return;
  // caption 与格子用同一份响应：既避免和 renderStats 的旧 state 不同步，也避免「暂无任务」与有数据同屏
  const caption = $('#habitStatsCaption');
  if (data.activeTasks > 0) caption.textContent = `${data.year} 年 ${data.month} 月 · ${data.activeTasks} 个任务`;
  else if (data.monthExpected > 0) caption.textContent = `${data.year} 年 ${data.month} 月 · 任务已全部归档`;
  else caption.textContent = '暂无任务';
  renderHabitRate(data);
  $('#habitCalendarGrid').innerHTML = habitCalendarCells(data);
}

// 本月打卡率：主指标 + 口径明细。分子分母都摊开写（含次数单位与统计区间），让百分比可以自己复核
function renderHabitRate(data) {
  const value = $('#habitMonthRate');
  const block = $('#habitRateBlock');
  const meta = $('#habitMonthMeta');
  const range = $('#habitRateRange');
  const fill = $('#habitMonthFill');
  if (data.monthRate === null) {
    value.textContent = '—';
    value.classList.add('is-empty');
    range.textContent = '';
    meta.textContent = '本月还没有应打卡的日子';
    fill.style.width = '0%';
    block.title = '创建任务后，这里会按天统计本月打卡率。';
    return;
  }
  const { summary } = data;
  // 统计区间取「真正有应打卡任务的第一天 ~ 已聚合的最后一天」，而不是死写「1 日」：
  // 任务月中才建时，1 号~建仓日没有考核义务，写成「1–30 日」会让分母 8 次看起来像 30 次
  const counted = data.days.filter(day => day.expected > 0);
  const firstDay = counted.length ? Number(counted[0].date.slice(8)) : 0;
  const lastDay = counted.length ? Number(counted[counted.length - 1].date.slice(8)) : 0;
  const rangeText = !firstDay ? '' : firstDay === lastDay ? `${data.month} 月 ${firstDay} 日` : `${data.month} 月 ${firstDay}–${lastDay} 日`;
  value.classList.remove('is-empty');
  value.textContent = `${data.monthRate}%`;
  range.textContent = rangeText;
  meta.textContent = `已打卡 ${data.monthChecked} 次 / 应打卡 ${data.monthExpected} 次`;
  fill.style.width = `${data.monthRate}%`;
  block.title = `本月打卡率 = 已打卡 ${data.monthChecked} 次 ÷ 应打卡 ${data.monthExpected} 次`
    + `（只统计有任务在岗的日子${rangeText ? `，本月为 ${rangeText} 共 ${counted.length} 天` : ''}）。`
    + ` 其中全部完成 ${summary.fullDays} 天、部分完成 ${summary.partialDays} 天、未打卡 ${summary.missedDays} 天。`;
}

function habitCalendarCells(data) {
  const byDate = new Map(data.days.map(day => [day.date, day]));
  const todayValue = localDate();
  const first = new Date(data.year, data.month - 1, 1);
  const daysInMonth = new Date(data.year, data.month, 0).getDate();
  const monthLabel = `${data.month}月`;
  const levelLabels = ['未打卡', '部分完成', '全部完成'];
  const cells = [];
  const push = (dateValue, info, extraClass) => {
    const dayNumber = Number(dateValue.slice(8));
    const classes = ['habit-day'];
    let title = '';
    if (extraClass) classes.push(extraClass);
    if (info && info.level !== null) {
      classes.push(`level-${info.level}`);
      // 今天是进行中的一天：还没结束就写「未打卡」会误导读数
      const ongoing = info.checked === 0 && dateValue === todayValue ? '今天还没打卡' : levelLabels[info.level];
      title = `${monthLabel}${dayNumber}日 · ${ongoing}（已打卡 ${info.checked} / ${info.expected}）`;
    } else if (info && info.stray) {
      // 任务创建前的补卡：不计入月率，但要让用户看见自己确实打过
      classes.push('stray');
      title = `${monthLabel}${dayNumber}日 · 补卡（任务当天尚未创建，不计入打卡率）`;    } else if (!extraClass) {
      // 有任务、但这天还没有任务在岗（任务尚未创建）：只留日号，并解释为什么没上色
      classes.push('no-task');
      title = `${monthLabel}${dayNumber}日 · 当天没有应打卡的任务`;
    }
    if (dateValue === todayValue) classes.push('today');
    // 有 title 才挂 role="img"（否则读屏会播报一个无名图形）
    const attrs = title ? ` role="img" title="${title}" aria-label="${title}"` : '';
    cells.push(`<span class="${classes.join(' ')}"${attrs}>${dayNumber}</span>`);
  };
  // 周日首（与日记页月历一致）：getDay() 即月首前补位数，月末补齐整行
  for (let back = first.getDay(); back > 0; back -= 1) push(localDate(new Date(data.year, data.month - 1, 1 - back)), null, 'other');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateValue = localDate(new Date(data.year, data.month - 1, day));
    push(dateValue, byDate.get(dateValue) || null, byDate.has(dateValue) ? '' : 'future');
  }
  const remainder = (first.getDay() + daysInMonth) % 7;
  for (let forward = 1; remainder && forward <= 7 - remainder; forward += 1) push(localDate(new Date(data.year, data.month - 1, daysInMonth + forward)), null, 'other');
  return cells.join('');
}

function renderAll() {
  renderNavigation();
  renderToday();
  renderAssignments();
  renderActivities();
  renderOverdue();
  renderStats();
  mountIcons();
}

async function refreshItems() {
  const items = await execute(() => api.items.list());
  if (items) {
    state.items = items;
    renderAll();
    refreshOpenItemDetail();
  }
}

// ---------- 小组件跳转 ----------
let openItemRequestSeq = 0;

function syncSegmentedFilter(containerSelector, filter) {
  $$(`${containerSelector} button`).forEach(button => {
    const active = button.dataset.filter === filter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function resetPageFilter(page) {
  if (page === 'assignments') {
    state.assignmentFilter = 'all';
    syncSegmentedFilter('#assignmentFilters', 'all');
  } else if (page === 'activities') {
    state.activityFilter = 'all';
    syncSegmentedFilter('#activityFilters', 'all');
  }
}

function routePageForItem(item) {
  if (isOverdue(item)) return 'overdue';
  return item.kind === 'assignment' ? 'assignments' : 'activities';
}

async function openItemById(id) {
  // 连续点击多行时以最后一次请求为准；
  // 直接拉取而不是复用 refreshItems()：后者失败时只 toast，会留下旧 state.items
  const seq = ++openItemRequestSeq;
  const items = await execute(() => api.items.list());
  if (seq !== openItemRequestSeq || !items) return;

  state.items = items;
  // 拉取成功后再清搜索，避免失败时出现“输入框已空、列表仍是旧筛选结果”
  state.search = '';
  $('#searchInput').value = '';

  const item = items.find(entry => entry.id === Number(id));
  if (!item) {
    showToast('事项已不存在', true);
    renderAll();
    return;
  }

  const page = routePageForItem(item);
  resetPageFilter(page);
  switchPage(page);
  renderAll();
  openItemDetail(item, { origin: 'widget', opener: $('.nav-item.active') });
}

// ---------- 日记 ----------
// 日记不参与 renderAll 的全量重渲染，仅在进入日记页时懒加载

function setDiaryStatus(kind) {
  const element = $('#diaryStatus');
  const texts = { empty: '输入内容后自动保存', typing: '编辑中，即将自动保存', saved: '已自动保存', failed: '保存失败，请重试' };
  element.textContent = texts[kind] || '';
  element.classList.toggle('saved', kind === 'saved');
  element.classList.toggle('failed', kind === 'failed');
}

function updateDiaryAux() {
  const content = $('#diaryContent').value;
  $('#diaryCount').textContent = `${content.length} 字`;
  $('#diaryDeleteButton').disabled = !content;
}

async function loadDiaryDates() {
  const dates = await execute(() => api.diary.listDates());
  if (dates) state.diaryDates = new Set(dates);
}

function renderDiaryCalendar() {
  const { year, month } = state.diaryView;
  $('#diaryMonthLabel').textContent = `${year}年${month + 1}月`;
  const firstWeekday = new Date(year, month, 1).getDay();
  const dayCount = new Date(year, month + 1, 0).getDate();
  const todayValue = localDate();
  const cells = [];
  for (let index = 0; index < firstWeekday; index += 1) cells.push('<span class="diary-cell blank"></span>');
  for (let day = 1; day <= dayCount; day += 1) {
    const dateValue = localDate(new Date(year, month, day));
    const classes = ['diary-cell'];
    if (dateValue === todayValue) classes.push('today');
    if (dateValue === state.diaryDate) classes.push('selected');
    if (state.diaryDates.has(dateValue)) classes.push('has-entry');
    cells.push(`<button type="button" class="${classes.join(' ')}" data-diary-date="${dateValue}">${day}</button>`);
  }
  $('#diaryGrid').innerHTML = cells.join('');
}

async function flushDiarySave() {
  if (state.diarySaveTimer) { clearTimeout(state.diarySaveTimer); state.diarySaveTimer = null; }
  if (!state.diaryDate) return;
  const content = $('#diaryContent').value;
  if (content === state.diarySavedContent) return;
  const dateValue = state.diaryDate;
  const result = await execute(() => api.diary.save(dateValue, content));
  if (!result) { setDiaryStatus('failed'); return; }
  state.diarySavedContent = content;
  const hadEntry = state.diaryDates.has(dateValue);
  const hasEntry = content !== '';
  if (hadEntry !== hasEntry) {
    if (hasEntry) state.diaryDates.add(dateValue);
    else state.diaryDates.delete(dateValue);
    if (state.currentPage === 'diary') renderDiaryCalendar();
  }
  if (state.diaryDate === dateValue) setDiaryStatus(content ? 'saved' : 'empty');
}

function scheduleDiarySave() {
  clearTimeout(state.diarySaveTimer);
  state.diarySaveTimer = setTimeout(flushDiarySave, 500);
}

async function openDiaryDate(dateValue) {
  state.diaryDate = dateValue;
  renderDiaryCalendar();
  const date = parseDate(dateValue);
  $('#diaryDateLabel').textContent = `${date.getMonth() + 1}月${date.getDate()}日`;
  $('#diaryWeekdayLabel').textContent = `周${'日一二三四五六'.charAt(date.getDay())}`;
  const entry = await execute(() => api.diary.get(dateValue));
  if (state.diaryDate !== dateValue) return;
  const content = entry?.content || '';
  $('#diaryContent').value = content;
  state.diarySavedContent = content;
  updateDiaryAux();
  setDiaryStatus(content ? 'saved' : 'empty');
}

async function selectDiaryDate(dateValue) {
  await flushDiarySave();
  await openDiaryDate(dateValue);
}

function shiftDiaryMonth(delta) {
  let { year, month } = state.diaryView;
  month += delta;
  if (month < 0) { month = 11; year -= 1; }
  if (month > 11) { month = 0; year += 1; }
  state.diaryView = { year, month };
  renderDiaryCalendar();
}

async function enterDiaryPage() {
  await loadDiaryDates();
  const base = state.diaryDate ? parseDate(state.diaryDate) : new Date();
  state.diaryView = { year: base.getFullYear(), month: base.getMonth() };
  await openDiaryDate(state.diaryDate || localDate());
}

function switchPage(page) {
  const previous = state.currentPage;
  if (previous === 'diary' && page !== 'diary') flushDiarySave();
  if (previous === 'assistant' && page !== 'assistant') leaveAssistantPage();
  state.currentPage = page;
  const inWorkspace = WORKSPACE_PAGES.includes(page);
  if (inWorkspace) state.lastWorkspacePage = page;
  $$('.nav-item[data-page]').forEach(button => {
    const active = button.dataset.page === page;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const workspaceNav = $('.nav-item[data-nav="workspace"]');
  workspaceNav.classList.toggle('active', inWorkspace);
  if (inWorkspace) workspaceNav.setAttribute('aria-current', 'page');
  else workspaceNav.removeAttribute('aria-current');
  $('#workspaceTabs').classList.toggle('hidden', !inWorkspace);
  $$('.ws-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.page === page));
  $$('.page').forEach(view => view.classList.toggle('active', view.dataset.pageView === page));
  $('#searchBox').classList.toggle('hidden', page === 'settings' || page === 'diary' || page === 'habits' || page === 'assistant');
  if (page === 'diary') enterDiaryPage();
  if (page === 'assistant' && previous !== 'assistant') enterAssistantPage();
}

// ---------- 助手 ----------

function normalizeAiProtocol(value) {
  return value === 'anthropic' ? 'anthropic' : 'openai';
}

async function refreshAssistantConfig() {
  let settings;
  try {
    settings = await api.settings.get();
  } catch {
    return;
  }
  if (!settings || !settings.ai) return;
  state.ai = {
    ...state.ai,
    ...settings.ai,
    configured: Boolean(settings.ai.configured),
    protocol: normalizeAiProtocol(settings.ai.protocol),
    endpoint: typeof settings.ai.endpoint === 'string' ? settings.ai.endpoint : '',
    model: typeof settings.ai.model === 'string' ? settings.ai.model : '',
    keyMask: typeof settings.ai.keyMask === 'string' ? settings.ai.keyMask : '',
    editingKey: state.ai.editingKey
  };
}

function renderAssistantConfigWarning() {
  const ready = Boolean(state.ai && state.ai.configured);
  const warning = $('#assistantConfigWarning');
  warning.dataset.config = ready ? 'ready' : 'missing';
  warning.classList.toggle('hidden', ready);
}

async function enterAssistantPage() {
  await refreshAssistantConfig();
  if (state.currentPage !== 'assistant') return;
  renderAssistantConfigWarning();
  $('#assistantInput').value = state.assistant.input;
  renderAssistant();
  renderAssistantControls();
}

function leaveAssistantPage() {
  state.assistant.seq += 1;
  if (state.assistant.executing === false) state.assistant.loading = false;
  state.assistant.view = null;
  state.assistant.records = [];
  state.assistant.dirty = false;
  state.assistant.error = null;
  $('#assistantResult').innerHTML = '';
  const records = $('#assistantRecords');
  records.innerHTML = '';
  records.classList.add('hidden');
  $('#assistantInput').disabled = false;
  $('#assistantSubmit').disabled = false;
  $('#assistantRetry').disabled = false;
}

function assistantTimeLabel() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function splitAssistantDeadline(value) {
  if (!value) return { date: '', time: '' };
  const [date, time = ''] = String(value).split(' ');
  return { date, time };
}

function joinAssistantDeadline(date, time) {
  if (!date) return null;
  return `${date} ${time || '23:59'}`;
}

function assistantDefaultStatus(kind) {
  return kind === 'assignment' ? 'not_started' : 'not_completed';
}

function isAssistantStatusAllowed(kind, status) {
  return (ASSISTANT_STATUS_OPTIONS[kind] || []).some(([value]) => value === status);
}

function assistantStatusOptionsHtml(kind, status) {
  const head = status === null ? '<option value="" selected>请选择状态</option>' : '';
  const options = (ASSISTANT_STATUS_OPTIONS[kind] || [])
    .map(([value, label]) => `<option value="${value}"${status === value ? ' selected' : ''}>${label}</option>`)
    .join('');
  return head + options;
}

function assistantWorkTypeSelectHtml(value) {
  const current = value || 'personal';
  return ASSISTANT_WORK_TYPE_OPTIONS
    .map(([entry, label]) => `<option value="${entry}"${current === entry ? ' selected' : ''}>${label}</option>`)
    .join('');
}

function assistantKindLabel(kind) {
  return kind === 'assignment' ? '大作业' : '活动';
}

function assistantStatusLabel(status) {
  if (status === null || status === undefined) return '请选择状态';
  const labels = { not_started: '未开始', in_progress: '进行中', not_completed: '未完成', completed: '已完成' };
  return labels[status] || status;
}

function normalizeAssistantView(result) {
  const view = {
    intent: result.intent,
    message: typeof result.message === 'string' ? result.message : '',
    omittedCount: Number(result.omittedCount) || 0
  };
  if (result.intent === 'create') {
    const create = result.create || {};
    view.create = {
      candidates: (create.candidates || []).map(candidate => ({ ...candidate, removed: false, statusAdjusted: Boolean(candidate.statusAdjusted) })),
      ignored: create.ignored || []
    };
  } else if (result.intent === 'update') {
    const update = result.update || {};
    const targets = (update.targets || []).map(target => {
      const existing = state.items.find(item => item.id === target.id);
      return {
        ...target,
        description: existing && typeof existing.description === 'string' ? existing.description : '',
        work_type: existing && existing.work_type ? existing.work_type : null
      };
    });
    view.update = { ...update, applyToId: update.applyToId, targets, draft: null };
    if (view.update.applyToId !== null) {
      const target = targets.find(item => item.id === view.update.applyToId);
      if (target) view.update.draft = initializeUpdateDraft(view.update, target);
    }
  } else if (result.intent === 'delete') {
    view.delete = { targets: ((result.delete || {}).targets || []).map(target => ({ ...target })) };
  } else if (result.intent === 'cleanup') {
    const cleanup = result.cleanup || {};
    view.cleanup = { ...cleanup, targets: (cleanup.targets || []).map(target => ({ ...target })) };
  } else if (result.intent === 'query') {
    view.query = result.query;
  }
  return view;
}

function assistantSummaryHtml(view) {
  let html = '';
  if (view.message.trim() !== '') html += `<p class="assistant-summary">${escapeHtml(view.message)}</p>`;
  if (view.omittedCount > 0) {
    html += `<p class="assistant-omitted">本次只向模型发送了 ${ASSISTANT_SUMMARY_LIMIT} 条事项，另有 ${view.omittedCount} 条未发送；如需修改被省略的事项，请到对应列表操作。</p>`;
  }
  return html;
}

function renderAssistant() {
  let html;
  if (state.assistant.loading) {
    html = `<div class="assistant-placeholder">${ASSISTANT_LOADING_TEXT}</div>`;
  } else if (state.assistant.error) {
    html = renderAssistantError();
  } else if (state.assistant.view) {
    const view = state.assistant.view;
    html = assistantSummaryHtml(view);
    if (view.intent === 'create') html += renderCreatePlan(view.create);
    else if (view.intent === 'update') html += renderUpdatePlan(view.update);
    else if (view.intent === 'delete') html += renderTargetPlan(view.delete, 'delete');
    else if (view.intent === 'cleanup') html += renderTargetPlan(view.cleanup, 'cleanup');
    else if (view.intent === 'query') html += renderQueryResult(view.query);
  } else {
    html = `<div class="assistant-placeholder">${ASSISTANT_DEFAULT_PLACEHOLDER}</div>`;
  }
  const container = $('#assistantResult');
  container.innerHTML = html;
  mountIcons(container);
  renderAssistantRecords();
}

function renderAssistantError() {
  const error = state.assistant.error;
  const message = error.message || '处理失败，请重试';
  const settingsButton = error.code === 'not_configured'
    ? '<button class="secondary-button" data-assistant-action="go-settings">前往设置</button>'
    : '';
  return `<div class="assistant-error"><strong>无法完成解析</strong><p>${escapeHtml(message)}</p>${settingsButton}</div>`;
}

function renderCreatePlan(plan) {
  let html = '';
  if (plan.ignored.length) {
    html += `<div class="assistant-ignored">${plan.ignored.map(entry => `<div class="assistant-ignored-item">${entry.text === '' ? '' : `<span>${escapeHtml(entry.text)}</span>`}<em>${escapeHtml(entry.reason)}</em></div>`).join('')}</div>`;
  }
  const visible = plan.candidates.filter(candidate => !candidate.removed);
  if (!visible.length) return `${html}<div class="assistant-empty">没有可写入的候选。</div>`;
  const count = assistantCreateCount(plan);
  const reason = assistantCreateDisabledReason(plan);
  return `${html}<div class="assistant-rows">${visible.map(candidate => renderCreateRow(candidate)).join('')}</div><footer class="assistant-footer"><span class="assistant-reason">${escapeHtml(reason)}</span><button class="primary-button" data-assistant-action="write-create"${count === 0 ? ' disabled' : ''}>写入 ${count} 条</button></footer>`;
}

function renderCreateRow(candidate) {
  const rowId = escapeHtml(candidate.rowId);
  const title = String(candidate.title ?? '');
  const executable = isCreateCandidateExecutable(candidate);
  const { date, time } = splitAssistantDeadline(candidate.deadline);
  const badges = [];
  if (candidate.duplicate) {
    badges.push(`<span class="assistant-badge duplicate" title="与「${escapeHtml(candidate.duplicate.title)}」（${escapeHtml(candidate.duplicate.deadline)}）相似">疑似重复</span>`);
  }
  if (candidate.deadlineIssue === 'missing' || candidate.deadlineIssue === 'invalid') badges.push('<span class="assistant-badge missing">待补全</span>');
  if (candidate.expired) badges.push('<span class="assistant-badge expired">已过期</span>');
  if (candidate.statusInvalid) badges.push('<span class="assistant-badge status-invalid">状态无效</span>');
  if (candidate.statusAdjusted) badges.push('<span class="assistant-badge status-adjusted">状态已重置</span>');
  if (candidate.titleTooLong) badges.push('<span class="assistant-badge title-too-long">标题过长</span>');
  const kindOptions = [['assignment', '大作业'], ['activity', '活动']]
    .map(([value, label]) => `<option value="${value}"${candidate.kind === value ? ' selected' : ''}>${label}</option>`)
    .join('');
  return `<article class="assistant-row" data-row-id="${rowId}">
    <div class="assistant-row-head">
      <label class="assistant-check"><input type="checkbox" data-assistant-field="selected"${candidate.selected ? ' checked' : ''}${executable ? '' : ' disabled'}></label>
      <strong class="assistant-row-title">${escapeHtml(title)}</strong>
      <div class="assistant-badges">${badges.join('')}</div>
      <button type="button" class="icon-button" data-assistant-action="remove-row" data-row-id="${rowId}" title="移除" aria-label="移除「${escapeHtml(title)}」"><span data-icon="close"></span></button>
    </div>
    <div class="assistant-fields">
      <label class="field full"><span>标题</span><input data-assistant-field="title" maxlength="${ASSISTANT_TITLE_MAX_LENGTH}" value="${escapeHtml(title)}"></label>
      <label class="field"><span>类型</span><select data-assistant-field="kind">${kindOptions}</select></label>
      <label class="field"><span>截止日期</span><input type="date" data-assistant-field="deadlineDate" value="${escapeHtml(date)}"></label>
      <label class="field"><span>截止时刻</span><input type="time" data-assistant-field="deadlineTime" value="${escapeHtml(time)}"></label>
      <label class="field"><span>状态</span><select data-assistant-field="status">${assistantStatusOptionsHtml(candidate.kind, candidate.status)}</select></label>
      <label class="field assistant-worktype${candidate.kind === 'activity' ? ' hidden' : ''}"><span>个人/团队</span><select data-assistant-field="workType">${assistantWorkTypeSelectHtml(candidate.workType)}</select></label>
      <label class="field full"><span>说明</span><textarea data-assistant-field="description" maxlength="${ASSISTANT_DESCRIPTION_MAX_LENGTH}">${escapeHtml(candidate.description ?? '')}</textarea></label>
    </div>
  </article>`;
}

function renderUpdatePlan(plan) {
  let html = '';
  const target = plan.targets.find(item => item.id === plan.applyToId);
  if (plan.targets.length > 1 || plan.ambiguous) {
    html += `<div class="assistant-targets">${plan.targets.map(item => `<label class="assistant-target-option"><input type="radio" name="assistantTarget" data-assistant-action="pick-target" value="${item.id}"${plan.applyToId === item.id ? ' checked' : ''}><span>${escapeHtml(item.title)} · ${assistantKindLabel(item.kind)} · ${formatDate(item.deadline, true)} · ${assistantStatusLabel(item.status)}</span></label>`).join('')}</div><p class="assistant-hint">匹配到多个事项，请选择一个。</p>`;
  }
  if (plan.applyToId !== null && target && plan.draft) html += renderUpdateDiff(plan, target);
  const reason = assistantUpdateDisabledReason(plan);
  return `${html}<footer class="assistant-footer"><span class="assistant-reason">${escapeHtml(reason)}</span><button class="primary-button" data-assistant-action="save-update"${reason === '' ? '' : ' disabled'}>保存修改</button></footer>`;
}

function renderUpdateDiff(plan, target) {
  const draft = plan.draft;
  const changes = plan.changes || {};
  const rows = [];
  if (hasOwn(changes, 'deadline')) {
    const { date, time } = splitAssistantDeadline(draft.deadline);
    rows.push(`<div class="assistant-diff-row" data-field="deadline"><span class="assistant-old">${escapeHtml(formatDate(target.deadline, true))}</span><span class="assistant-arrow">→</span><div class="assistant-new"><input type="date" data-assistant-field="deadlineDate" value="${escapeHtml(date)}"><input type="time" data-assistant-field="deadlineTime" value="${escapeHtml(time)}"></div></div>`);
  }
  if (hasOwn(changes, 'status')) {
    rows.push(`<div class="assistant-diff-row" data-field="status"><span class="assistant-old">${escapeHtml(assistantStatusLabel(target.status))}</span><span class="assistant-arrow">→</span><div class="assistant-new"><select data-assistant-field="status">${assistantStatusOptionsHtml(target.kind, draft.status ?? null)}</select></div></div>`);
  }
  if (hasOwn(changes, 'title')) {
    rows.push(`<div class="assistant-diff-row" data-field="title"><span class="assistant-old">${escapeHtml(target.title)}</span><span class="assistant-arrow">→</span><div class="assistant-new"><input data-assistant-field="title" maxlength="${ASSISTANT_TITLE_MAX_LENGTH}" value="${escapeHtml(draft.title ?? '')}"></div></div>`);
  }
  if (hasOwn(changes, 'description')) {
    rows.push(`<div class="assistant-diff-row" data-field="description"><span class="assistant-old">${target.description === '' ? '（空）' : escapeHtml(target.description)}</span><span class="assistant-arrow">→</span><div class="assistant-new"><textarea data-assistant-field="description" maxlength="${ASSISTANT_DESCRIPTION_MAX_LENGTH}">${escapeHtml(draft.description ?? '')}</textarea></div></div>`);
  }
  if (target.kind === 'assignment' && hasOwn(changes, 'workType')) {
    rows.push(`<div class="assistant-diff-row" data-field="workType"><span class="assistant-old">${target.work_type === 'team' ? '团队' : '个人'}</span><span class="assistant-arrow">→</span><div class="assistant-new"><select data-assistant-field="workType">${assistantWorkTypeSelectHtml(draft.workType ?? null)}</select></div></div>`);
  }
  return `<div class="assistant-diff" data-target-id="${target.id}">${rows.join('')}</div>`;
}

function renderTargetPlan(plan, mode) {
  const targets = plan.targets;
  let html = '';
  if (mode === 'cleanup' && targets.length > 0) html += `<p class="assistant-range">清理范围：${escapeHtml(plan.rangeLabel)}</p>`;
  if (!targets.length) return '';
  const count = targets.filter(target => target.selected).length;
  const reason = assistantTargetDisabledReason(plan);
  html += '<div class="assistant-danger-note">永久删除，含全部附件，删除后无法恢复。</div>';
  html += `<div class="assistant-rows">${targets.map(target => `<article class="assistant-row assistant-target-row" data-target-id="${target.id}"><label class="assistant-check"><input type="checkbox" data-assistant-field="selected"${target.selected ? ' checked' : ''}></label><div class="assistant-row-main"><strong>${escapeHtml(target.title)}</strong><span>${assistantKindLabel(target.kind)} · ${formatDate(target.deadline, true)} · ${assistantStatusLabel(target.status)}</span></div></article>`).join('')}</div>`;
  html += `<footer class="assistant-footer"><span class="assistant-reason">${escapeHtml(reason)}</span><button class="primary-button" data-assistant-action="delete"${count === 0 ? ' disabled' : ''}>删除 ${count} 条</button></footer>`;
  return html;
}

function renderQueryResult(plan) {
  const meta = plan.meta;
  let html = `<p class="assistant-answer">${escapeHtml(plan.answer)}</p>`;
  if (plan.fallback === true) html += '<p class="assistant-fallback">模型组织文字失败，以下为本地数据汇总</p>';
  html += `<p class="assistant-query-meta">统计口径：按截止时间在 ${escapeHtml(meta.rangeLabel)}；${escapeHtml(meta.kindLabel)} · ${escapeHtml(meta.statusLabel)}；共 ${meta.counts.total} 项。</p>`;
  html += `<div class="assistant-query-counts">大作业 ${meta.counts.assignment.total} 个（未完成 ${meta.counts.assignment.pending}、已完成 ${meta.counts.assignment.completed}），活动 ${meta.counts.activity.total} 个（未完成 ${meta.counts.activity.pending}、已完成 ${meta.counts.activity.completed}）。</div>`;
  if (meta.entries.length > 0) {
    html += `<div class="assistant-query-entries">${meta.entries.map(entry => `<div class="assistant-query-entry">${formatDate(entry.deadline, true)} · ${assistantKindLabel(entry.kind)} · ${escapeHtml(entry.title)} · ${assistantStatusLabel(entry.status)}</div>`).join('')}</div>`;
  }
  return html;
}

function renderAssistantRecords() {
  const container = $('#assistantRecords');
  if (!state.assistant.records.length) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  container.innerHTML = state.assistant.records.map(record => `<section class="assistant-record"><header><strong>${escapeHtml(record.time)}</strong><span>${escapeHtml(record.summary)}</span></header><ul>${record.details.map(detail => `<li>${escapeHtml(detail)}</li>`).join('')}</ul></section>`).join('');
  mountIcons(container);
}

function renderAssistantControls() {
  const loading = state.assistant.loading;
  $('#assistantInput').disabled = loading;
  $('#assistantSubmit').disabled = loading;
  $('#assistantRetry').disabled = loading;
  $('#assistantRetry').classList.toggle('hidden', !(state.assistant.error && state.assistant.error.retryable && !loading));
  const submit = $('#assistantSubmit');
  submit.innerHTML = `<span data-icon="check"></span>${loading ? ASSISTANT_LOADING_TEXT : '解析'}`;
  mountIcons(submit);
  const counter = $('#assistantCounter');
  counter.textContent = `${state.assistant.input.length} / ${ASSISTANT_INPUT_MAX_LENGTH}`;
  counter.classList.toggle('over', state.assistant.input.length > ASSISTANT_INPUT_MAX_LENGTH);
  refreshAssistantActionBar();
}

function refreshAssistantActionBar() {
  const view = state.assistant.view;
  if (!view || state.assistant.loading || state.assistant.error) return;
  if (view.intent === 'clarify' || view.intent === 'unsupported' || view.intent === 'query') return;
  const action = { create: 'write-create', update: 'save-update', delete: 'delete', cleanup: 'delete' }[view.intent];
  const container = $('#assistantResult');
  const button = container.querySelector(`[data-assistant-action="${action}"]`);
  const plan = view[view.intent];
  if (!button || !plan) return;
  let reason;
  if (view.intent === 'create') {
    const count = assistantCreateCount(plan);
    button.textContent = `写入 ${count} 条`;
    reason = assistantCreateDisabledReason(plan);
  } else if (view.intent === 'update') {
    button.textContent = '保存修改';
    reason = assistantUpdateDisabledReason(plan);
  } else {
    const count = plan.targets.filter(target => target.selected).length;
    button.textContent = `删除 ${count} 条`;
    reason = assistantTargetDisabledReason(plan);
  }
  button.disabled = reason !== '';
  const reasonNode = container.querySelector('.assistant-reason');
  if (reasonNode) reasonNode.textContent = reason;
}

function isCreateCandidateExecutable(candidate) {
  if (candidate.removed) return false;
  const title = String(candidate.title ?? '').trim();
  if (title === '' || title.length > ASSISTANT_TITLE_MAX_LENGTH) return false;
  if (candidate.deadlineIssue !== null) return false;
  return candidate.status !== null && isAssistantStatusAllowed(candidate.kind, candidate.status);
}

function createPayloadOf(candidate) {
  return {
    kind: candidate.kind,
    title: String(candidate.title).trim(),
    description: String(candidate.description ?? '').trim().slice(0, ASSISTANT_DESCRIPTION_MAX_LENGTH),
    deadline: candidate.deadline,
    status: candidate.status,
    workType: candidate.kind === 'assignment' ? (candidate.workType || 'personal') : null
  };
}

function assistantCreateCount(plan) {
  return plan.candidates.filter(candidate => !candidate.removed && candidate.selected && isCreateCandidateExecutable(candidate)).length;
}

function assistantCreateDisabledReason(plan) {
  const visible = plan.candidates.filter(candidate => !candidate.removed);
  if (!visible.length) return '没有可写入的候选';
  const selected = visible.filter(candidate => candidate.selected);
  if (!selected.length) return '没有选择任何条目';
  if (selected.every(candidate => candidate.deadlineIssue !== null)) return '所选条目均需先补全截止时间';
  if (selected.every(candidate => candidate.status === null)) return '请先为所选事项选择有效状态';
  if (selected.every(candidate => candidate.titleTooLong)) return '标题超过 120 字符，请缩短后再保存';
  if (selected.every(candidate => !isCreateCandidateExecutable(candidate))) return '所选条目不符合写入条件';
  return '';
}

function assistantUpdateDisabledReason(plan) {
  const target = plan.targets.find(item => item.id === plan.applyToId);
  const draft = plan.draft;
  if (plan.applyToId === null || !target || !draft) return '请先选择要修改的事项';
  if (draft.titleTooLong) return '标题超过 120 字符，请缩短后再保存';
  if (hasOwn(draft, 'title') && String(draft.title ?? '').trim() === '') return '标题不能为空';
  if (draft.deadlineInvalid) return '请先补全截止时间';
  if (hasOwn(draft, 'status') && (draft.status === null || draft.statusInvalid)) return '请先为所选项选择有效状态';
  if (!assistantDraftDiffers(target, draft)) return '没有可执行的修改';
  return '';
}

function assistantTargetDisabledReason(plan) {
  return plan.targets.some(target => target.selected) ? '' : '没有选择任何条目';
}

function assistantDraftDiffers(target, draft) {
  if (hasOwn(draft, 'deadline') && draft.deadline !== target.deadline) return true;
  if (hasOwn(draft, 'status') && draft.status !== target.status) return true;
  if (hasOwn(draft, 'title') && draft.title !== target.title) return true;
  if (hasOwn(draft, 'description') && draft.description !== target.description) return true;
  if (hasOwn(draft, 'workType') && target.kind === 'assignment' && (draft.workType || 'personal') !== (target.work_type || 'personal')) return true;
  return false;
}

function initializeUpdateDraft(plan, target) {
  const draft = { deadlineInvalid: false, statusInvalid: false, titleTooLong: false };
  const changes = plan.changes || {};
  if (hasOwn(changes, 'deadline')) {
    draft.deadline = typeof changes.deadline === 'string' ? changes.deadline : null;
    draft.deadlineInvalid = Boolean(plan.deadlineInvalid);
  }
  if (hasOwn(changes, 'status')) {
    if (typeof changes.status === 'string' && isAssistantStatusAllowed(target.kind, changes.status)) {
      draft.status = changes.status;
      draft.statusInvalid = false;
    } else {
      draft.status = null;
      draft.statusInvalid = true;
    }
  }
  if (hasOwn(changes, 'title')) {
    draft.title = changes.title;
    draft.titleTooLong = Boolean(plan.titleTooLong);
  }
  if (hasOwn(changes, 'description')) draft.description = changes.description;
  if (target.kind === 'assignment' && hasOwn(changes, 'workType')) draft.workType = changes.workType;
  return draft;
}

function updatePayloadOf(latest, draft) {
  if (hasOwn(draft, 'title') && String(draft.title ?? '').trim() === '') return null;
  const payload = {
    kind: latest.kind,
    title: latest.title,
    description: latest.description,
    deadline: latest.deadline,
    status: latest.status,
    workType: latest.kind === 'assignment' ? latest.work_type : null
  };
  if (hasOwn(draft, 'title')) payload.title = draft.title;
  if (hasOwn(draft, 'description')) payload.description = draft.description;
  if (hasOwn(draft, 'deadline')) payload.deadline = draft.deadline;
  if (hasOwn(draft, 'status')) payload.status = draft.status;
  if (latest.kind === 'assignment' && hasOwn(draft, 'workType')) payload.workType = draft.workType;
  return payload;
}

async function submitAssistant(options = {}) {
  if (state.assistant.loading || state.assistant.executing) return;
  const text = state.assistant.input;
  if (text.trim() === '') {
    state.assistant.error = { code: 'invalid_input', message: '请输入要处理的内容', retryable: false };
    renderAssistant();
    renderAssistantControls();
    return;
  }
  if (text.trim().length > ASSISTANT_INPUT_MAX_LENGTH) {
    state.assistant.error = { code: 'invalid_input', message: `内容超过 ${ASSISTANT_INPUT_MAX_LENGTH} 字符，请精简后再提交`, retryable: false };
    renderAssistant();
    renderAssistantControls();
    return;
  }
  if (state.assistant.view && state.assistant.dirty) {
    const confirmed = await askConfirmation('替换当前预览？', '当前预览中的修改与勾选将丢失。', '替换');
    if (!confirmed || state.currentPage !== 'assistant') return;
  }
  const seq = ++state.assistant.seq;
  state.assistant.loading = true;
  state.assistant.view = null;
  state.assistant.dirty = false;
  state.assistant.error = null;
  renderAssistant();
  renderAssistantControls();
  let result;
  try {
    result = await api.assistant.parse(text);
  } catch {
    result = { ok: false, code: 'unknown', message: '处理失败，请重试', retryable: true };
  }
  if (seq !== state.assistant.seq || state.currentPage !== 'assistant') return;
  state.assistant.loading = false;
  if (!result || result.ok === false) {
    const error = result || {};
    state.assistant.view = null;
    state.assistant.error = {
      code: error.code || 'unknown',
      message: error.message || '处理失败，请重试',
      retryable: Boolean(error.retryable)
    };
    if (state.assistant.error.code === 'not_configured') {
      state.ai.configured = false;
      renderAssistantConfigWarning();
    }
  } else {
    state.assistant.error = null;
    state.assistant.view = normalizeAssistantView(result);
    state.assistant.dirty = false;
  }
  renderAssistant();
  renderAssistantControls();
}

function takeAssistantSnapshot() {
  if (state.assistant.loading || state.assistant.executing) return null;
  const view = state.assistant.view;
  if (!view) return null;
  const batchSeq = state.assistant.seq;
  if (view.intent === 'create') {
    const candidates = view.create.candidates
      .filter(candidate => !candidate.removed && candidate.selected && isCreateCandidateExecutable(candidate))
      .map(candidate => ({ ...candidate }));
    if (!candidates.length) return null;
    return { intent: 'create', candidates, count: candidates.length, batchSeq };
  }
  if (view.intent === 'update') {
    const applyToId = view.update.applyToId;
    const baseline = view.update.targets.find(target => target.id === applyToId);
    const draft = view.update.draft;
    if (applyToId === null || !baseline || !draft) return null;
    return { intent: 'update', applyToId, baseline: { ...baseline }, draft: { ...draft }, count: 1, batchSeq };
  }
  if (view.intent === 'delete') {
    const targets = view.delete.targets.filter(target => target.selected).map(target => ({ ...target }));
    if (!targets.length) return null;
    return { intent: 'delete', targets, count: targets.length, batchSeq };
  }
  if (view.intent === 'cleanup') {
    const targets = view.cleanup.targets.filter(target => target.selected).map(target => ({ ...target }));
    if (!targets.length || !view.cleanup.range) return null;
    return {
      intent: 'cleanup',
      targets,
      count: targets.length,
      range: { ...view.cleanup.range },
      rangeLabel: view.cleanup.rangeLabel,
      batchSeq
    };
  }
  return null;
}

async function runAssistantBatch(snapshot, runRows) {
  state.assistant.loading = true;
  state.assistant.executing = true;
  renderAssistant();
  renderAssistantControls();
  let latest = null;
  try {
    latest = await api.items.list();
  } catch {
    latest = null;
  }
  if (latest === null) {
    state.assistant.executing = false;
    state.assistant.loading = false;
    showToast('无法读取最新数据，请重试', true);
    renderAssistant();
    renderAssistantControls();
    return;
  }
  let outcome = null;
  try {
    outcome = await runRows(latest);
    await refreshItems();
  } catch {
    outcome = null;
  } finally {
    state.assistant.executing = false;
    state.assistant.loading = false;
  }
  if (outcome === null) {
    showToast('处理失败，请重试', true);
    if (state.currentPage === 'assistant') {
      renderAssistant();
      renderAssistantControls();
    }
    return;
  }
  if (state.currentPage !== 'assistant') return;
  if (state.assistant.seq === snapshot.batchSeq) {
    state.assistant.view = null;
    state.assistant.error = null;
    state.assistant.dirty = false;
    pushAssistantRecord({ time: assistantTimeLabel(), intent: snapshot.intent, summary: outcome.summary, details: outcome.details });
  }
  renderAssistant();
  renderAssistantControls();
}

async function executeAssistantCreate() {
  const snapshot = takeAssistantSnapshot();
  if (!snapshot || snapshot.intent !== 'create') return;
  await runAssistantBatch(snapshot, async () => {
    let success = 0;
    let fail = 0;
    const details = [];
    for (const candidate of snapshot.candidates) {
      const payload = createPayloadOf(candidate);
      try {
        await api.items.create(payload);
        success += 1;
        details.push(`已新增「${payload.title}」`);
      } catch (error) {
        fail += 1;
        details.push(`新增「${payload.title}」失败：${error?.message || ''}`);
      }
    }
    return { summary: `新增 ${snapshot.count} 条（成功 ${success}，失败 ${fail}）`, details };
  });
}

async function executeAssistantUpdate() {
  const snapshot = takeAssistantSnapshot();
  if (!snapshot || snapshot.intent !== 'update') return;
  await runAssistantBatch(snapshot, async latest => {
    let success = 0;
    let fail = 0;
    const details = [];
    const baseline = snapshot.baseline;
    const failDetail = message => { fail += 1; details.push(message); };
    const latestItem = latest.find(item => item.id === snapshot.applyToId);
    if (!latestItem
      || latestItem.kind !== baseline.kind
      || latestItem.title !== baseline.title
      || latestItem.deadline !== baseline.deadline
      || latestItem.status !== baseline.status) {
      failDetail(`「${baseline.title}」已在其他入口被修改，请重新提交`);
    } else if (snapshot.draft.deadlineInvalid) {
      failDetail('请先补全截止时间');
    } else if (hasOwn(snapshot.draft, 'status') && (snapshot.draft.status === null || snapshot.draft.statusInvalid)) {
      failDetail('请先为所选项选择有效状态');
    } else {
      const payload = updatePayloadOf(latestItem, snapshot.draft);
      if (payload === null) failDetail('标题不能为空');
      else if (!assistantDraftDiffers(latestItem, snapshot.draft)) failDetail('没有可执行的修改');
      else {
        try {
          await api.items.update(snapshot.applyToId, payload);
          success += 1;
          details.push(`已保存「${payload.title}」的修改`);
        } catch (error) {
          failDetail(`修改「${baseline.title}」失败：${error?.message || ''}`);
        }
      }
    }
    return { summary: `修改 1 条（成功 ${success}，失败 ${fail}）`, details };
  });
}

async function executeAssistantDelete(mode) {
  const snapshot = takeAssistantSnapshot();
  if (!snapshot) return;
  if (mode === 'cleanup' ? snapshot.intent !== 'cleanup' : snapshot.intent !== 'delete') return;
  const confirmed = await askConfirmation(
    `永久删除 ${snapshot.count} 个事项？`,
    `将永久删除 ${snapshot.count} 个事项及其全部附件，删除后无法恢复。`,
    '永久删除'
  );
  if (!confirmed) return;
  await runAssistantBatch(snapshot, async latest => {
    let success = 0;
    let skip = 0;
    let fail = 0;
    const details = [];
    for (const target of snapshot.targets) {
      const latestItem = latest.find(item => item.id === target.id);
      if (!latestItem) {
        skip += 1;
        details.push(`「${target.title}」已不存在（跳过）`);
        continue;
      }
      if (snapshot.intent === 'cleanup') {
        if (latestItem.status !== 'completed') {
          skip += 1;
          details.push(`「${target.title}」状态已变化，跳过`);
          continue;
        }
        const datePart = String(latestItem.deadline).slice(0, 10);
        if (datePart < snapshot.range.start || datePart > snapshot.range.end) {
          skip += 1;
          details.push(`「${target.title}」截止时间已不在范围内，跳过`);
          continue;
        }
      }
      try {
        await api.items.remove(target.id);
        success += 1;
        details.push(`已永久删除「${target.title}」`);
      } catch (error) {
        if (String(error?.message || '').includes('事项不存在')) {
          skip += 1;
          details.push(`「${target.title}」已不存在（跳过）`);
        } else {
          fail += 1;
          details.push(`删除「${target.title}」失败：${error?.message || ''}`);
        }
      }
    }
    return { summary: `删除 ${snapshot.count} 条（成功 ${success}，跳过 ${skip}，失败 ${fail}）`, details };
  });
}

function pushAssistantRecord(record) {
  state.assistant.records.push(record);
  renderAssistantRecords();
}

function assistantSetCreateDeadline(candidate, row) {
  const dateInput = row.querySelector('[data-assistant-field="deadlineDate"]');
  const timeInput = row.querySelector('[data-assistant-field="deadlineTime"]');
  candidate.deadline = joinAssistantDeadline(dateInput ? dateInput.value : '', timeInput ? timeInput.value : '');
  candidate.deadlineIssue = candidate.deadline === null ? 'missing' : null;
  candidate.expired = candidate.deadlineIssue === null && parseDate(candidate.deadline) < new Date();
}

function assistantAutoSelectCandidate(candidate, wasExecutable) {
  if (!wasExecutable && isCreateCandidateExecutable(candidate) && candidate.duplicate === null) candidate.selected = true;
}

function assistantApplyCreateKind(candidate, kind) {
  candidate.kind = kind;
  if (!isAssistantStatusAllowed(kind, candidate.status)) {
    candidate.status = assistantDefaultStatus(kind);
    candidate.statusAdjusted = true;
    candidate.statusInvalid = false;
  } else {
    candidate.statusAdjusted = false;
    candidate.statusInvalid = false;
  }
  if (kind === 'activity') candidate.workType = null;
  else if (candidate.workType === null) candidate.workType = 'personal';
  candidate.expired = candidate.deadlineIssue === null && parseDate(candidate.deadline) < new Date();
}

function assistantMarkDirty() {
  state.assistant.dirty = true;
}

function assistantRowOf(view, element) {
  const createRow = element.closest('.assistant-row[data-row-id]');
  if (createRow && view.intent === 'create') {
    return view.create.candidates.find(candidate => candidate.rowId === createRow.dataset.rowId) || null;
  }
  const targetRow = element.closest('.assistant-row[data-target-id]');
  if (targetRow && (view.intent === 'delete' || view.intent === 'cleanup')) {
    const plan = view.intent === 'delete' ? view.delete : view.cleanup;
    return plan.targets.find(target => target.id === Number(targetRow.dataset.targetId)) || null;
  }
  return null;
}

function assistantHandleInput(event) {
  const view = state.assistant.view;
  if (!view) return;
  const field = event.target.dataset.assistantField;
  if (!field) return;
  if (view.intent === 'create') {
    const createRow = event.target.closest('.assistant-row[data-row-id]');
    if (!createRow) return;
    const candidate = view.create.candidates.find(item => item.rowId === createRow.dataset.rowId);
    if (!candidate) return;
    if (field === 'title') {
      candidate.title = event.target.value;
      candidate.titleTooLong = String(candidate.title).trim().length > ASSISTANT_TITLE_MAX_LENGTH;
      assistantMarkDirty();
      renderAssistantControls();
      return;
    }
    if (field === 'description') {
      candidate.description = event.target.value;
      assistantMarkDirty();
      renderAssistantControls();
      return;
    }
    if (field === 'deadlineDate' || field === 'deadlineTime') {
      const wasExecutable = isCreateCandidateExecutable(candidate);
      assistantSetCreateDeadline(candidate, createRow);
      assistantAutoSelectCandidate(candidate, wasExecutable);
      assistantMarkDirty();
      renderAssistant();
      renderAssistantControls();
    }
    return;
  }
  if (view.intent === 'update') {
    const plan = view.update;
    const draft = plan.draft;
    const target = plan.targets.find(item => item.id === plan.applyToId);
    if (!draft || !target) return;
    if (field === 'title') {
      draft.title = event.target.value;
      draft.titleTooLong = String(draft.title ?? '').trim().length > ASSISTANT_TITLE_MAX_LENGTH;
      assistantMarkDirty();
      renderAssistantControls();
      return;
    }
    if (field === 'description') {
      draft.description = event.target.value;
      assistantMarkDirty();
      renderAssistantControls();
      return;
    }
    if (field === 'deadlineDate' || field === 'deadlineTime') {
      const diff = event.target.closest('.assistant-diff');
      const dateInput = diff ? diff.querySelector('[data-assistant-field="deadlineDate"]') : null;
      const timeInput = diff ? diff.querySelector('[data-assistant-field="deadlineTime"]') : null;
      draft.deadline = joinAssistantDeadline(dateInput ? dateInput.value : '', timeInput ? timeInput.value : '');
      draft.deadlineInvalid = draft.deadline === null;
      assistantMarkDirty();
      renderAssistantControls();
    }
  }
}

function assistantHandleChange(event) {
  const view = state.assistant.view;
  if (!view) return;
  if (event.target.dataset.assistantAction === 'pick-target') {
    const plan = view.update;
    if (!plan) return;
    plan.applyToId = Number(event.target.value);
    const target = plan.targets.find(item => item.id === plan.applyToId);
    plan.draft = target ? initializeUpdateDraft(plan, target) : null;
    assistantMarkDirty();
    renderAssistant();
    renderAssistantControls();
    return;
  }
  const field = event.target.dataset.assistantField;
  if (!field) return;
  if (view.intent === 'create') {
    const createRow = event.target.closest('.assistant-row[data-row-id]');
    if (!createRow) return;
    const candidate = view.create.candidates.find(item => item.rowId === createRow.dataset.rowId);
    if (!candidate) return;
    if (field === 'selected') {
      candidate.selected = event.target.checked;
      assistantMarkDirty();
      renderAssistant();
      renderAssistantControls();
      return;
    }
    if (field === 'kind') {
      const wasExecutable = isCreateCandidateExecutable(candidate);
      assistantApplyCreateKind(candidate, event.target.value);
      assistantAutoSelectCandidate(candidate, wasExecutable);
      assistantMarkDirty();
      renderAssistant();
      renderAssistantControls();
      return;
    }
    if (field === 'status') {
      candidate.status = event.target.value === '' ? null : event.target.value;
      candidate.statusInvalid = false;
      candidate.statusAdjusted = false;
      assistantMarkDirty();
      renderAssistant();
      renderAssistantControls();
      return;
    }
    if (field === 'workType') {
      candidate.workType = event.target.value;
      assistantMarkDirty();
      renderAssistantControls();
      return;
    }
    if (field === 'title') {
      candidate.title = event.target.value;
      candidate.titleTooLong = String(candidate.title).trim().length > ASSISTANT_TITLE_MAX_LENGTH;
      assistantMarkDirty();
      renderAssistant();
      renderAssistantControls();
      return;
    }
    if (field === 'deadlineDate' || field === 'deadlineTime') {
      const wasExecutable = isCreateCandidateExecutable(candidate);
      assistantSetCreateDeadline(candidate, createRow);
      assistantAutoSelectCandidate(candidate, wasExecutable);
      assistantMarkDirty();
      renderAssistant();
      renderAssistantControls();
      return;
    }
    if (field === 'description') {
      candidate.description = event.target.value;
      assistantMarkDirty();
      renderAssistantControls();
    }
    return;
  }
  if (view.intent === 'delete' || view.intent === 'cleanup') {
    const targetRow = event.target.closest('.assistant-row[data-target-id]');
    if (!targetRow || field !== 'selected') return;
    const plan = view.intent === 'delete' ? view.delete : view.cleanup;
    const target = plan.targets.find(item => item.id === Number(targetRow.dataset.targetId));
    if (!target) return;
    target.selected = event.target.checked;
    assistantMarkDirty();
    renderAssistant();
    renderAssistantControls();
    return;
  }
  if (view.intent === 'update') {
    const plan = view.update;
    const draft = plan.draft;
    const target = plan.targets.find(item => item.id === plan.applyToId);
    if (!draft || !target) return;
    if (field === 'status') {
      draft.status = event.target.value === '' ? null : event.target.value;
      draft.statusInvalid = !isAssistantStatusAllowed(target.kind, draft.status);
      assistantMarkDirty();
      renderAssistant();
      renderAssistantControls();
      return;
    }
    if (field === 'workType') {
      draft.workType = event.target.value;
      assistantMarkDirty();
      renderAssistantControls();
      return;
    }
    if (field === 'title') {
      draft.title = event.target.value;
      draft.titleTooLong = String(draft.title ?? '').trim().length > ASSISTANT_TITLE_MAX_LENGTH;
      assistantMarkDirty();
      renderAssistantControls();
    }
  }
}

function assistantHandleResultClick(event) {
  const actionButton = event.target.closest('[data-assistant-action]');
  if (!actionButton) return;
  const action = actionButton.dataset.assistantAction;
  if (action === 'remove-row') {
    const view = state.assistant.view;
    const rowId = actionButton.dataset.rowId;
    const candidate = view && view.intent === 'create'
      ? view.create.candidates.find(item => item.rowId === rowId)
      : null;
    if (!candidate) return;
    candidate.removed = true;
    candidate.selected = false;
    assistantMarkDirty();
    renderAssistant();
    renderAssistantControls();
    return;
  }
  if (action === 'write-create') {
    executeAssistantCreate();
    return;
  }
  if (action === 'save-update') {
    executeAssistantUpdate();
    return;
  }
  if (action === 'delete') {
    executeAssistantDelete(state.assistant.view?.intent === 'cleanup' ? 'cleanup' : 'delete');
    return;
  }
  if (action === 'go-settings') switchPage('settings');
}

// ---------- 日常任务 ----------

function activeHabits() {
  return state.habits.filter(habit => !habit.archived_at);
}

function habitDotHtml(habit, point) {
  const [, month, day] = point.date.split('-').map(Number);
  const label = `${month}月${day}日${point.done ? '已打卡' : '未打卡'}`;
  return `<button type="button" class="habit-dot ${point.done ? 'done' : ''}" data-habit-dot="${habit.id}" data-date="${point.date}" title="${label}" aria-label="${label}"></button>`;
}

function habitRowHtml(habit) {
  const streakBadge = habit.streak > 0 ? `<span class="badge progress">连续 ${habit.streak} 天</span>` : '';
  const checkIcon = '<svg class="icon sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg>';
  return `<article class="habit-row ${habit.checked_today ? 'checked' : ''}">
    <button type="button" class="habit-check ${habit.checked_today ? 'done' : ''}" data-habit-toggle="${habit.id}" title="${habit.checked_today ? '取消今天的打卡' : '打卡'}" aria-label="${habit.checked_today ? '取消今天的打卡' : '打卡'}：${escapeHtml(habit.title)}" aria-pressed="${habit.checked_today ? 'true' : 'false'}">${habit.checked_today ? checkIcon : ''}</button>
    <div class="habit-copy">
      <div class="row-title"><strong>${escapeHtml(habit.title)}</strong>${streakBadge}</div>
      <div class="habit-sub"><span class="habit-dots">${habit.last7.map(point => habitDotHtml(habit, point)).join('')}</span><span class="habit-total">累计 ${habit.total} 天</span></div>
    </div>
    <div class="table-actions">
      <button class="icon-button" data-habit-edit="${habit.id}" title="编辑" aria-label="编辑“${escapeHtml(habit.title)}”"><span data-icon="edit"></span></button>
      <button class="icon-button" data-habit-archive="${habit.id}" title="归档" aria-label="归档“${escapeHtml(habit.title)}”"><span data-icon="folder"></span></button>
      <button class="icon-button" data-habit-delete="${habit.id}" title="删除" aria-label="删除“${escapeHtml(habit.title)}”"><span data-icon="trash"></span></button>
    </div>
  </article>`;
}

function renderHabitsPage() {
  const active = activeHabits();
  const done = active.filter(habit => habit.checked_today).length;
  $('#habitProgressLabel').textContent = `${done} / ${active.length}`;
  const percent = active.length ? Math.round(done / active.length * 100) : 0;
  $('#habitProgressFill').style.width = `${percent}%`;

  const list = $('#habitList');
  if (!active.length) {
    list.innerHTML = `<div class="panel habit-empty">${emptyState('还没有日常任务', '添加一个每天要坚持的小任务，比如背单词或锻炼。', '新增任务', 'habit')}</div>`;
  } else {
    list.innerHTML = active.map(habitRowHtml).join('');
  }

  const archived = state.habits.filter(habit => habit.archived_at);
  $('#habitArchivedSection').classList.toggle('hidden', !archived.length);
  $('#habitArchivedToggle').textContent = `已归档（${archived.length}）`;
  $('#habitArchivedList').classList.toggle('hidden', !state.habitArchivedOpen);
  $('#habitArchivedList').innerHTML = archived.map(habit => `<div class="habit-archived-row">
    <div class="habit-archived-copy"><strong>${escapeHtml(habit.title)}</strong><span>累计打卡 ${habit.total} 天${habit.note ? ` · ${escapeHtml(habit.note)}` : ''}</span></div>
    <div class="table-actions">
      <button class="text-button" data-habit-restore="${habit.id}">恢复</button>
      <button class="icon-button" data-habit-delete="${habit.id}" title="彻底删除" aria-label="彻底删除“${escapeHtml(habit.title)}”"><span data-icon="trash"></span></button>
    </div>
  </div>`).join('');
  mountIcons(list);
  mountIcons($('#habitArchivedList'));
}

function renderHabitCard() {
  const panel = $('#habitCardPanel');
  const active = activeHabits();
  if (!active.length) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  const pendingHabits = active.filter(habit => !habit.checked_today);
  $('#habitCardCaption').textContent = `已打卡 ${active.length - pendingHabits.length} / ${active.length}`;
  const list = $('#habitCardList');
  if (!pendingHabits.length) {
    list.innerHTML = '<div class="habit-card-alldone"><span data-icon="check"></span><p>今日打卡已全部完成</p></div>';
  } else {
    list.innerHTML = pendingHabits.map(habit => `<button type="button" class="habit-card-row" data-habit-toggle="${habit.id}" aria-label="打卡：${escapeHtml(habit.title)}">
      <span class="habit-card-ring" aria-hidden="true"></span>
      <span class="habit-card-copy"><strong>${escapeHtml(habit.title)}</strong>${habit.streak ? `<span>连续 ${habit.streak} 天</span>` : '<span>点一下完成打卡</span>'}</span>
    </button>`).join('');
  }
  mountIcons(list);
}

function renderHabitViews() {
  renderNavigation();
  renderHabitCard();
  renderHabitsPage();
  renderStats();
  mountIcons();
}

async function refreshHabits() {
  const habits = await execute(() => api.habits.list());
  if (habits) {
    state.habits = habits;
    renderHabitViews();
  }
}

function openHabitModal(habit = null) {
  $('#habitForm').reset();
  $('#habitId').value = habit?.id || '';
  $('#habitModalTitle').textContent = habit ? '编辑日常任务' : '新增日常任务';
  $('#habitTitle').value = habit?.title || '';
  $('#habitNote').value = habit?.note || '';
  $('#habitModal').classList.add('open');
  $('#habitModal').setAttribute('aria-hidden', 'false');
  openModalLayer($('#habitModal'));
  setTimeout(() => $('#habitTitle').focus(), 0);
}

function closeHabitModal() {
  $('#habitModal').classList.remove('open');
  $('#habitModal').setAttribute('aria-hidden', 'true');
  closeModalLayer($('#habitModal'));
}

async function saveHabit(event) {
  event.preventDefault();
  const id = Number($('#habitId').value) || null;
  const input = { title: $('#habitTitle').value, note: $('#habitNote').value };
  const habits = await execute(() => id ? api.habits.update(id, input) : api.habits.create(input), id ? '任务已更新' : '任务已添加');
  if (!habits) return;
  state.habits = habits;
  closeHabitModal();
  renderHabitViews();
}

async function toggleHabitCheckin(id, date) {
  const result = await execute(() => api.habits.toggleCheckin(id, date));
  if (result) await refreshHabits();
}

async function setHabitArchived(id, archived) {
  const habit = state.habits.find(entry => entry.id === id);
  if (!habit) return;
  const message = archived ? `已归档「${habit.title}」` : '任务已恢复';
  const habits = await execute(() => api.habits.setArchived(id, archived), message);
  if (habits) {
    state.habits = habits;
    renderHabitViews();
  }
}

async function deleteHabit(id) {
  const habit = state.habits.find(entry => entry.id === id);
  if (!habit) return;
  const confirmed = await askConfirmation('删除这个日常任务？', `“${habit.title}”和它的全部打卡记录将被永久删除。想保留记录可以改用归档。`, '删除');
  if (!confirmed) return;
  const removed = await execute(() => api.habits.remove(id), '任务已删除');
  if (removed) await refreshHabits();
}

function setModalKind(kind) {
  state.modalKind = kind;
  $$('.kind-segment button').forEach(button => button.classList.toggle('active', button.dataset.kind === kind));
  $$('.assignment-only').forEach(element => element.classList.toggle('hidden', kind !== 'assignment'));
  $('#titleLabel').textContent = kind === 'assignment' ? '课程名称' : '活动名称';
  $('#itemTitle').placeholder = kind === 'assignment' ? '例如：数据库课程设计' : '例如：校园摄影赛';
  const status = $('#itemStatus');
  const current = status.value;
  status.innerHTML = kind === 'assignment'
    ? '<option value="not_started">未开始</option><option value="in_progress">进行中</option><option value="completed">已完成</option>'
    : '<option value="not_completed">未完成</option><option value="completed">已完成</option>';
  if ([...status.options].some(option => option.value === current)) status.value = current;
}

function updateDeadlineAux() {
  const dateValue = $('#itemDeadlineDate').value;
  $$('#deadlineChips button').forEach(button => {
    const target = new Date();
    target.setDate(target.getDate() + Number(button.dataset.dayOffset));
    button.classList.toggle('active', Boolean(dateValue) && localDate(target) === dateValue);
  });
  const preview = $('#deadlinePreview');
  if (!dateValue) { preview.textContent = '请选择截止日期'; preview.className = 'deadline-preview'; return; }
  const date = parseDate(dateValue);
  const days = daysUntil(dateValue);
  const weekday = `周${'日一二三四五六'.charAt(date.getDay())}`;
  const hint = days < 0 ? `已过去 ${-days} 天` : days === 0 ? '就是今天' : days === 1 ? '还有 1 天' : `还有 ${days} 天`;
  preview.textContent = `${date.getMonth() + 1}月${date.getDate()}日 ${weekday} · ${hint}`;
  preview.className = `deadline-preview ${days < 0 ? 'urgent' : days <= 1 ? 'soon' : ''}`;
}

function openItemModal(kind = 'assignment', item = null) {
  $('#itemForm').reset();
  $('#itemId').value = item?.id || '';
  state.selectedFiles = [];
  state.existingAttachments = item?.attachments ? [...item.attachments] : [];
  setModalKind(item?.kind || kind);
  $('#itemModalTitle').textContent = item ? '编辑事项' : '新增事项';
  $('#itemModalSubtitle').textContent = item ? '修改后会立即保存到本地' : '记录一个新的截止日期';
  $('#itemTitle').value = item?.title || '';
  $('#itemDescription').value = item?.description || '';
  const [deadlineDate, deadlineTime = '23:59'] = (item ? item.deadline : `${localDate()} 23:59`).split(' ');
  $('#itemDeadlineDate').value = deadlineDate;
  $('#itemDeadlineTime').value = deadlineTime;
  updateDeadlineAux();
  if (item?.work_type) $('#itemWorkType').value = item.work_type;
  $('#itemStatus').value = item?.status || (state.modalKind === 'assignment' ? 'not_started' : 'not_completed');
  renderModalAttachments();
  $('#itemModal').classList.add('open');
  $('#itemModal').setAttribute('aria-hidden', 'false');
  state.itemFormBaseline = itemFormSignature();
  openModalLayer($('#itemModal'));
  setTimeout(() => $('#itemTitle').focus(), 0);
}

function closeItemModal() {
  $('#itemModal').classList.remove('open');
  $('#itemModal').setAttribute('aria-hidden', 'true');
  state.itemFormBaseline = null;
  closeModalLayer($('#itemModal'));
}

function itemFormSignature() {
  return [$('#itemTitle').value, $('#itemDescription').value, $('#itemDeadlineDate').value,
    $('#itemDeadlineTime').value, $('#itemStatus').value, $('#itemWorkType').value].join('\u0001');
}

function isItemFormDirty() {
  return Boolean(state.itemFormBaseline) && (itemFormSignature() !== state.itemFormBaseline || state.selectedFiles.length > 0);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderModalAttachments() {
  const list = $('#attachmentList');
  const existing = state.existingAttachments.map(file => `<div class="attachment-item"><span data-icon="file"></span><div class="attachment-copy"><strong>${escapeHtml(file.original_name)}</strong><span>${formatSize(file.size)}</span></div><div class="attachment-actions"><button type="button" class="icon-button" data-attachment-open="${file.id}" title="打开" aria-label="打开附件“${escapeHtml(file.original_name)}”"><span data-icon="external"></span></button><button type="button" class="icon-button" data-attachment-delete="${file.id}" title="删除" aria-label="删除附件“${escapeHtml(file.original_name)}”"><span data-icon="trash"></span></button></div></div>`);
  const selected = state.selectedFiles.map((file, index) => `<div class="attachment-item"><span data-icon="file"></span><div class="attachment-copy"><strong>${escapeHtml(file.name)}</strong><span>${formatSize(file.size)} · 待保存</span></div><div class="attachment-actions"><button type="button" class="icon-button" data-selected-delete="${index}" title="移除" aria-label="移除待保存附件“${escapeHtml(file.name)}”"><span data-icon="close"></span></button></div></div>`);
  list.innerHTML = [...existing, ...selected].join('') || '<div class="attachment-empty">尚未选择附件</div>';
  mountIcons(list);
}

function askConfirmation(title, message, acceptLabel = '确认') {
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  $('#confirmAccept').textContent = acceptLabel;
  $('#confirmModal').classList.add('open');
  $('#confirmModal').setAttribute('aria-hidden', 'false');
  openModalLayer($('#confirmModal'));
  setTimeout(() => $('#confirmCancel').focus(), 0);
  return new Promise(resolve => { state.confirmResolver = resolve; });
}

function resolveConfirmation(value) {
  $('#confirmModal').classList.remove('open');
  $('#confirmModal').setAttribute('aria-hidden', 'true');
  closeModalLayer($('#confirmModal'));
  state.confirmResolver?.(value);
  state.confirmResolver = null;
}

async function saveItem(event) {
  event.preventDefault();
  const id = Number($('#itemId').value) || null;
  const input = {
    kind: state.modalKind,
    title: $('#itemTitle').value,
    description: $('#itemDescription').value,
    deadline: `${$('#itemDeadlineDate').value} ${$('#itemDeadlineTime').value || '23:59'}`,
    status: $('#itemStatus').value,
    workType: state.modalKind === 'assignment' ? $('#itemWorkType').value : null
  };
  const item = await execute(() => id ? api.items.update(id, input) : api.items.create(input));
  if (!item) return;
  if (state.selectedFiles.length) {
    const saved = await execute(() => api.attachments.save(item.id, state.selectedFiles));
    if (saved === null) return;
  }
  closeItemModal();
  showToast(id ? '事项已更新' : '事项已添加');
  await refreshItems();
}

async function updateDetailStatus(id, status) {
  const item = state.items.find(entry => entry.id === id);
  if (!item || item.status === status) return;
  const updated = await execute(() => api.items.setStatus(id, status), '状态已更新');
  if (updated) await refreshItems();
  else refreshOpenItemDetail();
}

async function handleItemAction(button) {
  const id = Number(button.dataset.id);
  const item = state.items.find(entry => entry.id === id);
  if (!item) return;
  if (button.dataset.action === 'edit') openItemModal(item.kind, item);
  if (button.dataset.action === 'status') {
    state.justCompletedId = nextStatus(item) === 'completed' ? id : null;
    const updated = await execute(() => api.items.setStatus(id, nextStatus(item)), '状态已更新');
    if (updated) await refreshItems();
    state.justCompletedId = null;
  }
  if (button.dataset.action === 'delete') {
    const confirmed = await askConfirmation('删除这个事项？', `“${item.title}”及其全部附件将被永久删除。`, '删除');
    if (!confirmed) return;
    const removed = await execute(() => api.items.remove(id), '事项已删除');
    if (removed) await refreshItems();
  }
}

function renderAiSettings() {
  $('#aiProtocolSelect').value = normalizeAiProtocol(state.ai.protocol);
  $('#aiEndpointInput').value = state.ai.endpoint || '';
  $('#aiModelInput').value = state.ai.model || '';
  $('#aiKeyMask').textContent = state.ai.keyMask ? `已保存（${state.ai.keyMask}）` : '未设置';
  $('#aiKeyField').classList.toggle('hidden', !state.ai.editingKey);
  $('#aiKeyInput').value = '';
  const ready = Boolean(state.ai.configured);
  const status = $('#aiSettingsStatus');
  status.dataset.aiStatus = ready ? 'ready' : 'missing';
  status.textContent = ready ? '配置完整，助手页可用' : '配置不完整，助手功能不可用';
}

async function saveAiSettings() {
  const endpoint = $('#aiEndpointInput').value.trim();
  const model = $('#aiModelInput').value.trim();
  const apiKey = state.ai.editingKey ? $('#aiKeyInput').value.trim() : '';
  const protocol = normalizeAiProtocol($('#aiProtocolSelect').value);
  const payload = { endpoint, model, protocol };
  if (apiKey) payload.apiKey = apiKey;
  let result;
  try {
    result = await api.settings.saveAi(payload);
  } catch {
    showToast('保存失败，请重试', true);
    return;
  }
  if (!result || !result.ok) {
    showToast((result && result.message) || '保存失败，请重试', true);
    return;
  }
  state.ai = { ...result.ai, editingKey: false };
  renderAiSettings();
  renderAssistantConfigWarning();
  showToast('AI 配置已保存');
}

async function initializeSettings() {
  const settings = await execute(() => api.settings.get());
  if (!settings) return;
  state.notificationsEnabled = settings.notificationsEnabled;
  $('#notificationToggle').checked = settings.notificationsEnabled;
  $('#widgetToggle').checked = settings.widgetEnabled !== false;
  $('#dataPath').textContent = settings.dataPath;
  $('#notificationSummary').textContent = settings.notificationsEnabled ? '应用在托盘运行时会检查到期事项。' : '系统通知当前已关闭。';
  state.ai = settings.ai
    ? { ...settings.ai, protocol: normalizeAiProtocol(settings.ai.protocol), editingKey: false }
    : { configured: false, protocol: 'openai', endpoint: '', model: '', keyMask: '', editingKey: false };
  renderAiSettings();
  if (state.currentPage === 'assistant') renderAssistantConfigWarning();
}

function bindEvents() {
  $$('.nav-item[data-page]').forEach(button => button.addEventListener('click', () => switchPage(button.dataset.page)));
  $$('.ws-tab').forEach(tab => tab.addEventListener('click', () => switchPage(tab.dataset.page)));
  $('.nav-item[data-nav="workspace"]').addEventListener('click', () => switchPage(state.lastWorkspacePage));

  // 顶栏全局「新增」下拉：菜单项复用各页原有的新增入口，不新增业务逻辑
  const setNewMenuOpen = open => {
    $('#newMenuList').classList.toggle('hidden', !open);
    $('#newMenuButton').setAttribute('aria-expanded', String(open));
  };
  $('#newMenuButton').addEventListener('click', () => {
    setNewMenuOpen($('#newMenuList').classList.contains('hidden'));
  });
  $('#newMenuList').addEventListener('click', event => {
    const entry = event.target.closest('[data-new]');
    if (!entry) return;
    setNewMenuOpen(false);
    // 菜单项收起后不可见，先把焦点交给按钮，弹窗关闭时才有可回落的触发元素
    $('#newMenuButton').focus();
    if (entry.dataset.new === 'habit') openHabitModal();
    else openItemModal(entry.dataset.new);
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('#newMenu')) setNewMenuOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || $('#newMenuList').classList.contains('hidden')) return;
    setNewMenuOpen(false);
    $('#newMenuButton').focus();
  });
  $$('.new-kind-button').forEach(button => button.addEventListener('click', () => openItemModal(button.dataset.kind)));
  $$('.kind-segment button').forEach(button => button.addEventListener('click', () => setModalKind(button.dataset.kind)));
  $('#deadlineChips').addEventListener('click', event => {
    const chip = event.target.closest('button[data-day-offset]');
    if (!chip) return;
    const target = new Date();
    target.setDate(target.getDate() + Number(chip.dataset.dayOffset));
    $('#itemDeadlineDate').value = localDate(target);
    updateDeadlineAux();
  });
  $('#itemDeadlineDate').addEventListener('input', updateDeadlineAux);
  $('#itemDeadlineTime').addEventListener('input', updateDeadlineAux);
  $$('.modal-close').forEach(button => button.addEventListener('click', closeItemModal));
  $('#itemModal').addEventListener('click', event => { if (event.target === $('#itemModal')) closeItemModal(); });
  $('#itemForm').addEventListener('submit', saveItem);
  $('#confirmCancel').addEventListener('click', () => resolveConfirmation(false));
  $('#confirmAccept').addEventListener('click', () => resolveConfirmation(true));
  $('#confirmModal').addEventListener('click', event => { if (event.target === $('#confirmModal')) resolveConfirmation(false); });
  $$('.day-items-close').forEach(button => button.addEventListener('click', closeDayItems));
  $$('.detail-close').forEach(button => button.addEventListener('click', () => { closeItemDetail(); closeDayItems(); }));
  $('#detailBackButton').addEventListener('click', () => closeItemDetail(true));
  $('#dayItemsModal').addEventListener('click', event => { if (event.target === $('#dayItemsModal')) closeDayItems(); });
  $('#itemDetailModal').addEventListener('click', event => { if (event.target === $('#itemDetailModal')) { closeItemDetail(); closeDayItems(); } });
  $('#weekStrip').addEventListener('click', event => {
    const dayButton = event.target.closest('[data-day]');
    if (dayButton) openDayItems(dayButton.dataset.day);
  });
  $('#dayItemsList').addEventListener('click', event => {
    const itemButton = event.target.closest('[data-detail-id]');
    if (itemButton) openItemDetail(state.items.find(item => item.id === Number(itemButton.dataset.detailId)));
  });
  $('#itemDetailBody').addEventListener('click', event => {
    const attachmentButton = event.target.closest('[data-detail-attachment]');
    if (attachmentButton) execute(() => api.attachments.open(Number(attachmentButton.dataset.detailAttachment)));
  });
  $('#itemDetailBody').addEventListener('change', event => {
    if (!event.target.matches('#detailStatusSelect')) return;
    updateDetailStatus(Number(event.target.dataset.id), event.target.value);
  });

  $('#searchInput').addEventListener('input', event => { state.search = event.target.value.trim(); renderAll(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab' && modalStack.length) {
      const top = modalStack[modalStack.length - 1].backdrop;
      const items = focusableIn(top);
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (!top.contains(document.activeElement)) { event.preventDefault(); first.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      return;
    }
    if (event.key === 'Escape') {
      if (!modalStack.length) return;
      event.preventDefault();
      const top = modalStack[modalStack.length - 1]?.backdrop;
      if (state.confirmResolver) { resolveConfirmation(false); return; }
      if (top?.id === 'itemModal' && isItemFormDirty()) {
        askConfirmation('放弃未保存的修改？', '关闭后本次填写的内容不会保存。', '放弃修改')
          .then(confirmed => { if (confirmed) closeItemModal(); });
        return;
      }
      closeTopModal();
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#searchInput').focus(); }
  });

  $('#assignmentFilters').addEventListener('click', event => {
    const button = event.target.closest('button[data-filter]');
    if (!button) return;
    state.assignmentFilter = button.dataset.filter;
    $$('#assignmentFilters button').forEach(entry => {
      const active = entry === button;
      entry.classList.toggle('active', active);
      entry.setAttribute('aria-pressed', String(active));
    });
    renderAssignments(); mountIcons($('#assignmentList'));
  });
  $('#activityFilters').addEventListener('click', event => {
    const button = event.target.closest('button[data-filter]');
    if (!button) return;
    state.activityFilter = button.dataset.filter;
    $$('#activityFilters button').forEach(entry => {
      const active = entry === button;
      entry.classList.toggle('active', active);
      entry.setAttribute('aria-pressed', String(active));
    });
    renderActivities(); mountIcons($('#activityList'));
  });

  document.addEventListener('click', event => {
    const actionButton = event.target.closest('[data-action][data-id]');
    if (actionButton) handleItemAction(actionButton);
    const emptyAdd = event.target.closest('.empty-add');
    if (emptyAdd) {
      if (emptyAdd.dataset.kind === 'habit') openHabitModal();
      else openItemModal(emptyAdd.dataset.kind || 'assignment');
    }
  });

  $('#selectAttachmentButton').addEventListener('click', async () => {
    const files = await execute(() => api.attachments.select());
    if (!files?.length) return;
    const names = new Set([...state.existingAttachments.map(file => file.original_name), ...state.selectedFiles.map(file => file.name)]);
    state.selectedFiles.push(...files.filter(file => !names.has(file.name)));
    renderModalAttachments();
  });
  $('#attachmentList').addEventListener('click', async event => {
    const selectedDelete = event.target.closest('[data-selected-delete]');
    if (selectedDelete) { state.selectedFiles.splice(Number(selectedDelete.dataset.selectedDelete), 1); renderModalAttachments(); return; }
    const openButton = event.target.closest('[data-attachment-open]');
    if (openButton) { await execute(() => api.attachments.open(Number(openButton.dataset.attachmentOpen))); return; }
    const deleteButton = event.target.closest('[data-attachment-delete]');
    if (deleteButton) {
      const confirmed = await askConfirmation('删除这个附件？', '附件文件将被永久删除。', '删除');
      if (!confirmed) return;
      const removed = await execute(() => api.attachments.remove(Number(deleteButton.dataset.attachmentDelete)), '附件已删除');
      if (removed) { state.existingAttachments = state.existingAttachments.filter(file => file.id !== Number(deleteButton.dataset.attachmentDelete)); renderModalAttachments(); await refreshItems(); }
    }
  });

  $('#showAllButton').addEventListener('click', openAllUpcoming);
  $$('[data-goto]').forEach(button => button.addEventListener('click', () => switchPage(button.dataset.goto)));
  $('#notificationButton').addEventListener('click', () => { switchPage('settings'); showToast(state.notificationsEnabled ? '系统通知已开启' : '系统通知已关闭'); });
  $('#notificationToggle').addEventListener('change', async event => {
    const enabled = await execute(() => api.settings.setNotifications(event.target.checked), event.target.checked ? '系统通知已开启' : '系统通知已关闭');
    if (enabled !== null) { state.notificationsEnabled = Boolean(enabled); $('#notificationSummary').textContent = enabled ? '应用在托盘运行时会检查到期事项。' : '系统通知当前已关闭。'; }
  });
  $('#widgetToggle').addEventListener('change', async event => {
    const result = await execute(() => api.settings.setWidget(event.target.checked));
    if (result !== null) showToast(event.target.checked ? '桌面小组件已显示' : '桌面小组件已隐藏');
  });
  $('#aiKeyEditButton').addEventListener('click', () => {
    if (state.ai.editingKey === true) return;
    state.ai.editingKey = true;
    renderAiSettings();
    $('#aiKeyInput').focus();
  });
  $('#aiSettingsSave').addEventListener('click', async () => { await saveAiSettings(); });
  $('#backupButton').addEventListener('click', async () => {
    const path = await execute(() => api.data.backup());
    if (path) showToast(`备份已保存：${path}`);
  });
  $('#restoreButton').addEventListener('click', async () => {
    const confirmed = await askConfirmation('从备份恢复？', '恢复会覆盖当前全部事项、附件和日记。建议先导出当前数据备份。', '选择备份');
    if (!confirmed) return;
    const restored = await execute(() => api.data.restore());
    if (restored) {
      showToast('备份已恢复');
      state.diaryDates = new Set();
      await Promise.all([refreshItems(), refreshHabits()]);
      await refreshAssistantConfig();
      renderAiSettings();
    }
  });
  $('#clearDataButton').addEventListener('click', async () => {
    const first = await askConfirmation('清空全部数据？', '所有事项、附件和日记将被永久删除。此操作无法撤销。', '继续');
    if (!first) return;
    const second = await askConfirmation('再次确认清空', '请确认你已经备份了需要保留的数据。', '永久清空');
    if (!second) return;
    const cleared = await execute(() => api.data.clear(), '全部数据已清空');
    if (cleared) { state.diaryDates = new Set(); await Promise.all([refreshItems(), refreshHabits()]); }
  });
  $('#openDataFolderButton').addEventListener('click', () => execute(() => api.settings.showDataFolder()));

  $('#diaryGrid').addEventListener('click', event => {
    const cell = event.target.closest('[data-diary-date]');
    if (cell) selectDiaryDate(cell.dataset.diaryDate);
  });
  $('#diaryPrevMonth').addEventListener('click', () => shiftDiaryMonth(-1));
  $('#diaryNextMonth').addEventListener('click', () => shiftDiaryMonth(1));
  $('#diaryTodayButton').addEventListener('click', () => selectDiaryDate(localDate()));
  $('#diaryContent').addEventListener('input', () => {
    updateDiaryAux();
    setDiaryStatus('typing');
    scheduleDiarySave();
  });
  $('#diaryContent').addEventListener('blur', () => flushDiarySave());
  $('#diaryDeleteButton').addEventListener('click', async () => {
    const dateValue = state.diaryDate;
    if (!dateValue || !$('#diaryContent').value) return;
    const confirmed = await askConfirmation('删除这篇日记？', `${formatDate(dateValue, true)}的日记内容将被永久删除。`, '删除');
    if (!confirmed) return;
    const removed = await execute(() => api.diary.remove(dateValue), '日记已删除');
    if (!removed) return;
    state.diaryDates.delete(dateValue);
    if (state.diaryDate === dateValue) {
      $('#diaryContent').value = '';
      state.diarySavedContent = '';
      updateDiaryAux();
      setDiaryStatus('empty');
    }
    renderDiaryCalendar();
  });

  $('#assistantInput').addEventListener('input', event => {
    state.assistant.input = event.target.value;
    const counter = $('#assistantCounter');
    counter.textContent = `${state.assistant.input.length} / ${ASSISTANT_INPUT_MAX_LENGTH}`;
    counter.classList.toggle('over', state.assistant.input.length > ASSISTANT_INPUT_MAX_LENGTH);
  });
  $('#assistantSubmit').addEventListener('click', () => submitAssistant());
  $('#assistantRetry').addEventListener('click', () => submitAssistant({ retry: true }));
  $('#assistantGoSettings').addEventListener('click', () => switchPage('settings'));
  $('#assistantResult').addEventListener('click', assistantHandleResultClick);
  $('#assistantResult').addEventListener('change', assistantHandleChange);
  $('#assistantResult').addEventListener('input', assistantHandleInput);

  $('#newHabitButton').addEventListener('click', () => openHabitModal());
  $('#habitForm').addEventListener('submit', saveHabit);
  $$('.habit-modal-close').forEach(button => button.addEventListener('click', closeHabitModal));
  $('#habitModal').addEventListener('click', event => { if (event.target === $('#habitModal')) closeHabitModal(); });
  $('#habitList').addEventListener('click', event => {
    const toggle = event.target.closest('[data-habit-toggle]');
    if (toggle) { toggleHabitCheckin(Number(toggle.dataset.habitToggle), localDate()); return; }
    const dot = event.target.closest('[data-habit-dot]');
    if (dot) { toggleHabitCheckin(Number(dot.dataset.habitDot), dot.dataset.date); return; }
    const edit = event.target.closest('[data-habit-edit]');
    if (edit) {
      const habit = state.habits.find(entry => entry.id === Number(edit.dataset.habitEdit));
      if (habit) openHabitModal(habit);
      return;
    }
    const archive = event.target.closest('[data-habit-archive]');
    if (archive) { setHabitArchived(Number(archive.dataset.habitArchive), true); return; }
    const remove = event.target.closest('[data-habit-delete]');
    if (remove) deleteHabit(Number(remove.dataset.habitDelete));
  });
  $('#habitCardList').addEventListener('click', event => {
    const toggle = event.target.closest('[data-habit-toggle]');
    if (toggle) toggleHabitCheckin(Number(toggle.dataset.habitToggle), localDate());
  });
  $('#habitArchivedToggle').addEventListener('click', () => {
    state.habitArchivedOpen = !state.habitArchivedOpen;
    $('#habitArchivedList').classList.toggle('hidden', !state.habitArchivedOpen);
  });
  $('#habitArchivedList').addEventListener('click', event => {
    const restore = event.target.closest('[data-habit-restore]');
    if (restore) { setHabitArchived(Number(restore.dataset.habitRestore), false); return; }
    const remove = event.target.closest('[data-habit-delete]');
    if (remove) deleteHabit(Number(remove.dataset.habitDelete));
  });
  api.habits.onChanged(refreshHabits);
  api.items.onOpenRequest(openItemById);
  window.addEventListener('beforeunload', () => flushDiarySave());
}

async function initialize() {
  mountIcons();
  updateCurrentDate();
  bindEvents();
  $$('.nav-item').forEach(button => {
    if (button.classList.contains('active')) button.setAttribute('aria-current', 'page');
  });
  await Promise.all([refreshItems(), initializeSettings(), refreshHabits()]);
  // 逾期状态随时间推移产生，每分钟检查一次；仅在跨天或逾期集合变化时才重渲染，避免打扰进行中的操作
  let lastTickSignature = '';
  setInterval(() => {
    const signature = `${localDate()}|${state.items.filter(isOverdue).map(item => item.id).join(',')}`;
    if (signature === lastTickSignature) return;
    lastTickSignature = signature;
    updateCurrentDate();
    renderAll();
    refreshHabits();
  }, 60000);
}

initialize();
