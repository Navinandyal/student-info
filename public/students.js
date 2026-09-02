const statusBox = document.getElementById('status');
const tableWrap = document.getElementById('studentTableWrap');
const logoutBtn = document.getElementById('logoutBtn');

async function ensureAuthenticated() {
  const response = await fetch('/api/me');
  const data = await response.json();
  if (!data.authenticated) window.location.href = '/';
}

async function loadStudents() {
  statusBox.className = 'status info';
  statusBox.textContent = 'Loading students...';

  try {
    const response = await fetch('/api/students');
    const result = await response.json();

    if (!response.ok) throw new Error(result.message || 'Could not load students.');

    if (!result.students || result.students.length === 0) {
      tableWrap.innerHTML = '<p class="empty-state">No students found yet.</p>';
      statusBox.className = 'status info';
      statusBox.textContent = 'No students saved yet.';
      return;
    }

    tableWrap.innerHTML = `
      <table class="student-table">
        <thead>
          <tr>
            <th>Student ID</th>
            <th>Name</th>
            <th>Class</th>
            <th>Division</th>
            <th>Roll</th>
            <th>Photos</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${result.students.map((student) => `
            <tr>
              <td>${escapeHtml(student.student_id)}</td>
              <td>${escapeHtml(student.student_name)}</td>
              <td>${escapeHtml(student.class_name)}</td>
              <td>${escapeHtml(student.division)}</td>
              <td>${escapeHtml(student.roll_number)}</td>
              <td>${Number(student.photo_count || 0)}</td>
              <td><button type="button" class="secondary-btn small-btn" data-id="${student.id}">Edit</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    statusBox.className = 'status success';
    statusBox.textContent = `${result.students.length} student record(s) loaded.`;
  } catch (error) {
    statusBox.className = 'status error';
    statusBox.textContent = error.message;
  }
}

async function loadStudentById(id) {
  const response = await fetch(`/api/students/${id}`);
  const result = await response.json();

  if (!response.ok) throw new Error(result.message || 'Student not found.');
  return result.student;
}

function buildEditForm(student) {
  const photoHtml = (student.photos || []).length
    ? `
      <div class="photo-gallery">
        <h3>Uploaded Photos</h3>
        <div class="photo-grid">
          ${student.photos.map((photo) => `
            <div class="student-photo-card">
              <img src="/api/photos/${encodeURIComponent(photo.drive_file_id)}" alt="${escapeAttribute(photo.original_name)}" />
              <div class="student-photo-name">${escapeHtml(photo.original_name)}</div>
              <button type="button" class="delete-photo-btn" data-photo-id="${escapeAttribute(photo.drive_file_id)}">Delete</button>
            </div>
          `).join('')}
        </div>
      </div>
    `
    : '<p class="empty-state">No photos were stored for this student.</p>';

  const formHtml = `
    <form id="editStudentForm" class="edit-form">
      <div class="form-grid">
        <div class="field">
          <label for="editStudentId">Student Number</label>
          <input id="editStudentId" name="studentId" value="${escapeAttribute(student.student_id)}" required />
        </div>
        <div class="field">
          <label for="editStudentName">Student Name</label>
          <input id="editStudentName" name="studentName" value="${escapeAttribute(student.student_name)}" required />
        </div>
        <div class="field">
          <label for="editClassName">Class</label>
          <input id="editClassName" name="className" value="${escapeAttribute(student.class_name)}" required />
        </div>
        <div class="field">
          <label for="editDivision">Division</label>
          <input id="editDivision" name="division" value="${escapeAttribute(student.division)}" required />
        </div>
        <div class="field full">
          <label for="editRollNumber">Roll Number</label>
          <input id="editRollNumber" name="rollNumber" value="${escapeAttribute(student.roll_number)}" required />
        </div>
      </div>

      ${photoHtml}

      <div class="photo-upload-box">
        <label for="addPhotosInput" class="upload-label">Add Photos</label>
        <input id="addPhotosInput" type="file" accept="image/*" multiple />
        <button type="button" id="addPhotosBtn" class="secondary-btn">Upload New Photos</button>
      </div>

      <div class="actions">
        <button type="submit" class="primary-btn">Update Student</button>
        <button type="button" class="secondary-btn" id="cancelEditBtn">Cancel</button>
      </div>
    </form>
  `;

  return formHtml;
}

async function openEditForm(studentId) {
  try {
    const student = await loadStudentById(studentId);
    tableWrap.innerHTML = buildEditForm(student);

    const form = document.getElementById('editStudentForm');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = {
        studentId: form.studentId.value.trim(),
        studentName: form.studentName.value.trim(),
        className: form.className.value.trim(),
        division: form.division.value.trim(),
        rollNumber: form.rollNumber.value.trim(),
      };

      statusBox.className = 'status info';
      statusBox.textContent = 'Updating student...';

      try {
        const response = await fetch(`/api/students/${studentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await response.json();

        if (!response.ok) throw new Error(result.message || 'Update failed.');

        statusBox.className = 'status success';
        statusBox.textContent = result.message;
        await loadStudents();
      } catch (error) {
        statusBox.className = 'status error';
        statusBox.textContent = error.message;
      }
    });

    document.getElementById('cancelEditBtn').addEventListener('click', () => loadStudents());

    document.getElementById('addPhotosBtn').addEventListener('click', async () => {
      const input = document.getElementById('addPhotosInput');
      const files = Array.from(input.files || []);
      if (!files.length) {
        statusBox.className = 'status error';
        statusBox.textContent = 'Choose at least one photo to upload.';
        return;
      }

      const formData = new FormData();
      files.forEach((file) => formData.append('photos', file, file.name));

      statusBox.className = 'status info';
      statusBox.textContent = 'Uploading photos...';

      try {
        const response = await fetch(`/api/students/${studentId}/photos`, { method: 'POST', body: formData });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Could not upload photos.');
        statusBox.className = 'status success';
        statusBox.textContent = result.message;
        await openEditForm(studentId);
      } catch (error) {
        statusBox.className = 'status error';
        statusBox.textContent = error.message;
      }
    });

    document.querySelectorAll('.delete-photo-btn').forEach((button) => {
      button.addEventListener('click', async () => {
        const photoId = button.dataset.photoId;
        if (!photoId) return;

        statusBox.className = 'status info';
        statusBox.textContent = 'Deleting photo...';

        try {
          const response = await fetch(`/api/students/${studentId}/photos/${encodeURIComponent(photoId)}`, { method: 'DELETE' });
          const result = await response.json();
          if (!response.ok) throw new Error(result.message || 'Could not delete photo.');
          statusBox.className = 'status success';
          statusBox.textContent = result.message;
          await openEditForm(studentId);
        } catch (error) {
          statusBox.className = 'status error';
          statusBox.textContent = error.message;
        }
      });
    });
  } catch (error) {
    statusBox.className = 'status error';
    statusBox.textContent = error.message;
  }
}

tableWrap.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-id]');
  if (!button) return;
  await openEditForm(button.dataset.id);
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value ?? '').replaceAll('`', '&#96;');
}

(async () => {
  await ensureAuthenticated();
  await loadStudents();
})();
