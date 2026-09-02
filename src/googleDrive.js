const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { google } = require('googleapis');

// drive.file is enough for files/folders created by this application and is
// preferable to requesting unrestricted access to the user's entire Drive.
const DRIVE_SCOPE = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/spreadsheets'];
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

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() || 'http://localhost:3000/auth/google/callback';

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured in .env.');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function isGoogleAuthorized() {
  return fs.existsSync(TOKEN_FILE);
}

function loadStoredTokens(oauth2Client) {
  if (!isGoogleAuthorized()) {
    throw new Error('Google Drive is not connected. Open /auth/google once and authorize your Google account.');
  }

  const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  oauth2Client.setCredentials(tokens);
  return tokens;
}

function saveTokens(tokens) {
  const dir = path.dirname(TOKEN_FILE);
  fs.mkdirSync(dir, { recursive: true });

  // Preserve an existing refresh token because Google may omit it on later
  // authorizations unless consent is explicitly requested again.
  let merged = tokens;
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      merged = {
        ...existing,
        ...tokens,
        refresh_token: tokens.refresh_token || existing.refresh_token,
      };
    } catch (_) {
      // If the old token file is malformed, replace it with the new token set.
    }
  }

  fs.writeFileSync(TOKEN_FILE, JSON.stringify(merged, null, 2), { mode: 0o600 });
  return merged;
}

function getAuthorizationUrl() {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: DRIVE_SCOPE,
    include_granted_scopes: true,
  });
}

async function handleOAuthCallback(code) {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  saveTokens(tokens);
  oauth2Client.setCredentials(tokens);
  return tokens;
}

function getDriveClient() {
  const oauth2Client = getOAuthClient();
  loadStoredTokens(oauth2Client);

  oauth2Client.on('tokens', (tokens) => {
    if (tokens && Object.keys(tokens).length > 0) {
      saveTokens(tokens);
    }
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

function getSheetsClient() {
  const oauth2Client = getOAuthClient();
  loadStoredTokens(oauth2Client);

  oauth2Client.on('tokens', (tokens) => {
    if (tokens && Object.keys(tokens).length > 0) {
      saveTokens(tokens);
    }
  });

  return google.sheets({ version: 'v4', auth: oauth2Client });
}

function getStudentSheetId() {
  const configured = process.env.GOOGLE_SHEET_ID?.trim();
  return configured || null;
}

async function ensureStudentSheet() {
  const drive = getDriveClient();
  const sheets = getSheetsClient();
  const configuredSheetId = getStudentSheetId();

  if (configuredSheetId) {
    try {
      const values = await sheets.spreadsheets.values.get({ spreadsheetId: configuredSheetId, range: 'A1:J1' });

      if (!values.data.values || values.data.values.length === 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: configuredSheetId,
          range: 'A1:J1',
          valueInputOption: 'RAW',
          requestBody: {
            values: [STUDENT_SHEET_HEADERS],
          },
        });
      }

      return configuredSheetId;
    } catch (_) {
      // If configured ID is invalid, create a new sheet instead.
    }
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
    requestBody: {
      values: [STUDENT_SHEET_HEADERS],
    },
  });

  return spreadsheetId;
}

async function resetStudentSheetHeaders() {
  const sheets = getSheetsClient();
  const spreadsheetId = getStudentSheetId();

  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEET_ID is not configured.');
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'A1:J1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [STUDENT_SHEET_HEADERS],
    },
  });

  return spreadsheetId;
}

function parseStudentSheetRow(row, index) {
  const record = {};
  STUDENT_SHEET_HEADERS.forEach((header, columnIndex) => {
    const value = row[columnIndex] || '';
    record[header] = value;
  });

  record.id = index;
  if (record.photo_names) {
    try {
      record.photo_names = JSON.parse(record.photo_names);
    } catch (_) {
      record.photo_names = String(record.photo_names || '').split(';').filter(Boolean);
    }
  } else {
    record.photo_names = [];
  }

  if (record.photo_file_ids) {
    try {
      record.photo_file_ids = JSON.parse(record.photo_file_ids);
    } catch (_) {
      record.photo_file_ids = String(record.photo_file_ids || '').split(';').filter(Boolean);
    }
  } else {
    record.photo_file_ids = [];
  }

  record.photo_count = Number(record.photo_count || record.photo_names.length || record.photo_file_ids.length || 0);

  return record;
}

async function listStudentsFromSheet() {
  const sheets = getSheetsClient();
  const spreadsheetId = await ensureStudentSheet();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'A1:Z',
  });

  const rows = response.data.values || [];
  if (!rows.length) return [];

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const normalizedHeaders = headers.length ? headers : STUDENT_SHEET_HEADERS;

  return dataRows
    .filter((row) => row.some(Boolean))
    .map((row, index) => {
      const record = {};
      normalizedHeaders.forEach((header, columnIndex) => {
        record[header] = row[columnIndex] || '';
      });
      record.id = index + 1;
      if (record.photo_names) {
        try {
          record.photo_names = JSON.parse(record.photo_names);
        } catch (_) {
          record.photo_names = String(record.photo_names || '').split(';').filter(Boolean);
        }
      } else {
        record.photo_names = [];
      }
      if (record.photo_file_ids) {
        try {
          record.photo_file_ids = JSON.parse(record.photo_file_ids);
        } catch (_) {
          record.photo_file_ids = String(record.photo_file_ids || '').split(';').filter(Boolean);
        }
      } else {
        record.photo_file_ids = [];
      }
      record.photo_count = Number(record.photo_count || record.photo_names.length || record.photo_file_ids.length || 0);
      return record;
    });
}

async function findStudentInSheet(studentId) {
  const students = await listStudentsFromSheet();
  return students.find((student) => String(student.student_id).trim() === String(studentId).trim()) || null;
}

async function getStudentByIndex(index) {
  const students = await listStudentsFromSheet();
  return students.find((student) => Number(student.id) === Number(index)) || null;
}

async function getNextStudentIdFromSheet() {
  const students = await listStudentsFromSheet();
  const last = students
    .map((student) => String(student.student_id || '').trim())
    .filter(Boolean)
    .sort((a, b) => {
      const matchA = a.match(/(\d+)(?!.*\d)/);
      const matchB = b.match(/(\d+)(?!.*\d)/);
      const numA = matchA ? Number(matchA[1]) : 0;
      const numB = matchB ? Number(matchB[1]) : 0;
      return numB - numA;
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
    range: 'A1:Z',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [row],
    },
  });

  const appendedRowIndex = Number(response.data.updates?.updatedRange?.match(/A(\d+)/)?.[1] || 1);
  return { id: appendedRowIndex, ...studentData };
}

async function updateStudentInSheet(studentId, studentData) {
  const sheets = getSheetsClient();
  const spreadsheetId = await ensureStudentSheet();
  const students = await listStudentsFromSheet();
  const targetIndex = students.findIndex((student) => String(student.student_id).trim() === String(studentId).trim());

  if (targetIndex === -1) {
    throw new Error('Student not found in Google Sheet.');
  }

  const targetRowNumber = targetIndex + 2;
  const row = STUDENT_SHEET_HEADERS.map((header) => {
    const value = studentData[header] ?? '';
    return Array.isArray(value) ? JSON.stringify(value) : String(value ?? '');
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `A${targetRowNumber}:N${targetRowNumber}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [row],
    },
  });

  return { id: targetIndex + 1, ...studentData };
}

function escapeDriveQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function getMyDriveRootId(drive) {
  try {
    const response = await drive.files.get({
      fileId: 'root',
      fields: 'id',
    });
    return response.data.id;
  } catch (error) {
    console.warn(
      'Unable to resolve the current Google Drive root for this account; creating folders in the top-level Drive instead. ' +
        error.message
    );
    return null;
  }
}

async function resolveParentFolderId(drive, configuredParentId) {
  if (configuredParentId) {
    try {
      const response = await drive.files.get({
        fileId: configuredParentId,
        fields: 'id,name,mimeType',
      });
      if (response?.data?.id) {
        return response.data.id;
      }
    } catch (error) {
      console.warn(
        `Configured Google Drive parent folder "${configuredParentId}" is invalid or inaccessible. Falling back to the current Drive root. ${error.message}`
      );
    }
  }

  return getMyDriveRootId(drive);
}

async function findFolder(drive, name, parentId) {
  const clauses = [
    `name='${escapeDriveQuery(name)}'`,
    "mimeType='application/vnd.google-apps.folder'",
    'trashed=false',
  ];

  if (parentId) clauses.push(`'${escapeDriveQuery(parentId)}' in parents`);

  const response = await drive.files.list({
    q: clauses.join(' and '),
    fields: 'files(id,name)',
    spaces: 'drive',
    pageSize: 10,
  });

  return response.data.files?.[0] || null;
}

async function createFolder(drive, name, parentId) {
  const requestBody = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };

  if (parentId) requestBody.parents = [parentId];

  const response = await drive.files.create({
    requestBody,
    fields: 'id,name',
  });

  return response.data;
}

async function findOrCreateFolder(drive, name, parentId) {
  try {
    const existing = await findFolder(drive, name, parentId);
    if (existing) return existing;
    return createFolder(drive, name, parentId);
  } catch (error) {
    if (parentId) {
      console.warn(
        `Folder lookup failed for "${name}" under parent "${parentId}". Retrying in the top-level Drive root. ${error.message}`
      );
      return createFolder(drive, name);
    }
    throw error;
  }
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

  let parentId = null;
  try {
    parentId = await resolveParentFolderId(drive, configuredParentId);
  } catch (error) {
    console.warn(`Unable to resolve a valid Drive parent folder; creating student folders in the top-level Drive root. ${error.message}`);
  }

  const rootFolder = await findOrCreateFolder(drive, 'Student Photos', parentId || undefined);
  const folderName = `${sanitizeFolderPart(studentId)}_${sanitizeFolderPart(studentName)}`;
  const studentFolder = await findOrCreateFolder(drive, folderName, rootFolder.id);

  return { drive, folderId: studentFolder.id, folderName };
}

async function uploadPhoto(drive, folderId, file) {
  const response = await drive.files.create({
    requestBody: {
      name: file.originalname,
      parents: [folderId],
    },
    media: {
      mimeType: file.mimetype,
      body: Readable.from(file.buffer),
    },
    fields: 'id,name,mimeType,webViewLink',
  });

  return response.data;
}

async function getDriveFileStream(fileId) {
  const drive = getDriveClient();
  const response = await drive.files.get({
    fileId,
    alt: 'media',
  }, { responseType: 'arraybuffer' });

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
  getAuthorizationUrl,
  handleOAuthCallback,
  isGoogleAuthorized,
  ensureStudentSheet,
  resetStudentSheetHeaders,
  listStudentsFromSheet,
  findStudentInSheet,
  getStudentByIndex,
  getNextStudentIdFromSheet,
  appendStudentToSheet,
  updateStudentInSheet,
};
