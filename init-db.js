// init-db.js
// ─────────────────────────────────────────────────────────────
// Safe auto-migration script. Runs on every container start
// (Dockerfile CMD: node init-db.js && node app.js).
//
// Rules:
//  • CREATE TABLE IF NOT EXISTS  — never fails on re-run
//  • Column migrations use INFORMATION_SCHEMA check first
//    so ALTER TABLE only runs when the column is actually missing
//  • Existing data and users are NEVER deleted
//  • Admin password is always refreshed to admin123
//  • Retries DB connection for Docker startup race condition
// ─────────────────────────────────────────────────────────────

require('dotenv').config();
const mysql  = require('mysql2');
const bcrypt = require('bcrypt');

const DB_HOST     = process.env.DB_HOST     || 'localhost';
const DB_USER     = process.env.DB_USER     || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || 'vaasu';
const DB_NAME     = process.env.DB_NAME     || 'leaveease';

const MAX_RETRIES = 15;
const RETRY_DELAY = 5000;

// ── Helpers ───────────────────────────────────────────────────

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function connectWithRetry(attempt = 1) {
  return new Promise((resolve, reject) => {
    const db = mysql.createConnection({
      host: DB_HOST, user: DB_USER, password: DB_PASSWORD,
      multipleStatements: true
    });
    db.connect(err => {
      if (!err) return resolve(db);
      db.destroy();
      if (attempt >= MAX_RETRIES) {
        return reject(new Error(`MySQL not reachable after ${MAX_RETRIES} attempts: ${err.message}`));
      }
      console.log(`⏳ MySQL not ready (attempt ${attempt}/${MAX_RETRIES}). Retrying in ${RETRY_DELAY / 1000}s...`);
      wait(RETRY_DELAY)
        .then(() => connectWithRetry(attempt + 1))
        .then(resolve).catch(reject);
    });
  });
}

// ── Column migration helper ───────────────────────────────────
// Checks INFORMATION_SCHEMA before running ALTER TABLE.
// This works on ALL MySQL 8 versions and never errors on re-run.
async function addColumnIfMissing(query, table, column, definition) {
  const rows = await query(
    `SELECT COUNT(*) AS cnt
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [DB_NAME, table, column]
  );
  if (rows[0].cnt === 0) {
    await query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`   ✔ Migration: added column ${table}.${column}`);
  } else {
    console.log(`   – Column ${table}.${column} already exists, skipped`);
  }
}

// ── Main ──────────────────────────────────────────────────────

async function init() {
  console.log('\n🔧 LeaveEase – Auto Migration');
  console.log(`   Host: ${DB_HOST}  DB: ${DB_NAME}\n`);

  const db = await connectWithRetry();
  console.log('✅ Connected to MySQL\n');

  const query = (sql, params = []) =>
    new Promise((resolve, reject) =>
      db.query(sql, params, (err, results) => err ? reject(err) : resolve(results))
    );

  try {
    // ── 1. Database ───────────────────────────────────────────
    await query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
    await query(`USE \`${DB_NAME}\``);
    console.log(`📁 Database: ${DB_NAME}`);

    // ── 2. users table ────────────────────────────────────────
    // CREATE includes all current columns for fresh installs.
    // Existing installs get missing columns via addColumnIfMissing.
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id    INT AUTO_INCREMENT PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        email      VARCHAR(100) UNIQUE NOT NULL,
        password   VARCHAR(255) NOT NULL,
        dob        DATE NOT NULL,
        role       ENUM('admin','employee') NOT NULL DEFAULT 'employee',
        is_active  TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✔ Table: users');

    // Safe column migrations — run on every deploy, skip if already present
    await addColumnIfMissing(query, 'users', 'role',
      "ENUM('admin','employee') NOT NULL DEFAULT 'employee'");
    await addColumnIfMissing(query, 'users', 'is_active',
      'TINYINT(1) NOT NULL DEFAULT 1');
    await addColumnIfMissing(query, 'users', 'created_at',
      'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');

    // ── 3. leave_types ────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS leave_types (
        leave_type_id INT AUTO_INCREMENT PRIMARY KEY,
        name          VARCHAR(100) NOT NULL,
        description   TEXT
      )
    `);
    console.log('   ✔ Table: leave_types');

    // ── 4. admins ─────────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS admins (
        admin_id      INT AUTO_INCREMENT PRIMARY KEY,
        user_id       INT NOT NULL,
        designation   VARCHAR(100),
        contact_email VARCHAR(100),
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      )
    `);
    console.log('   ✔ Table: admins');

    // ── 5. leave_applications ─────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS leave_applications (
        leave_application_id INT AUTO_INCREMENT PRIMARY KEY,
        user_id              INT NOT NULL,
        leave_type_id        INT NOT NULL,
        from_date            DATE NOT NULL,
        to_date              DATE NOT NULL,
        reason               TEXT NOT NULL,
        status               ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
        applied_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id)       REFERENCES users(user_id),
        FOREIGN KEY (leave_type_id) REFERENCES leave_types(leave_type_id)
      )
    `);
    console.log('   ✔ Table: leave_applications');

    // ── 6. logs ───────────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS logs (
        log_id      INT AUTO_INCREMENT PRIMARY KEY,
        user_id     INT NOT NULL,
        action      VARCHAR(100) NOT NULL,
        timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP,
        description TEXT,
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      )
    `);
    console.log('   ✔ Table: logs');

    // ── 7. Triggers ───────────────────────────────────────────
    await query('DROP TRIGGER IF EXISTS log_new_leave_application');
    await query(`
      CREATE TRIGGER log_new_leave_application
      AFTER INSERT ON leave_applications
      FOR EACH ROW
        INSERT INTO logs (user_id, action, description)
        VALUES (
          NEW.user_id, 'Leave applied',
          CONCAT('Leave ID: ', NEW.leave_application_id,
                 ', Type: ', NEW.leave_type_id,
                 ', From: ', NEW.from_date, ', To: ', NEW.to_date)
        )
    `);
    await query('DROP TRIGGER IF EXISTS log_leave_status_update');
    await query(`
      CREATE TRIGGER log_leave_status_update
      AFTER UPDATE ON leave_applications
      FOR EACH ROW
        INSERT INTO logs (user_id, action, description)
        SELECT NEW.user_id,
               CONCAT('Leave status changed to ', NEW.status),
               CONCAT('Leave ID: ', NEW.leave_application_id,
                      ', From: ', NEW.from_date, ', To: ', NEW.to_date)
        WHERE NEW.status <> OLD.status
    `);
    console.log('   ✔ Triggers ready');

    // ── 8. Seed: leave types ──────────────────────────────────
    const [{ cnt: typeCount }] = await query('SELECT COUNT(*) AS cnt FROM leave_types');
    if (typeCount === 0) {
      await query(`
        INSERT INTO leave_types (name, description) VALUES
          ('Sick Leave',     'Leave due to illness or medical reasons'),
          ('Casual Leave',   'Short-notice personal leave'),
          ('Annual Leave',   'Planned vacation or personal time off'),
          ('Maternity Leave','Leave for new mothers'),
          ('Paternity Leave','Leave for new fathers'),
          ('Emergency Leave','Urgent unforeseen circumstances')
      `);
      console.log('   ✔ Seeded: 6 leave types');
    } else {
      console.log(`   – leave_types already has ${typeCount} rows, skipped`);
    }

    // ── 9. Seed / refresh admin user ─────────────────────────
    // Password is always re-hashed so it matches admin123 on every deploy.
    // Existing employee accounts are NEVER touched.
    const hashed = await bcrypt.hash('admin123', 10);
    const existing = await query(
      "SELECT user_id FROM users WHERE email = 'admin@leaveease.com'"
    );

    let adminUserId;
    if (existing.length === 0) {
      const result = await query(
        'INSERT INTO users (name, email, password, dob, role, is_active) VALUES (?,?,?,?,?,?)',
        ['Admin', 'admin@leaveease.com', hashed, '1990-01-01', 'admin', 1]
      );
      adminUserId = result.insertId;
      console.log('   ✔ Admin user created  →  admin@leaveease.com / admin123');
    } else {
      adminUserId = existing[0].user_id;
      await query(
        "UPDATE users SET password=?, role='admin', is_active=1 WHERE email='admin@leaveease.com'",
        [hashed]
      );
      console.log('   ✔ Admin refreshed  →  admin@leaveease.com / admin123');
    }

    // Ensure admins table row exists
    const adminRow = await query(
      'SELECT admin_id FROM admins WHERE user_id=?', [adminUserId]
    );
    if (adminRow.length === 0) {
      await query(
        'INSERT INTO admins (user_id, designation, contact_email) VALUES (?,?,?)',
        [adminUserId, 'System Administrator', 'admin@leaveease.com']
      );
      console.log('   ✔ admins table entry created');
    } else {
      console.log('   ✔ admins table entry OK');
    }

    console.log('\n✅ Migration complete — starting app...\n');

  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    console.error(err.stack);
    process.exit(1);   // non-zero exit stops app.js from starting
  } finally {
    db.end();
  }
}

init();
