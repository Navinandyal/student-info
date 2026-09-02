const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { google } = require('googleapis');

const TOKEN_FILE = path.resolve(process.cwd(), 'credentials', 'google-token.json');
const STUDENT_SHEET_HEADERS = [
  'student_id',
  'student_name',
  'class_name',
  'division',
  'roll_number',
  'drive_folder_id',
  'created_at',
  'photo_names',
  'photo_file_ids',
  'photo_count',
];

function getRefreshToken() {
  const fromEnv = process.env.GOOGLE_REFRESH_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  // Local-development fallback for users migrating from the older version.
  // Vercel must use GOOGLE_REFRESH_TOKEN because its filesystem is ephemeral.
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      const stored = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      return stored.refresh_token || null;
    } catch (_) {
      return null;
    }
  }

  return null;
}

function isGoogleAuthorized() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim() &&
      getRefreshToken()
  );
}

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const refreshToken = getRefreshToken();

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured.');
  }
  if (!refreshToken) {
    throw new Error('GOOGLE_REFRESH_TOKEN is not configured. Add the refresh token to the backend environment.');
  }

  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

function getDriveClient() {
  return google.drive({ version: 'v3', auth: getOAuthClient() });
}

function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getOAuthClient() });
}

function getStudentSheetId() {
  return process.env.GOOGLE_SHEET_ID?.trim() || null;
}

async function ensureStudentSheet() {
  const drive = getDriveClient();
  const sheets = getSheetsClient();
  const configuredSheetId = getStudentSheetId();

  if (configuredSheetId) {
    const values = await sheets.spreadsheets.values.get({
      spreadsheetId: configuredSheetId,
      range: 'A1:J1',
    });

    if (!values.data.values || values.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: configuredSheetId,
        range: 'A1:J1',
        valueInputOption: 'RAW',
        requestBody: { values: [STUDENT_SHEET_HEADERS] },
      });
    }

    return configuredSheetId;
  }

  if (process.env.VERCEL) {
    throw new Error('GOOGLE_SHEET_ID must be configured on Vercel so student records use persistent storage.');
  }

  const created = await drive.files.create({
    requestBody: {
      name: 'Student Records',
      mimeType: 'application/vnd.google-apps.spreadsheet',
    },
    fields: 'id',
  });

  const spreadsheetId = created.data.id;
  process.env.GOOGLE_SHEET_ID = spreadsheetId;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'A1:J1',
    valueInputOption: 'RAW',
    requestBody: { values: [STUDENT_SHEET_HEADERS] },
  });

  console.log(`Created Google Sheet "Student Records". Add this to .env/Vercel: GOOGLE_SHEET_ID=${spreadsheetId}`);
  return spreadsheetId;
}

async function resetStudentSheetHeaders() {
  const sheets = getSheetsClient();
  const spreadsheetId = await ensureStudentSheet();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'A1:J1',
    valueInputOption: 'RAW',
    requestBody: { values: [STUDENT_SHEET_HEADERS] },
  });
  return spreadsheetId;
}

function normalizeStudentRecord(record, id) {
  const normalized = { ...record, id };

  for (const key of ['photo_names', 'photo_file_ids']) {
    if (!normalized[key]) {
      normalized[key] = [];
      continue;
    }
    if (Array.isArray(normalized[key])) continue;
    try {
      normalized[key] = JSON.parse(normalized[key]);
    } catch (_) {
      normalized[key] = String(normalized[key]).split(';').filter(Boolean);
    }
  }

  normalized.photo_count = Number(
    normalized.photo_count || normalized.photo_names.length || normalized.photo_file_ids.length || 0
  );
  return normalized;
}

async function listStudentsFromSheet() {
  const sheets = getSheetsClient();
  const spreadsheetId = await ensureStudentSheet();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'A1:J',
  });

  const rows = response.data.values || [];
  if (rows.length <= 1) return [];

  const headers = rows[0].length ? rows[0] : STUDENT_SHEET_HEADERS;
  return rows
    .slice(1)
    .filter((row) => row.some(Boolean))
    .map((row, index) => {
      const record = {};
      headers.forEach((header, columnIndex) => {
        record[header] = row[columnIndex] || '';
      });
      return normalizeStudentRecord(record, index + 1);
    });
}

async function findStudentInSheet(studentId) {
  const students = await listStudentsFromSheet();
  return students.find((student) => String(student.student_id).trim() === String(studentId).trim()) || null;
}

async function getNextStudentIdFromSheet() {
  const students = await listStudentsFromSheet();
  const last = students
    .map((student) => String(student.student_id || '').trim())
    .filter(Boolean)
    .sort((a, b) => {
      const matchA = a.match(/(\d+)(?!.*\d)/);
      const matchB = b.match(/(\d+)(?!.*\d)/);
      return (matchB ? Number(matchB[1]) : 0) - (matchA ? Number(matchA[1]) : 0);
    })[0];

  const prefix = last ? last.replace(/\d+$/, '').trim() || 'STU' : 'STU';
  const match = last ? last.match(/(\d+)(?!.*\d)/) : null;
  const nextNumber = match ? Number(match[1]) + 1 : 1;
  return `${prefix}${String(nextNumber).padStart(3, '0')}`;
}

async function appendStudentToSheet(studentData) {
  const sheets = getSheetsClient();
  const spreadsheetId = await ensureStudentSheet();
  const row = STUDENT_SHEET_HEADERS.map((header) => {
    const value = studentData[header] ?? '';
    return Array.isArray(value) ? JSON.stringify(value) : String(value ?? '');
  });

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'A1:J',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });

  const sheetRow = Number(response.data.updates?.updatedRange?.match(/A(\d+)/)?.[1] || 2);
  return { id: Math.max(1, sheetRow - 1), ...studentData };
}

async function updateStudentInSheet(studentId, studentData) {
  const sheets = getSheetsClient();
  const spreadsheetId = await ensureStudentSheet();
  const students = await listStudentsFromSheet();
  const targetIndex = students.findIndex(
    (student) => String(student.student_id).trim() === String(studentId).trim()
  );

  if (targetIndex === -1) throw new Error('Student not found in Google Sheet.');

  const targetRowNumber = targetIndex + 2;
  const row = STUDENT_SHEET_HEADERS.map((header) => {
    const value = studentData[header] ?? '';
    return Array.isArray(value) ? JSON.stringify(value) : String(value ?? '');
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `A${targetRowNumber}:J${targetRowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });

  return { id: targetIndex + 1, ...studentData };
}

function escapeDriveQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function getMyDriveRootId(drive) {
  // The drive.file scope can use the root alias as a parent, but cannot read
  // the My Drive root metadata itself.
  return 'root';
}

async function resolveParentFolderId(drive, configuredParentId) {
  if (!configuredParentId) return getMyDriveRootId(drive);
  const response = await drive.files.get({
    fileId: configuredParentId,
    fields: 'id,name,mimeType',
  });
  if (response.data.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error('GOOGLE_DRIVE_PARENT_FOLDER_ID does not point to a Google Drive folder.');
  }
  return response.data.id;
}

async function findFolder(drive, name, parentId) {
  const clauses = [
    `name='${escapeDriveQuery(name)}'`,
    "mimeType='application/vnd.google-apps.folder'",
    'trashed=false',
    `'${escapeDriveQuery(parentId)}' in parents`,
  ];

  const response = await drive.files.list({
    q: clauses.join(' and '),
    fields: 'files(id,name)',
    spaces: 'drive',
    pageSize: 10,
  });
  return response.data.files?.[0] || null;
}

async function createFolder(drive, name, parentId) {
  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id,name',
  });
  return response.data;
}

async function findOrCreateFolder(drive, name, parentId) {
  const existing = await findFolder(drive, name, parentId);
  return existing || createFolder(drive, name, parentId);
}

function sanitizeFolderPart(value) {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function createStudentFolder(studentId, studentName) {
  const drive = getDriveClient();
  const configuredParentId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID?.trim();
  const parentId = await resolveParentFolderId(drive, configuredParentId);
  const rootFolder = await findOrCreateFolder(drive, 'Student Photos', parentId);
  const folderName = `${sanitizeFolderPart(studentId)}_${sanitizeFolderPart(studentName)}`;
  const studentFolder = await findOrCreateFolder(drive, folderName, rootFolder.id);
  return { drive, folderId: studentFolder.id, folderName };
}

async function uploadPhoto(drive, folderId, file) {
  const response = await drive.files.create({
    requestBody: { name: file.originalname, parents: [folderId] },
    media: { mimeType: file.mimetype, body: Readable.from(file.buffer) },
    fields: 'id,name,mimeType,webViewLink',
  });
  return response.data;
}

async function getDriveFileStream(fileId) {
  const drive = getDriveClient();
  const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  return {
    buffer: Buffer.from(response.data),
    mimeType: response.headers['content-type'] || 'application/octet-stream',
  };
}

async function deleteDriveFile(fileId) {
  const drive = getDriveClient();
  await drive.files.delete({ fileId });
}

module.exports = {
  createStudentFolder,
  uploadPhoto,
  deleteDriveFile,
  getDriveFileStream,
  isGoogleAuthorized,
  ensureStudentSheet,
  resetStudentSheetHeaders,
  listStudentsFromSheet,
  findStudentInSheet,
  getNextStudentIdFromSheet,
  appendStudentToSheet,
  updateStudentInSheet,
};
