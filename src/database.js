const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'students.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL UNIQUE,
    student_name TEXT NOT NULL,
    date_of_birth TEXT NOT NULL,
    class_name TEXT NOT NULL,
    division TEXT NOT NULL,
    roll_number TEXT NOT NULL,
    guardian_name TEXT NOT NULL,
    guardian_contact TEXT NOT NULL,
    address TEXT NOT NULL,
    drive_folder_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS student_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    original_name TEXT NOT NULL,
    drive_file_id TEXT NOT NULL,
    mime_type TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
  );
`);

module.exports = db;
