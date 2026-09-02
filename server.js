require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const {
  createStudentFolder,
  uploadPhoto,
  deleteDriveFile,
  getDriveFileStream,
  getAuthorizationUrl,
  handleOAuthCallback,
  isGoogleAuthorized,
  resetStudentSheetHeaders,
  listStudentsFromSheet,
  findStudentInSheet,
  getNextStudentIdFromSheet,
  appendStudentToSheet,
  updateStudentInSheet,
} = require('./src/googleDrive');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-this-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000,
    },
  })
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 15,
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed.'));
    }
    cb(null, true);
  },
});

function requireAuth(req, res, next) {
  if (!req.session?.authenticated) {
    return res.status(401).json({ message: 'Please log in first.' });
  }
  next();
}

function generateNextStudentId(lastStudentId) {
  const cleaned = String(lastStudentId || '').trim();
  const match = cleaned.match(/(\d+)(?!.*\d)/);
  const prefix = cleaned.replace(/\d+$/, '').trim() || 'STU';
  const nextNumber = match ? Number(match[1]) + 1 : 1;
  return `${prefix}${String(nextNumber).padStart(3, '0')}`;
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const expectedUsername = process.env.ADMIN_USERNAME || 'admin';
  const expectedPassword = process.env.ADMIN_PASSWORD || 'admin123';

  if (username === expectedUsername && password === expectedPassword) {
    req.session.authenticated = true;
    req.session.username = username;
    return res.json({ message: 'Login successful.' });
  }

  return res.status(401).json({ message: 'Invalid username or password.' });
});

app.post('/api/google/reset-sheet', requireAuth, async (req, res) => {
  try {
    const spreadsheetId = await resetStudentSheetHeaders();
    return res.json({
      message: 'Google Sheet headers reset successfully.',
      spreadsheetId,
    });
  } catch (error) {
    console.error('Reset sheet headers error:', error);
    return res.status(500).json({ message: 'Could not reset the Google Sheet headers.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Logged out.' });
  });
});

app.get('/api/me', (req, res) => {
  res.json({ authenticated: Boolean(req.session?.authenticated) });
});



app.get('/api/google/status', requireAuth, (req, res) => {
  res.json({ connected: isGoogleAuthorized() });
});

app.get('/api/students/next-id', requireAuth, async (req, res) => {
  try {
    const nextStudentId = await getNextStudentIdFromSheet();
    res.json({ nextStudentId });
  } catch (error) {
    console.error('Next student ID error:', error);
    res.status(500).json({ message: 'Could not generate the next student ID.' });
  }
});

app.get('/api/students', requireAuth, async (req, res) => {
  try {
    const students = await listStudentsFromSheet();
    const rows = students.map((student) => ({
      id: student.id,
      student_id: student.student_id,
      student_name: student.student_name,
      class_name: student.class_name,
      division: student.division,
      roll_number: student.roll_number,
      drive_folder_id: student.drive_folder_id,
      created_at: student.created_at,
      photo_count: Number(student.photo_count || student.photo_names?.length || student.photo_file_ids?.length || 0),
    }));

    res.json({ students: rows });
  } catch (error) {
    console.error('List students error:', error);
    res.status(500).json({ message: 'Could not load students.' });
  }
});

app.get('/api/students/:id', requireAuth, async (req, res) => {
  try {
    const students = await listStudentsFromSheet();
    const student = students.find((item) => Number(item.id) === Number(req.params.id));

    if (!student) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    const photos = (student.photo_file_ids || []).map((fileId, index) => ({
      id: `${fileId}-${index}`,
      drive_file_id: fileId,
      original_name: student.photo_names?.[index] || fileId,
      mime_type: 'image/jpeg',
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
        photo_count: Number(student.photo_count || photos.length || 0),
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

app.put('/api/students/:id', requireAuth, async (req, res) => {
  try {
    const students = await listStudentsFromSheet();
    const student = students.find((item) => Number(item.id) === Number(req.params.id));

    if (!student) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    const {
      studentId: newStudentId,
      studentName,
      className,
      division,
      rollNumber,
    } = req.body;

    const required = {
      studentId: newStudentId,
      studentName,
      className,
      division,
      rollNumber,
    };

    const missing = Object.entries(required)
      .filter(([, value]) => !String(value || '').trim())
      .map(([key]) => key);

    if (missing.length) {
      return res.status(400).json({ message: `Missing required fields: ${missing.join(', ')}` });
    }

    const normalizedStudentId = String(newStudentId).trim();
    const duplicate = students.find((item) => item.student_id && item.student_id !== student.student_id && String(item.student_id).trim() === normalizedStudentId);
    if (duplicate) {
      return res.status(409).json({ message: 'A student with this Student ID already exists.' });
    }

    const updated = {
      ...student,
      student_id: normalizedStudentId,
      student_name: String(studentName).trim(),
      class_name: String(className).trim(),
      division: String(division).trim(),
      roll_number: String(rollNumber).trim(),
      created_at: student.created_at || new Date().toISOString(),
      photo_names: Array.isArray(student.photo_names) ? student.photo_names : [],
      photo_file_ids: Array.isArray(student.photo_file_ids) ? student.photo_file_ids : [],
      photo_count: Number(student.photo_count || student.photo_names?.length || student.photo_file_ids?.length || 0),
    };

    await updateStudentInSheet(student.student_id, updated);
    return res.json({ message: 'Student details updated successfully.' });
  } catch (error) {
    console.error('Update student error:', error);
    return res.status(500).json({ message: 'Could not update student details.' });
  }
});

app.post('/api/students/:id/photos', requireAuth, upload.array('photos', 15), async (req, res) => {
  try {
    const students = await listStudentsFromSheet();
    const student = students.find((item) => Number(item.id) === Number(req.params.id));

    if (!student) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ message: 'Please choose a photo to upload.' });
    }

    const { drive, folderId } = await createStudentFolder(student.student_id, student.student_name);
    const photoNames = Array.isArray(student.photo_names) ? [...student.photo_names] : [];
    const photoFileIds = Array.isArray(student.photo_file_ids) ? [...student.photo_file_ids] : [];

    for (const file of files) {
      const uploaded = await uploadPhoto(drive, folderId, file);
      photoNames.push(uploaded.name);
      photoFileIds.push(uploaded.id);
    }

    const updated = {
      ...student,
      photo_names: photoNames,
      photo_file_ids: photoFileIds,
      photo_count: photoNames.length,
      created_at: student.created_at || new Date().toISOString(),
    };

    await updateStudentInSheet(student.student_id, updated);
    return res.json({ message: 'Photo(s) added successfully.' });
  } catch (error) {
    console.error('Add student photos error:', error);
    return res.status(500).json({ message: 'Could not add photo(s).' });
  }
});

app.delete('/api/students/:id/photos/:fileId', requireAuth, async (req, res) => {
  try {
    const students = await listStudentsFromSheet();
    const student = students.find((item) => Number(item.id) === Number(req.params.id));

    if (!student) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    const photoFileIds = Array.isArray(student.photo_file_ids) ? [...student.photo_file_ids] : [];
    const photoNames = Array.isArray(student.photo_names) ? [...student.photo_names] : [];
    const targetIndex = photoFileIds.indexOf(req.params.fileId);

    if (targetIndex === -1) {
      return res.status(404).json({ message: 'Photo not found.' });
    }

    await deleteDriveFile(req.params.fileId);
    photoFileIds.splice(targetIndex, 1);
    photoNames.splice(targetIndex, 1);

    const updated = {
      ...student,
      photo_names: photoNames,
      photo_file_ids: photoFileIds,
      photo_count: photoNames.length,
      created_at: student.created_at || new Date().toISOString(),
    };

    await updateStudentInSheet(student.student_id, updated);
    return res.json({ message: 'Photo deleted successfully.' });
  } catch (error) {
    console.error('Delete student photo error:', error);
    return res.status(500).json({ message: 'Could not delete photo.' });
  }
});

app.get('/auth/google', requireAuth, (req, res) => {
  try {
    res.redirect(getAuthorizationUrl());
  } catch (error) {
    console.error('Google authorization error:', error);
    res.status(500).send(`Could not start Google authorization: ${error.message}`);
  }
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.status(400).send(`Google authorization was denied: ${error}`);
  }

  if (!code) {
    return res.status(400).send('Missing Google authorization code.');
  }

  try {
    await handleOAuthCallback(code);
    return res.redirect('/student?google=connected');
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    return res.status(500).send(`Could not connect Google Drive: ${err.message}`);
  }
});

app.post('/api/students', requireAuth, upload.array('photos', 15), async (req, res) => {
  if (!isGoogleAuthorized()) {
    return res.status(400).json({
      message: 'Google Drive is not connected. Open /auth/google once and authorize your Google account before saving students.',
    });
  }

  const files = req.files || [];
  const {
    studentId,
    studentName,
    className,
    division,
    rollNumber,
  } = req.body;

  const required = {
    studentId,
    studentName,
    className,
    division,
    rollNumber,
  };

  const missing = Object.entries(required)
    .filter(([, value]) => !String(value || '').trim())
    .map(([key]) => key);

  if (missing.length) {
    return res.status(400).json({ message: `Missing required fields: ${missing.join(', ')}` });
  }

  if (files.length === 0) {
    return res.status(400).json({ message: 'Please select at least one photo.' });
  }

  try {
    const students = await listStudentsFromSheet();
    const existing = students.find((item) => String(item.student_id).trim() === String(studentId).trim());
    if (existing) {
      return res.status(409).json({ message: 'A student with this Student ID already exists.' });
    }

    const { drive, folderId, folderName } = await createStudentFolder(studentId, studentName);
    const uploadedPhotos = [];
    const photoNames = [];
    const photoFileIds = [];

    for (const file of files) {
      const uploaded = await uploadPhoto(drive, folderId, file);
      uploadedPhotos.push(uploaded.name);
      photoNames.push(uploaded.name);
      photoFileIds.push(uploaded.id);
    }

    const row = {
      student_id: studentId.trim(),
      student_name: studentName.trim(),
      class_name: className.trim(),
      division: division.trim(),
      roll_number: rollNumber.trim(),
      drive_folder_id: folderId,
      created_at: new Date().toISOString(),
      photo_names: photoNames,
      photo_file_ids: photoFileIds,
      photo_count: uploadedPhotos.length,
    };

    const saved = await appendStudentToSheet(row);

    return res.status(201).json({
      message: 'Student information and photos saved successfully.',
      student: {
        id: saved.id,
        studentId: studentId.trim(),
        studentName: studentName.trim(),
        driveFolderId: folderId,
        driveFolderName: folderName,
        uploadedPhotos,
      },
    });
  } catch (error) {
    console.error('Save student error:', error);
    return res.status(500).json({
      message: 'Could not save the student. Check the server console and Google Drive configuration.',
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/student', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student.html'));
});

app.get('/students', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'students.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: err.message });
  }
  return res.status(400).json({ message: err.message || 'Request failed.' });
});

app.listen(PORT, () => {
  console.log(`Student Information App running at http://localhost:${PORT}`);
});
