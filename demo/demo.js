const pageNames = { today: '今天', assignments: '大作业', activities: '活动', stats: '统计', settings: '设置' };
const pages = { today: '#todayPage', assignments: '#listPage', activities: '#listPage', stats: '#statsPage', settings: '#settingsPage' };
const $ = (selector) => document.querySelector(selector);

function switchPage(page) {
  document.querySelectorAll('.rail-button').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
  document.querySelectorAll('.content').forEach((section) => section.classList.add('hidden'));
  $(pages[page]).classList.remove('hidden');
  $('#crumbPage').textContent = pageNames[page];
  if (page === 'activities') $('#listTitle').textContent = '活动';
  if (page === 'assignments') $('#listTitle').textContent = '大作业';
}

document.querySelectorAll('.rail-button').forEach((button) => button.addEventListener('click', () => switchPage(button.dataset.page)));
$('#showAll').addEventListener('click', () => switchPage('assignments'));
$('#themeButton').addEventListener('click', () => document.body.classList.toggle('dark'));
$('#searchInput').addEventListener('input', (event) => {
  const query = event.target.value.trim().toLowerCase();
  document.querySelectorAll('.task-row').forEach((row) => row.classList.toggle('hidden', query && !row.dataset.title.toLowerCase().includes(query)));
});
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#searchInput').focus(); }
});
document.querySelectorAll('.task-check').forEach((button) => button.addEventListener('click', () => {
  button.classList.toggle('checked');
  button.closest('.task-row').classList.toggle('done');
  const pending = document.querySelectorAll('.task-row:not(.done):not(.hidden)').length;
  $('#taskCount').textContent = pending;
}));
document.querySelectorAll('.day').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.day').forEach((day) => day.classList.remove('active'));
  button.classList.add('active');
}));
document.querySelectorAll('.toggle').forEach((button) => button.addEventListener('click', () => button.classList.toggle('off')));

function openModal() { $('#addModal').classList.remove('hidden'); setTimeout(() => $('#newTaskInput').focus(), 0); }
function closeModal() { $('#addModal').classList.add('hidden'); }
$('#addButton').addEventListener('click', openModal); $('#subAddButton').addEventListener('click', openModal); $('#closeModal').addEventListener('click', closeModal); $('#cancelModal').addEventListener('click', closeModal);
$('#saveDemo').addEventListener('click', () => { closeModal(); $('#newTaskInput').value = ''; $('#taskCount').textContent = Number($('#taskCount').textContent) + 1; });
$('#addModal').addEventListener('click', (event) => { if (event.target === $('#addModal')) closeModal(); });
