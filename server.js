require('dotenv').config();

const path = require('path');
const express = require('express');
const multer = require('multer');
const {
  createStudentFolder,
  uploadPhoto,
  deleteDriveFile,
  getDriveFileStream,
  isGoogleAuthorized,
  resetStudentSheetHeaders,
  listStudentsFromSheet,
  getNextStudentIdFromSheet,
  appendStudentToSheet,
  updateStudentInSheet,
} = require('./src/googleDrive');
const {
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
  isRequestAuthenticated,
} = require('./src/auth');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

// Keep each upload safely below Vercel Function's 4.5 MB request limit.
const MAX_PHOTO_BYTES = 3.8 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: MAX_PHOTO_BYTES },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed.'));
    }
    cb(null, true);
  },
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const expectedUsername = process.env.ADMIN_USERNAME || 'admin';
  const expectedPassword = process.env.ADMIN_PASSWORD || 'admin123';

  if (username === expectedUsername && password === expectedPassword) {
    try {
      setAuthCookie(res, username);
      return res.json({ message: 'Login successful.' });
    } catch (error) {
      console.error('Login configuration error:', error);
      return res.status(500).json({ message: 'Server authentication is not configured correctly.' });
    }
  }

  return res.status(401).json({ message: 'Invalid username or password.' });
});

app.post('/api/logout', (req, res) => {
  clearAuthCookie(res);
  return res.json({ message: 'Logged out.' });
});

app.get('/api/me', (req, res) => {
  res.json({ authenticated: isRequestAuthenticated(req) });
});

app.get('/api/google/status', requireAuth, (req, res) => {
  res.json({ connected: isGoogleAuthorized() });
});

app.post('/api/google/reset-sheet', requireAuth, async (req, res) => {
  try {
    const spreadsheetId = await resetStudentSheetHeaders();
    return res.json({ message: 'Google Sheet headers reset successfully.', spreadsheetId });
  } catch (error) {
    console.error('Reset sheet headers error:', error);
    return res.status(500).json({ message: 'Could not reset the Google Sheet headers.' });
  }
});

app.get('/api/students/next-id', requireAuth, async (req, res) => {
  try {
    const nextStudentId = await getNextStudentIdFromSheet();
    return res.json({ nextStudentId });
  } catch (error) {
    console.error('Next student ID error:', error);
    return res.status(500).json({ message: 'Could not generate the next student ID.' });
  }
});

app.get('/api/students', requireAuth, async (req, res) => {
  try {
    const students = await listStudentsFromSheet();
    return res.json({
      students: students.map((student) => ({
        id: student.id,
        student_id: student.student_id,
        student_name: student.student_name,
        class_name: student.class_name,
        division: student.division,
        roll_number: student.roll_number,
        drive_folder_id: student.drive_folder_id,
        created_at: student.created_at,
        photo_count: Number(student.photo_count || 0),
      })),
    });
  } catch (error) {
    console.error('List students error:', error);
    return res.status(500).json({ message: 'Could not load students. Check Google backend configuration.' });
  }
});

app.get('/api/students/:id', requireAuth, async (req, res) => {
  try {
    const students = await listStudentsFromSheet();
    const student = students.find((item) => Number(item.id) === Number(req.params.id));
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    const photos = (student.photo_file_ids || []).map((fileId, index) => ({
      id: `${fileId}-${index}`,
      drive_file_id: fileId,
      original_name: student.photo_names?.[index] || fileId,
      created_at: student.created_at || new Date().toISOString(),
    }));

    return res.json({
      student: {
        id: student.id,
        student_id: student.student_id,
        student_name: student.student_name,
        class_name: student.class_name,
        division: student.division,
        roll_number: student.roll_number,
        drive_folder_id: student.drive_folder_id,
        photo_count: Number(student.photo_count || photos.length),
        photos,
      },
    });
  } catch (error) {
    console.error('Get student error:', error);
    return res.status(500).json({ message: 'Could not load student details.' });
  }
});

app.get('/api/photos/:fileId', requireAuth, async (req, res) => {
  try {
    const { buffer, mimeType } = await getDriveFileStream(req.params.fileId);
    res.set('Content-Type', mimeType);
    res.set('Cache-Control', 'private, max-age=3600');
    return res.send(buffer);
  } catch (error) {
    console.error('Photo fetch error:', error);
    return res.status(500).json({ message: 'Could not load the photo.' });
  }
});

app.post('/api/students', requireAuth, async (req, res) => {
  if (!isGoogleAuthorized()) {
    return res.status(503).json({
      message: 'Google backend is not configured. Add GOOGLE_REFRESH_TOKEN and the other Google environment variables.',
    });
  }

  const { studentId, studentName, className, division, rollNumber } = req.body;
  const required = { studentId, studentName, className, division, rollNumber };
  const missing = Object.entries(required)
    .filter(([, value]) => !String(value || '').trim())
    .map(([key]) => key);

  if (missing.length) {
    return res.status(400).json({ message: `Missing required fields: ${missing.join(', ')}` });
  }

  try {
    const students = await listStudentsFromSheet();
    const normalizedStudentId = String(studentId).trim();
    if (students.some((item) => String(item.student_id).trim() === normalizedStudentId)) {
      return res.status(409).json({ message: 'A student with this Student ID already exists.' });
    }

    const { folderId, folderName } = await createStudentFolder(studentId, studentName);
    const row = {
      student_id: normalizedStudentId,
      student_name: String(studentName).trim(),
      class_name: String(className).trim(),
      division: String(division).trim(),
      roll_number: String(rollNumber).trim(),
      drive_folder_id: folderId,
      created_at: new Date().toISOString(),
      photo_names: [],
      photo_file_ids: [],
      photo_count: 0,
    };

    const saved = await appendStudentToSheet(row);
    return res.status(201).json({
      message: 'Student information saved. Uploading selected photos next.',
      student: {
        id: saved.id,
        studentId: row.student_id,
        studentName: row.student_name,
        driveFolderId: folderId,
        driveFolderName: folderName,
      },
    });
  } catch (error) {
    console.error('Save student error:', error);
    return res.status(500).json({
      message: 'Could not save the student. Check the Google backend configuration.',
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

app.put('/api/students/:id', requireAuth, async (req, res) => {
  try {
    const students = await listStudentsFromSheet();
    const student = students.find((item) => Number(item.id) === Number(req.params.id));
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    const { studentId, studentName, className, division, rollNumber } = req.body;
    const required = { studentId, studentName, className, division, rollNumber };
    const missing = Object.entries(required)
      .filter(([, value]) => !String(value || '').trim())
      .map(([key]) => key);
    if (missing.length) return res.status(400).json({ message: `Missing required fields: ${missing.join(', ')}` });

    const normalizedStudentId = String(studentId).trim();
    const duplicate = students.find(
      (item) => item.id !== student.id && String(item.student_id).trim() === normalizedStudentId
    );
    if (duplicate) return res.status(409).json({ message: 'A student with this Student ID already exists.' });

    const updated = {
      ...student,
      student_id: normalizedStudentId,
      student_name: String(studentName).trim(),
      class_name: String(className).trim(),
      division: String(division).trim(),
      roll_number: String(rollNumber).trim(),
      photo_names: Array.isArray(student.photo_names) ? student.photo_names : [],
      photo_file_ids: Array.isArray(student.photo_file_ids) ? student.photo_file_ids : [],
      photo_count: Number(student.photo_count || 0),
      created_at: student.created_at || new Date().toISOString(),
    };

    await updateStudentInSheet(student.student_id, updated);
    return res.json({ message: 'Student details updated successfully.' });
  } catch (error) {
    console.error('Update student error:', error);
    return res.status(500).json({ message: 'Could not update student details.' });
  }
});

app.post('/api/students/:id/photos', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    const students = await listStudentsFromSheet();
    const student = students.find((item) => Number(item.id) === Number(req.params.id));
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    if (!req.file) return res.status(400).json({ message: 'Please choose a photo to upload.' });

    const { drive, folderId } = await createStudentFolder(student.student_id, student.student_name);
    const uploaded = await uploadPhoto(drive, folderId, req.file);
    const photoNames = [...(student.photo_names || []), uploaded.name];
    const photoFileIds = [...(student.photo_file_ids || []), uploaded.id];

    await updateStudentInSheet(student.student_id, {
      ...student,
      drive_folder_id: folderId,
      photo_names: photoNames,
      photo_file_ids: photoFileIds,
      photo_count: photoNames.length,
      created_at: student.created_at || new Date().toISOString(),
    });

    return res.json({ message: 'Photo uploaded successfully.', photo: { id: uploaded.id, name: uploaded.name } });
  } catch (error) {
    console.error('Add student photo error:', error);
    return res.status(500).json({ message: 'Could not upload the photo.' });
  }
});

app.delete('/api/students/:id/photos/:fileId', requireAuth, async (req, res) => {
  try {
    const students = await listStudentsFromSheet();
    const student = students.find((item) => Number(item.id) === Number(req.params.id));
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    const photoFileIds = [...(student.photo_file_ids || [])];
    const photoNames = [...(student.photo_names || [])];
    const targetIndex = photoFileIds.indexOf(req.params.fileId);
    if (targetIndex === -1) return res.status(404).json({ message: 'Photo not found.' });

    await deleteDriveFile(req.params.fileId);
    photoFileIds.splice(targetIndex, 1);
    photoNames.splice(targetIndex, 1);

    await updateStudentInSheet(student.student_id, {
      ...student,
      photo_names: photoNames,
      photo_file_ids: photoFileIds,
      photo_count: photoNames.length,
      created_at: student.created_at || new Date().toISOString(),
    });

    return res.json({ message: 'Photo deleted successfully.' });
  } catch (error) {
    console.error('Delete student photo error:', error);
    return res.status(500).json({ message: 'Could not delete photo.' });
  }
});

// Local static serving. Vercel serves public/** from its CDN automatically.
if (!process.env.VERCEL) {
  app.use(express.static(path.join(__dirname, 'public')));
}

app.get('/student', requireAuth, (req, res) => {
  if (process.env.VERCEL) return res.redirect('/student.html');
  return res.sendFile(path.join(__dirname, 'public', 'student.html'));
});

app.get('/students', requireAuth, (req, res) => {
  if (process.env.VERCEL) return res.redirect('/students.html');
  return res.sendFile(path.join(__dirname, 'public', 'students.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'Photo is too large after optimization. Keep each upload below 3.8 MB.' });
    }
    return res.status(400).json({ message: err.message });
  }
  return res.status(400).json({ message: err.message || 'Request failed.' });
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Student Information App running at http://localhost:${PORT}`);
  });
}
