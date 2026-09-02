const form = document.getElementById('studentForm');
const photoInput = document.getElementById('photos');
const previewGrid = document.getElementById('previewGrid');
const statusBox = document.getElementById('status');
const saveBtn = document.getElementById('saveBtn');
const logoutBtn = document.getElementById('logoutBtn');

let selectedFiles = [];

async function ensureAuthenticated() {
  const response = await fetch('/api/me');
  const data = await response.json();
  if (!data.authenticated) window.location.href = '/';

  const driveResponse = await fetch('/api/google/status');
  const driveData = await driveResponse.json();
  if (!driveData.connected) {
    statusBox.className = 'status error';
    statusBox.textContent = 'Google Drive is not connected yet. Redirecting to Google authorization...';
    window.setTimeout(() => {
      window.location.href = '/auth/google';
    }, 1200);
    return false;
  }

  return true;
}

async function populateNextStudentId() {
  try {
    const response = await fetch('/api/students/next-id');
    const result = await response.json();
    if (response.ok && result.nextStudentId) {
      const idField = document.getElementById('studentId');
      if (idField && !idField.value) idField.value = result.nextStudentId;
    }
  } catch (_error) {
    // Ignore if no students exist yet.
  }
}

ensureAuthenticated().then(() => populateNextStudentId());

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

photoInput.addEventListener('change', () => {
  const newFiles = Array.from(photoInput.files || []);
  selectedFiles = [...selectedFiles, ...newFiles].slice(0, 15);
  photoInput.value = '';
  renderPreviews();
});

function renderPreviews() {
  previewGrid.innerHTML = '';
  selectedFiles.forEach((file, index) => {
    const url = URL.createObjectURL(file);
    const card = document.createElement('div');
    card.className = 'preview-card';
    card.innerHTML = `
      <img src="${url}" alt="Selected photo preview" />
      <div class="preview-meta">
        <div class="preview-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
        <button class="remove-btn" type="button" data-index="${index}">Remove</button>
      </div>
    `;
    card.querySelector('img').addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    previewGrid.appendChild(card);
  });
}

previewGrid.addEventListener('click', (event) => {
  const button = event.target.closest('.remove-btn');
  if (!button) return;
  selectedFiles.splice(Number(button.dataset.index), 1);
  renderPreviews();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (selectedFiles.length === 0) {
    statusBox.className = 'status error';
    statusBox.textContent = 'Please select at least one photo.';
    return;
  }

  saveBtn.disabled = true;
  statusBox.className = 'status info';
  statusBox.textContent = 'Saving student and uploading photos...';

  const data = new FormData();
  ['studentId', 'studentName', 'className', 'division', 'rollNumber'].forEach((name) => {
    data.append(name, form.elements[name].value);
  });
  selectedFiles.forEach((file) => data.append('photos', file, file.name));

  try {
    const response = await fetch('/api/students', { method: 'POST', body: data });
    const result = await response.json();
    if (response.status === 401) {
      window.location.href = '/';
      return;
    }
    if (!response.ok) throw new Error(result.message || 'Save failed.');

    statusBox.className = 'status success';
    statusBox.textContent = `${result.message} Folder: ${result.student.driveFolderName}`;
    form.reset();
    selectedFiles = [];
    renderPreviews();
  } catch (error) {
    statusBox.className = 'status error';
    statusBox.textContent = error.message;
  } finally {
    saveBtn.disabled = false;
  }
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
