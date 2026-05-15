// init-db.js
// ─────────────────────────────────────────────────────────────
// Runs automatically before app.js starts (see Dockerfile CMD).
// • Creates all tables if they don't exist
// • Seeds leave types and the default admin user
// • Retries the DB connection so Docker startup order doesn't matter
// ─────────────────────────────────────────────────────────────

require('dotenv').config();
const mysql  = require('mysql2');
const bcrypt = require('bcrypt');

// ── Connection config (reads from environment / .env) ────────
const DB_CONFIG = {
  host:               process.env.DB_HOST     || 'localhost',
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || 'vaasu',
  multipleStatements: true
};

// ── Retry wrapper ────────────────────────────────────────────
// MySQL inside Docker takes ~20-30 s to be ready.
// We try up to MAX_RETRIES times before giving up.
const MAX_RETRIES  = 15;
const RETRY_DELAY  = 5000; // ms

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function connectWithRetry(attempt = 1) {
  return new Promise((resolve, reject) => {
    const db = mysql.createConnection(DB_CONFIG);
    db.connect(err => {
      if (!err) return resolve(db);
      db.destroy();
      if (attempt >= MAX_RETRIES) {
        return reject(new Error(`MySQL not reachable after ${MAX_RETRIES} attempts: ${err.message}`));
      }
      console.log(`⏳ MySQL not ready yet (attempt ${attempt}/${MAX_RETRIES}). Retrying in ${RETRY_DELAY / 1000}s...`);
      wait(RETRY_DELAY).then(() => connectWithRetry(attempt + 1)).then(resolve).catch(reject);
    });
  });
}

// ── Main init function ───────────────────────────────────────
async function init() {
  console.log('\n🔧 LeaveEase – Database Initialisation');
  console.log('   Connecting to MySQL at', DB_CONFIG.host, '...\n');

  const db = await connectWithRetry();
  console.log('✅ Connected to MySQL.\n');

  // Promisify db.query for async/await usage
  const query = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.query(sql, params, (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });

  try {
    // ── 1. Create & select database ──────────────────────────
    await query('CREATE DATABASE IF NOT EXISTS leaveease');
    await query('USE leaveease');
    console.log('📁 Database: leaveease');

    // ── 2. users ─────────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id   INT AUTO_INCREMENT PRIMARY KEY,
        name      VARCHAR(100) NOT NULL,
        email     VARCHAR(100) UNIQUE NOT NULL,
        password  VARCHAR(255) NOT NULL,
        dob       DATE NOT NULL
      )
    `);
    console.log('   ✔ Table: users');

    // ── 3. leave_types ───────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS leave_types (
        leave_type_id INT AUTO_INCREMENT PRIMARY KEY,
        name          VARCHAR(100) NOT NULL,
        description   TEXT
      )
    `);
    console.log('   ✔ Table: leave_types');

    // ── 4. admins ────────────────────────────────────────────
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

    // ── 5. leave_applications ────────────────────────────────
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

    // ── 6. logs ──────────────────────────────────────────────
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

    // ── 7. Triggers ──────────────────────────────────────────
    // Drop first so re-running init-db.js never errors
    await query('DROP TRIGGER IF EXISTS log_new_leave_application');
    await query(`
      CREATE TRIGGER log_new_leave_application
      AFTER INSERT ON leave_applications
      FOR EACH ROW
        INSERT INTO logs (user_id, action, description)
        VALUES (
          NEW.user_id,
          'Leave applied',
          CONCAT('Leave ID: ', NEW.leave_application_id,
                 ', Type: ', NEW.leave_type_id,
                 ', From: ', NEW.from_date,
                 ', To: ', NEW.to_date)
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
                      ', From: ', NEW.from_date,
                      ', To: ', NEW.to_date)
        WHERE NEW.status <> OLD.status
    `);
    console.log('   ✔ Triggers: log_new_leave_application, log_leave_status_update');

    // ── 8. Seed: leave types ─────────────────────────────────
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
      console.log('   – Skipped: leave_types already seeded');
    }

    // ── 9. Seed: admin user ──────────────────────────────────
    // Always re-hash and update the password so the DB is never out of sync
    // with the intended credentials, even if init-db.js is re-run.
    const hashed = await bcrypt.hash('admin123', 10);

    const existingAdmin = await query(
      "SELECT user_id FROM users WHERE email = 'admin@leaveease.com'"
    );

    let adminUserId;
    if (existingAdmin.length === 0) {
      // First run — insert the admin user
      const result = await query(
        'INSERT INTO users (name, email, password, dob) VALUES (?, ?, ?, ?)',
        ['Admin', 'admin@leaveease.com', hashed, '1990-01-01']
      );
      adminUserId = result.insertId;
      console.log('   ✔ Seeded: admin user  →  admin@leaveease.com / admin123');
    } else {
      // Already exists — update password to guarantee it matches admin123
      adminUserId = existingAdmin[0].user_id;
      await query(
        "UPDATE users SET password = ? WHERE email = 'admin@leaveease.com'",
        [hashed]
      );
      console.log('   ✔ Admin password refreshed  →  admin@leaveease.com / admin123');
    }

    // Ensure admins table entry exists
    const adminEntry = await query(
      'SELECT admin_id FROM admins WHERE user_id = ?',
      [adminUserId]
    );
    if (adminEntry.length === 0) {
      await query(
        'INSERT INTO admins (user_id, designation, contact_email) VALUES (?, ?, ?)',
        [adminUserId, 'System Administrator', 'admin@leaveease.com']
      );
      console.log('   ✔ admins table entry created');
    } else {
      console.log('   ✔ admins table entry OK');
    }

    console.log('\n✅ Database ready!\n');
  } catch (err) {
    console.error('\n❌ Init failed:', err.message);
    process.exit(1);
  } finally {
    db.end();
  }
}

init();
