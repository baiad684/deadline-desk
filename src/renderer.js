const icons = {
  flag: '<path d="M5 22V4"/><path d="M5 5c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
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
  folder: '<path d="M3 5h6l2 2h10v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  warning: '<path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  inbox: '<path d="M4 4h16v16H4z"/><path d="M4 14h4l2 3h4l2-3h4"/>'
};

const state = {
  items: [],
  currentPage: 'today',
  assignmentFilter: 'all',
  activityFilter: 'all',
  search: '',
  modalKind: 'assignment',
  selectedFiles: [],
  existingAttachments: [],
  confirmResolver: null,
  notificationsEnabled: true
};

const api = window.deadlineDesk;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

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

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function daysUntil(value) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((parseDate(value) - today) / 86400000);
}

function isCompleted(item) { return item.status === 'completed'; }
function isOverdue(item) { return !isCompleted(item) && daysUntil(item.deadline) < 0; }
function isPending(item) { return !isCompleted(item); }

function formatDate(value, includeYear = false) {
  const date = parseDate(value);
  return `${includeYear ? `${date.getFullYear()}年` : ''}${date.getMonth() + 1}月${date.getDate()}日`;
}

function timingLabel(item) {
  if (isCompleted(item)) return '已完成';
  const days = daysUntil(item.deadline);
  if (days < 0) return `已逾期 ${Math.abs(days)} 天`;
  if (days === 0) return '今天到期';
  if (days === 1) return '明天到期';
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
    return isPending(item) && days >= 0 && days <= 7;
  }).length;
  $('#todayCount').textContent = actionable;
  $('#assignmentCount').textContent = state.items.filter(item => item.kind === 'assignment').length;
  $('#activityCount').textContent = state.items.filter(item => item.kind === 'activity').length;
  const attachmentCount = state.items.reduce((total, item) => total + item.attachments.length, 0);
  $('#storageSummary').textContent = `${state.items.length} 条记录 · ${attachmentCount} 个附件`;
}

function statusButton(item) {
  return `<button class="status-button ${isCompleted(item) ? 'completed' : ''}" data-action="status" data-id="${item.id}" title="切换状态"><span class="status-ring">${isCompleted(item) ? `<svg class="icon sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m5 12 4 4L19 6"/></svg>` : ''}</span><span>${escapeHtml(statusLabel(item))}</span></button>`;
}

function renderToday() {
  const actionable = sorted(state.items.filter(item => {
    const days = daysUntil(item.deadline);
    return isPending(item) && days >= 0 && days <= 7 && matchesSearch(item);
  }));
  const overdue = state.items.filter(isOverdue).length;
  $('#todaySubtitle').textContent = actionable.length
    ? `${actionable.length} 个事项将在未来 7 天内到期。`
    : state.items.length ? '未来 7 天没有需要处理的事项。' : '添加事项后，这里会自动显示临期内容。';

  const list = $('#deadlineList');
  if (!actionable.length) {
    list.innerHTML = emptyState(state.items.length ? '暂无到期事项' : '从第一条截止日期开始', state.items.length ? '可以放心推进手头的事情。' : '添加大作业或活动，截止线会帮你集中追踪。', '新增事项', 'assignment');
  } else {
    list.innerHTML = actionable.map(item => {
      const date = parseDate(item.deadline);
      const days = daysUntil(item.deadline);
      const badgeClass = days < 0 ? 'danger' : days <= 1 ? 'warning' : 'progress';
      const typeBadge = item.kind === 'assignment' ? `<span class="badge ${item.work_type === 'team' ? 'team' : 'personal'}">${item.work_type === 'team' ? '团队' : '个人'}</span>` : '<span class="badge progress">活动</span>';
      return `<article class="deadline-row">
        <div class="date-box ${days < 0 ? 'overdue' : ''}"><strong>${date.getDate()}</strong>${date.getMonth() + 1}月</div>
        <div class="row-copy"><div class="row-title"><strong>${escapeHtml(item.title)}</strong>${typeBadge}<span class="badge ${badgeClass}">${escapeHtml(timingLabel(item))}</span></div><div class="row-sub">${escapeHtml(item.description || `${kindLabel(item)} · 暂无补充说明`)}</div></div>
        <div class="row-actions">${statusButton(item)}<button class="icon-button" data-action="edit" data-id="${item.id}" title="编辑"><span data-icon="edit"></span></button></div>
      </article>`;
    }).join('');
  }

  const pending = state.items.filter(isPending).length;
  const progress = state.items.filter(item => item.status === 'in_progress').length;
  const now = new Date();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const weekDone = state.items.filter(item => isCompleted(item) && new Date(`${item.updated_at.replace(' ', 'T')}Z`) >= weekStart).length;
  $('#pendingMetric').innerHTML = `${pending}<small>项</small>`;
  $('#overdueMetric').innerHTML = `${overdue}<small>项</small>`;
  $('#progressMetric').innerHTML = `${progress}<small>项</small>`;
  $('#weekDoneMetric').innerHTML = `${weekDone}<small>项</small>`;
  renderWeekStrip();
}

function renderWeekStrip() {
  const labels = ['日', '一', '二', '三', '四', '五', '六'];
  const today = new Date();
  const dates = Array.from({ length: 7 }, (_, index) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + index));
  $('#weekStrip').innerHTML = dates.map((date, index) => {
    const dateValue = localDate(date);
    const hasItems = state.items.some(item => isPending(item) && item.deadline === dateValue);
    return `<button type="button" class="week-day ${index === 0 ? 'today' : ''} ${hasItems ? 'has-item' : ''}" ${hasItems ? `data-day="${dateValue}" title="查看当天待办"` : 'disabled'}>${labels[date.getDay()]}<strong>${date.getDate()}</strong></button>`;
  }).join('');
}

function openDayItems(dateValue) {
  const items = sorted(state.items.filter(item => isPending(item) && item.deadline === dateValue));
  if (!items.length) return;
  $('#dayItemsTitle').textContent = `${formatDate(dateValue, true)}待办`;
  $('#dayItemsSubtitle').textContent = `共 ${items.length} 个未完成事项`;
  $('#dayItemsList').innerHTML = items.map(item => `<button type="button" class="day-item-button" data-detail-id="${item.id}">
    <span class="day-item-kind" data-icon="${item.kind === 'assignment' ? 'book' : 'ticket'}"></span>
    <span class="day-item-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.description || `${kindLabel(item)} · 暂无补充说明`)}</span></span>
    <span class="day-item-arrow" data-icon="external"></span>
  </button>`).join('');
  mountIcons($('#dayItemsList'));
  $('#dayItemsModal').classList.add('open');
  $('#dayItemsModal').setAttribute('aria-hidden', 'false');
}

function closeDayItems() {
  $('#dayItemsModal').classList.remove('open');
  $('#dayItemsModal').setAttribute('aria-hidden', 'true');
}

function openItemDetail(item) {
  if (!item) return;
  $('#detailTitle').textContent = item.title;
  $('#detailSubtitle').textContent = `${kindLabel(item)} · ${formatDate(item.deadline, true)}`;
  const typeBadge = item.kind === 'assignment' ? `<span class="badge ${item.work_type === 'team' ? 'team' : 'personal'}">${item.work_type === 'team' ? '团队' : '个人'}</span>` : '<span class="badge progress">活动</span>';
  const timingClass = isOverdue(item) ? 'danger' : daysUntil(item.deadline) <= 1 ? 'warning' : 'progress';
  const attachments = item.attachments.length ? `<div class="detail-attachments"><strong>要求附件</strong>${item.attachments.map(file => `<button type="button" class="detail-attachment" data-detail-attachment="${file.id}"><span data-icon="file"></span><span class="detail-attachment-copy"><strong>${escapeHtml(file.original_name)}</strong><span>${formatSize(file.size)}</span></span><span data-icon="external"></span></button>`).join('')}</div>` : '';
  $('#itemDetailBody').innerHTML = `<div class="detail-badges">${typeBadge}<span class="badge ${statusClass(item)}">${escapeHtml(statusLabel(item))}</span><span class="badge ${timingClass}">${escapeHtml(timingLabel(item))}</span></div>
    <div class="detail-grid"><div class="detail-block"><span>截止日期</span><strong>${formatDate(item.deadline, true)}</strong></div><div class="detail-block"><span>当前状态</span><strong>${escapeHtml(statusLabel(item))}</strong></div><div class="detail-block full"><span>要求说明</span><strong>${escapeHtml(item.description || '暂无补充说明')}</strong></div></div>${attachments}`;
  mountIcons($('#itemDetailBody'));
  $('#dayItemsModal').classList.remove('open');
  $('#itemDetailModal').classList.add('open');
  $('#itemDetailModal').setAttribute('aria-hidden', 'false');
}

function closeItemDetail(returnToDay = false) {
  $('#itemDetailModal').classList.remove('open');
  $('#itemDetailModal').setAttribute('aria-hidden', 'true');
  if (returnToDay) $('#dayItemsModal').classList.add('open');
}

function renderAssignments() {
  let items = state.items.filter(item => item.kind === 'assignment' && matchesSearch(item));
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
    <div class="deadline-cell ${isOverdue(item) ? 'overdue' : ''}"><strong>${formatDate(item.deadline)}</strong><span>${timingLabel(item)}</span></div>
    <div><span class="badge ${statusClass(item)}">${statusLabel(item)}</span></div>
    <div class="table-actions"><button class="icon-button" data-action="edit" data-id="${item.id}" title="编辑"><span data-icon="edit"></span></button><button class="icon-button" data-action="delete" data-id="${item.id}" title="删除"><span data-icon="trash"></span></button></div>
  </article>`).join('');
}

function renderActivities() {
  let items = state.items.filter(item => item.kind === 'activity' && matchesSearch(item));
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
    <div class="deadline-cell ${isOverdue(item) ? 'overdue' : ''}"><strong>${formatDate(item.deadline)}</strong><span>${timingLabel(item)}</span></div>
    <div>${statusButton(item)}</div>
    <div class="table-actions"><button class="icon-button" data-action="edit" data-id="${item.id}" title="编辑"><span data-icon="edit"></span></button><button class="icon-button" data-action="delete" data-id="${item.id}" title="删除"><span data-icon="trash"></span></button></div>
  </article>`).join('');
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

  const risks = sorted(state.items.filter(item => isPending(item) && daysUntil(item.deadline) <= 7)).slice(0, 6);
  $('#riskList').innerHTML = risks.length ? risks.map(item => {
    const days = daysUntil(item.deadline);
    return `<div class="risk-item ${days < 0 ? 'danger' : days <= 1 ? 'warning' : ''}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(kindLabel(item))} · ${escapeHtml(timingLabel(item))}</span></div>`;
  }).join('') : emptyState('当前没有截止风险', '逾期和未来 7 天内到期的事项会显示在这里。');
}

function renderAll() {
  renderNavigation();
  renderToday();
  renderAssignments();
  renderActivities();
  renderStats();
  mountIcons();
}

async function refreshItems() {
  const items = await execute(() => api.items.list());
  if (items) {
    state.items = items;
    renderAll();
  }
}

function switchPage(page) {
  state.currentPage = page;
  $$('.nav-item[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  $$('.page').forEach(view => view.classList.toggle('active', view.dataset.pageView === page));
  $('#searchBox').classList.toggle('hidden', page === 'settings');
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
  $('#itemDeadline').value = item?.deadline || localDate();
  if (item?.work_type) $('#itemWorkType').value = item.work_type;
  $('#itemStatus').value = item?.status || (state.modalKind === 'assignment' ? 'not_started' : 'not_completed');
  renderModalAttachments();
  $('#itemModal').classList.add('open');
  $('#itemModal').setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#itemTitle').focus(), 0);
}

function closeItemModal() {
  $('#itemModal').classList.remove('open');
  $('#itemModal').setAttribute('aria-hidden', 'true');
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderModalAttachments() {
  const list = $('#attachmentList');
  const existing = state.existingAttachments.map(file => `<div class="attachment-item"><span data-icon="file"></span><div class="attachment-copy"><strong>${escapeHtml(file.original_name)}</strong><span>${formatSize(file.size)}</span></div><div class="attachment-actions"><button type="button" class="icon-button" data-attachment-open="${file.id}" title="打开"><span data-icon="external"></span></button><button type="button" class="icon-button" data-attachment-delete="${file.id}" title="删除"><span data-icon="trash"></span></button></div></div>`);
  const selected = state.selectedFiles.map((file, index) => `<div class="attachment-item"><span data-icon="file"></span><div class="attachment-copy"><strong>${escapeHtml(file.name)}</strong><span>${formatSize(file.size)} · 待保存</span></div><div class="attachment-actions"><button type="button" class="icon-button" data-selected-delete="${index}" title="移除"><span data-icon="close"></span></button></div></div>`);
  list.innerHTML = [...existing, ...selected].join('') || '<div class="attachment-empty">尚未选择附件</div>';
  mountIcons(list);
}

function askConfirmation(title, message, acceptLabel = '确认') {
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  $('#confirmAccept').textContent = acceptLabel;
  $('#confirmModal').classList.add('open');
  $('#confirmModal').setAttribute('aria-hidden', 'false');
  return new Promise(resolve => { state.confirmResolver = resolve; });
}

function resolveConfirmation(value) {
  $('#confirmModal').classList.remove('open');
  $('#confirmModal').setAttribute('aria-hidden', 'true');
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
    deadline: $('#itemDeadline').value,
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

async function handleItemAction(button) {
  const id = Number(button.dataset.id);
  const item = state.items.find(entry => entry.id === id);
  if (!item) return;
  if (button.dataset.action === 'edit') openItemModal(item.kind, item);
  if (button.dataset.action === 'status') {
    const updated = await execute(() => api.items.setStatus(id, nextStatus(item)), '状态已更新');
    if (updated) await refreshItems();
  }
  if (button.dataset.action === 'delete') {
    const confirmed = await askConfirmation('删除这个事项？', `“${item.title}”及其全部附件将被永久删除。`, '删除');
    if (!confirmed) return;
    const removed = await execute(() => api.items.remove(id), '事项已删除');
    if (removed) await refreshItems();
  }
}

async function initializeSettings() {
  const settings = await execute(() => api.settings.get());
  if (!settings) return;
  state.notificationsEnabled = settings.notificationsEnabled;
  $('#notificationToggle').checked = settings.notificationsEnabled;
  $('#widgetToggle').checked = settings.widgetEnabled !== false;
  $('#dataPath').textContent = settings.dataPath;
  $('#notificationSummary').textContent = settings.notificationsEnabled ? '应用在托盘运行时会检查到期事项。' : '系统通知当前已关闭。';
}

function bindEvents() {
  $$('.nav-item[data-page]').forEach(button => button.addEventListener('click', () => switchPage(button.dataset.page)));
  $$('.new-kind-button').forEach(button => button.addEventListener('click', () => openItemModal(button.dataset.kind)));
  $$('.kind-segment button').forEach(button => button.addEventListener('click', () => setModalKind(button.dataset.kind)));
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

  $('#searchInput').addEventListener('input', event => { state.search = event.target.value.trim(); renderAll(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeItemModal();
      closeItemDetail();
      closeDayItems();
      if (state.confirmResolver) resolveConfirmation(false);
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#searchInput').focus(); }
  });

  $('#assignmentFilters').addEventListener('click', event => {
    const button = event.target.closest('button[data-filter]');
    if (!button) return;
    state.assignmentFilter = button.dataset.filter;
    $$('#assignmentFilters button').forEach(entry => entry.classList.toggle('active', entry === button));
    renderAssignments(); mountIcons($('#assignmentList'));
  });
  $('#activityFilters').addEventListener('click', event => {
    const button = event.target.closest('button[data-filter]');
    if (!button) return;
    state.activityFilter = button.dataset.filter;
    $$('#activityFilters button').forEach(entry => entry.classList.toggle('active', entry === button));
    renderActivities(); mountIcons($('#activityList'));
  });

  document.addEventListener('click', event => {
    const actionButton = event.target.closest('[data-action][data-id]');
    if (actionButton) handleItemAction(actionButton);
    const emptyAdd = event.target.closest('.empty-add');
    if (emptyAdd) openItemModal(emptyAdd.dataset.kind || 'assignment');
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

  $('#showAllButton').addEventListener('click', () => switchPage('assignments'));
  $('#notificationButton').addEventListener('click', () => { switchPage('settings'); showToast(state.notificationsEnabled ? '系统通知已开启' : '系统通知已关闭'); });
  $('#notificationToggle').addEventListener('change', async event => {
    const enabled = await execute(() => api.settings.setNotifications(event.target.checked), event.target.checked ? '系统通知已开启' : '系统通知已关闭');
    if (enabled !== null) { state.notificationsEnabled = Boolean(enabled); $('#notificationSummary').textContent = enabled ? '应用在托盘运行时会检查到期事项。' : '系统通知当前已关闭。'; }
  });
  $('#widgetToggle').addEventListener('change', async event => {
    const result = await execute(() => api.settings.setWidget(event.target.checked));
    if (result !== null) showToast(event.target.checked ? '桌面小组件已显示' : '桌面小组件已隐藏');
  });
  $('#backupButton').addEventListener('click', async () => {
    const path = await execute(() => api.data.backup());
    if (path) showToast(`备份已保存：${path}`);
  });
  $('#restoreButton').addEventListener('click', async () => {
    const confirmed = await askConfirmation('从备份恢复？', '恢复会覆盖当前全部事项和附件。建议先导出当前数据备份。', '选择备份');
    if (!confirmed) return;
    const restored = await execute(() => api.data.restore());
    if (restored) { showToast('备份已恢复'); await refreshItems(); }
  });
  $('#clearDataButton').addEventListener('click', async () => {
    const first = await askConfirmation('清空全部数据？', '所有事项和附件将被永久删除。此操作无法撤销。', '继续');
    if (!first) return;
    const second = await askConfirmation('再次确认清空', '请确认你已经备份了需要保留的数据。', '永久清空');
    if (!second) return;
    const cleared = await execute(() => api.data.clear(), '全部数据已清空');
    if (cleared) await refreshItems();
  });
  $('#openDataFolderButton').addEventListener('click', () => execute(() => api.settings.showDataFolder()));
}

async function initialize() {
  mountIcons();
  updateCurrentDate();
  bindEvents();
  await Promise.all([refreshItems(), initializeSettings()]);
}

initialize();
