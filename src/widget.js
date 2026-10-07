const api = window.deadlineDesk;
const rowsEl = document.querySelector('#widgetRows');
const countEl = document.querySelector('#widgetCount');

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
  const [, month, day] = item.deadline.split('-').map(Number);
  return `${month} 月 ${day} 日到期 · ${item.kind === 'assignment' ? '大作业' : '活动'}`;
}

function rowHtml(item) {
  const tone = item.days < 0 ? 'overdue' : item.days === 0 ? 'today' : '';
  return `<button type="button" class="todo-row ${tone}" data-id="${item.id}"><i></i><div class="row-text"><b>${escapeHtml(item.title)}</b><span>${dueLine(item)}</span></div><em>${dayLabel(item.days)}</em></button>`;
}

function render(snapshot) {
  if (!snapshot) return;
  countEl.textContent = `${snapshot.count} 项待办`;
  rowsEl.innerHTML = snapshot.items.length
    ? snapshot.items.map(rowHtml).join('')
    : '<div class="ios-empty">未来 7 天没有待办的截止事项</div>';
  if (typeof snapshot.pinned === 'boolean') {
    pinned = snapshot.pinned;
    pinButton.setAttribute('aria-pressed', String(pinned));
  }
  reportHeight();
}

function reportHeight() {
  const shell = document.querySelector('.widget-shell');
  requestAnimationFrame(() => { api.widget.resize(shell.offsetHeight + 32).catch(() => {}); });
}

rowsEl.addEventListener('click', event => {
  if (event.target.closest('.todo-row')) api.widget.openMain();
});

let pinned = false;
const pinButton = document.querySelector('#pinButton');
pinButton.addEventListener('click', async () => {
  pinned = !pinned;
  pinButton.setAttribute('aria-pressed', String(pinned));
  try { await api.widget.setPinned(pinned); } catch { /* 主进程不可用时仅保留视觉状态 */ }
});
document.querySelector('#closeButton').addEventListener('click', () => window.close());

(async () => {
  render(await api.widget.getData());
  api.widget.onData(render);
  // 定时重拉：跨天时“今天/逾期”等相对天数由主进程重算
  setInterval(async () => render(await api.widget.getData()), 10 * 60 * 1000);
})();
