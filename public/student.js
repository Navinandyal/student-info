const form = document.getElementById('studentForm');
const photoInput = document.getElementById('photos');
const previewGrid = document.getElementById('previewGrid');
const statusBox = document.getElementById('status');
const saveBtn = document.getElementById('saveBtn');
const logoutBtn = document.getElementById('logoutBtn');
const topbarActions = document.getElementById('topbarActions');

let selectedFiles = [];

async function ensureAuthenticated() {
  const response = await fetch('/api/me');
  const data = await response.json();
  if (!data.authenticated) {
    window.location.href = '/';
    return false;
  }
  if (data.role === 'admin' && topbarActions && !document.getElementById('viewStudentsBtn')) {
    const viewStudentsBtn = document.createElement('a');
    viewStudentsBtn.id = 'viewStudentsBtn';
    viewStudentsBtn.href = '/students';
    viewStudentsBtn.className = 'secondary-btn';
    viewStudentsBtn.textContent = 'View Students';
    viewStudentsBtn.style.textDecoration = 'none';
    topbarActions.prepend(viewStudentsBtn);
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
  } catch (_) {
    // The form stays usable even if automatic ID generation is unavailable.
  }
}

(async () => {
  if (await ensureAuthenticated()) await populateNextStudentId();
})();

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

async function uploadOnePhoto(studentRecordId, file, index, total) {
  statusBox.className = 'status info';
  statusBox.textContent = `Optimizing and uploading photo ${index + 1} of ${total}...`;
  const prepared = await window.prepareImageForUpload(file);
  const data = new FormData();
  data.append('photo', prepared, prepared.name);

  const response = await fetch(`/api/students/${studentRecordId}/photos`, {
    method: 'POST',
    body: data,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || `Photo ${index + 1} upload failed.`);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!selectedFiles.length) {
    statusBox.className = 'status error';
    statusBox.textContent = 'Please select at least one photo.';
    return;
  }

  saveBtn.disabled = true;
  statusBox.className = 'status info';
  statusBox.textContent = 'Saving student information...';

  const payload = {};
  ['studentId', 'studentName', 'className', 'division', 'rollNumber'].forEach((name) => {
    payload[name] = form.elements[name].value.trim();
  });

  let createdStudentId = null;
  try {
    const response = await fetch('/api/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    if (response.status === 401) {
      window.location.href = '/';
      return;
    }
    if (!response.ok) throw new Error(result.message || 'Could not save the student.');

    createdStudentId = result.student.id;
    for (let i = 0; i < selectedFiles.length; i += 1) {
      await uploadOnePhoto(createdStudentId, selectedFiles[i], i, selectedFiles.length);
    }

    statusBox.className = 'status success';
    statusBox.textContent = `Student and ${selectedFiles.length} photo(s) saved successfully.`;
    form.reset();
    selectedFiles = [];
    renderPreviews();
    await populateNextStudentId();
  } catch (error) {
    statusBox.className = 'status error';
    statusBox.textContent = createdStudentId
      ? `${error.message} The student record was saved; use View Students to retry any missing photos.`
      : error.message;
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
