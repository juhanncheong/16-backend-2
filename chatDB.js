const Database = require("better-sqlite3");

// creates chat.db in your backend folder
const db = new Database("chat.db");

// ✅ 1) Create table if missing (fresh install)
db.exec(`
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId TEXT NOT NULL,
  sender TEXT NOT NULL,      -- "user" or "admin"
  message TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
`);

// ✅ 2) MIGRATION: add missing columns safely for old DB files
function addColumn(table, columnDef) {
  try {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`).run();
    console.log(`✅ Added column: ${table}.${columnDef}`);
  } catch (e) {
    // ignore if already exists
  }
}

// old DB might not have createdAt
addColumn("chat_messages", "createdAt TEXT");

// optional: message status (sent/delivered/read)
addColumn("chat_messages", "status TEXT");

// ✅ 3) Admin-only nicknames table (admin notes)
db.exec(`
CREATE TABLE IF NOT EXISTS admin_notes (
  userId TEXT PRIMARY KEY,
  nickname TEXT,
  updatedAt TEXT
);
`);

module.exports = db;
