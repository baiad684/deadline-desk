const api = window.deadlineDesk;
const shellEl = document.querySelector('.widget-shell');
const views = { deadlines: document.querySelector('#widgetRows'), habits: document.querySelector('#widgetHabits') };
const tabButtons = { deadlines: document.querySelector('#tabDeadlines'), habits: document.querySelector('#tabHabits') };
const tabBadges = { deadlines: document.querySelector('#tabDeadlinesBadge'), habits: document.querySelector('#tabHabitsBadge') };
const pinButton = document.querySelector('#pinButton');

let pinned = false;
let activeTab = 'deadlines';
let dragging = false;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function dayLabel(days) {
  if (days < 0) return `逾期 ${-days} 天`;
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  return `${days} 天后`;
}

function dueLine(item) {
  const [datePart, timePart] = item.deadline.split(' ');
  const [, month, day] = datePart.split('-').map(Number);
  // 23:59 视为“当天截止”，与主界面保持一致不展示时刻
  const timeSuffix = timePart && timePart !== '23:59' ? ` ${timePart}` : '';
  return `${month} 月 ${day} 日${timeSuffix}到期 · ${item.kind === 'assignment' ? '大作业' : '活动'}`;
}

function rowHtml(item) {
  // 与主应用今日列表同款三档色调：逾期红 / 今天明天警示 / 其余品牌绿
  const tone = item.days < 0 ? 'danger' : item.days <= 1 ? 'warning' : 'progress';
  return `<button type="button" class="todo-row ${tone}" data-id="${item.id}"><i></i><div class="row-text"><b>${escapeHtml(item.title)}</b><span>${dueLine(item)}</span></div><em>${dayLabel(item.days)}</em></button>`;
}

function habitRowHtml(habit) {
  // 连击徽标只在有连续记录时展示；已完成行沉底并弱化
  const badge = habit.streak > 0 ? `<em>连 ${habit.streak} 天</em>` : '';
  const action = habit.done ? `取消打卡：${habit.title}` : `打卡：${habit.title}${habit.streak > 0 ? `，已连续 ${habit.streak} 天` : ''}`;
  return `<button type="button" class="widget-habit-row${habit.done ? ' done' : ''}" data-habit-id="${habit.id}" aria-label="${escapeHtml(action)}" title="${habit.done ? '点击取消今天的打卡' : '点击打卡'}"><i aria-hidden="true"></i><div class="row-text"><b>${escapeHtml(habit.title)}</b></div>${badge}</button>`;
}

const EMPTY_ITEMS_HTML = '<div class="widget-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg><span>未来 7 天没有待办的截止事项</span></div>';
const EMPTY_HABITS_HTML = '<div class="widget-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg><span>还没有日常任务</span><button type="button" class="widget-empty-action">去主应用添加</button></div>';

function replaceView(el, html) {
  // 整体重建 innerHTML 时保留滚动位置，避免打卡推送后列表跳动
  const scrollTop = el.scrollTop;
  el.innerHTML = html;
  el.scrollTop = scrollTop;
}

function render(snapshot) {
  if (!snapshot) return;
  const habits = snapshot.habits || [];
  tabBadges.deadlines.textContent = String(snapshot.count);
  tabBadges.habits.textContent = `${habits.filter(habit => habit.done).length}/${habits.length}`;
  tabBadges.habits.hidden = !habits.length;
  replaceView(views.deadlines, snapshot.items.length ? snapshot.items.map(rowHtml).join('') : EMPTY_ITEMS_HTML);
  const ordered = [...habits.filter(habit => !habit.done), ...habits.filter(habit => habit.done)];
  replaceView(views.habits, ordered.length ? ordered.map(habitRowHtml).join('') : EMPTY_HABITS_HTML);
  if (typeof snapshot.pinned === 'boolean') {
    pinned = snapshot.pinned;
    pinButton.setAttribute('aria-pressed', String(pinned));
  }
  reportHeight();
}

function setTab(tab, { persist = true } = {}) {
  activeTab = tab;
  for (const key of Object.keys(views)) {
    const selected = key === tab;
    tabButtons[key].setAttribute('aria-selected', String(selected));
    tabButtons[key].tabIndex = selected ? 0 : -1;
    views[key].classList.toggle('active', selected);
  }
  if (persist) { try { localStorage.setItem('widget-tab', tab); } catch { /* 存储不可用仅影响记忆 */ } }
  reportHeight();
}

function reportHeight() {
  // 拖动会话中窗口尺寸锁定，跳过上报；结束后下一帧自愈
  if (dragging) return;
  requestAnimationFrame(() => {
    // 先解除 max-height 钳制取内容自然高：直接读 offsetHeight 会恒等于当前视口高，窗口便只缩不涨
    const prev = shellEl.style.maxHeight;
    shellEl.style.maxHeight = 'none';
    const natural = shellEl.offsetHeight;
    shellEl.style.maxHeight = prev;
    api.widget.resize(natural + 32).catch(() => {});
  });
}

document.querySelector('.widget-tabs').addEventListener('click', event => {
  const tab = event.target.closest('.widget-tab')?.dataset.tab;
  if (tab && tab !== activeTab) setTab(tab);
});
document.querySelector('.widget-tabs').addEventListener('keydown', event => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  setTab(activeTab === 'deadlines' ? 'habits' : 'deadlines');
  tabButtons[activeTab].focus();
});

views.deadlines.addEventListener('click', event => {
  if (event.target.closest('.todo-row')) api.widget.openMain();
});
views.habits.addEventListener('click', event => {
  const habitRow = event.target.closest('.widget-habit-row');
  if (habitRow) {
    // 打卡结果由主进程 notifyWidgets 推送新快照刷新；主进程拒绝（如任务刚被删除）时静默忽略
    api.widget.toggleCheckin(Number(habitRow.dataset.habitId)).catch(() => {});
    return;
  }
  if (event.target.closest('.widget-empty-action')) api.widget.openMain();
});

// 手动拖动：把手 = 页头 + tab 栏背景（.drag-zone）；按钮（tab / 置顶 / 关闭）不触发拖动。
// 位移以 dragStart 时的屏幕坐标为原点，主进程叠加到窗口原位置上
let dragPointerId = null;
let pendingDragMove = null;
let dragMoveFrame = 0;

function flushDragMove() {
  dragMoveFrame = 0;
  if (dragPointerId === null || !pendingDragMove) return;
  api.widget.dragMove(pendingDragMove.x, pendingDragMove.y);
  pendingDragMove = null;
}

function stopDrag() {
  dragPointerId = null;
  dragging = false;
  if (dragMoveFrame) { cancelAnimationFrame(dragMoveFrame); dragMoveFrame = 0; }
  // 松手前把最后一帧位移送达（IPC 保序，先于 drag-end），避免窗口比指针略落后
  if (pendingDragMove) api.widget.dragMove(pendingDragMove.x, pendingDragMove.y);
  pendingDragMove = null;
  api.widget.dragEnd();
  reportHeight();
}

document.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  if (!event.target.closest('.drag-zone') || event.target.closest('button')) return;
  dragPointerId = event.pointerId;
  dragging = true;
  try { event.target.setPointerCapture(event.pointerId); } catch { /* 捕获失败仍可拖动，仅指针出窗后丢事件 */ }
  // 必须用屏幕坐标：视口坐标随窗口自身移动变化，会与窗口跟随形成正反馈，拖动时来回抖动
  api.widget.dragStart(event.screenX, event.screenY);
});
document.addEventListener('pointermove', event => {
  if (dragPointerId !== event.pointerId) return;
  // rAF 节流：同一帧内多次 pointermove 只上报最新坐标
  pendingDragMove = { x: event.screenX, y: event.screenY };
  if (!dragMoveFrame) dragMoveFrame = requestAnimationFrame(flushDragMove);
});
document.addEventListener('pointerup', event => {
  if (dragPointerId === null || event.pointerId !== dragPointerId) return;
  stopDrag();
});
document.addEventListener('pointercancel', event => {
  if (dragPointerId === null || event.pointerId !== dragPointerId) return;
  stopDrag();
});
window.addEventListener('blur', () => {
  // 焦点被抢（如 Alt+Tab）时结束会话，避免主进程拖动状态悬挂
  if (dragPointerId !== null) stopDrag();
});

pinButton.addEventListener('click', async () => {
  pinned = !pinned;
  pinButton.setAttribute('aria-pressed', String(pinned));
  try { await api.widget.setPinned(pinned); } catch { /* 主进程不可用时仅保留视觉状态 */ }
});
document.querySelector('#closeButton').addEventListener('click', () => window.close());

(async () => {
  let restored = null;
  try { restored = localStorage.getItem('widget-tab'); } catch { /* 忽略脏数据 */ }
  setTab(restored === 'habits' ? 'habits' : 'deadlines', { persist: false });
  render(await api.widget.getData());
  api.widget.onData(render);
  // 定时重拉：跨天时“今天/逾期”等相对天数由主进程重算
  setInterval(() => { api.widget.getData().then(render).catch(() => {}); }, 10 * 60 * 1000);
})();
