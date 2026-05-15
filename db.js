// db.js
// Loads .env variables and creates a MySQL connection pool.
// Using mysql2 (already in package.json).

require('dotenv').config();
const mysql = require('mysql2');

const db = mysql.createConnection({
  host:     process.env.DB_HOST     || 'localhost',
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'leaveease'
});

db.connect((err) => {
  if (err) {
    console.error('❌ DB connection failed:', err.message);
    console.error('   Check your .env file (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME)');
    process.exit(1); // Stop the server — no point running without a DB
  } else {
    console.log('✅ Connected to MySQL database:', process.env.DB_NAME || 'leaveease');
  }
});

module.exports = db;
