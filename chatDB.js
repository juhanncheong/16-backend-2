const Database = require("better-sqlite3");

// creates chat.db in your backend folder
const db = new Database("chat.db");

// create table (runs once)
db.exec(`
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId TEXT NOT NULL,
  sender TEXT NOT NULL,      -- "user" or "admin"
  message TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
`);

module.exports = db;
