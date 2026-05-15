// reset-admin.js
// ─────────────────────────────────────────────────────────────
// Resets the admin@leaveease.com password to admin123
// and ensures the admins table entry exists.
//
// Run once:  node reset-admin.js
// Delete after use if you want (safe to keep though).
// ─────────────────────────────────────────────────────────────

require('dotenv').config();
const bcrypt = require('bcrypt');
const mysql  = require('mysql2');

const db = mysql.createConnection({
  host:     process.env.DB_HOST     || 'localhost',
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || 'vaasu',
  database: process.env.DB_NAME     || 'leaveease'
});

const query = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.query(sql, params, (err, results) => (err ? reject(err) : resolve(results)))
  );

async function resetAdmin() {
  await new Promise((resolve, reject) =>
    db.connect(err => (err ? reject(err) : resolve()))
  );
  console.log('Connected to MySQL.\n');

  try {
    // 1. Hash the correct password
    const hashed = await bcrypt.hash('admin123', 10);
    console.log('New hash generated:', hashed);

    // 2. Check if admin user exists
    const existing = await query(
      "SELECT user_id FROM users WHERE email = 'admin@leaveease.com'"
    );

    let adminUserId;

    if (existing.length > 0) {
      // User exists — just update the password
      adminUserId = existing[0].user_id;
      await query(
        "UPDATE users SET password = ? WHERE email = 'admin@leaveease.com'",
        [hashed]
      );
      console.log('✅ Password updated for admin@leaveease.com (user_id =', adminUserId + ')');
    } else {
      // User doesn't exist — insert fresh
      const result = await query(
        "INSERT INTO users (name, email, password, dob) VALUES (?, ?, ?, ?)",
        ['Admin', 'admin@leaveease.com', hashed, '1990-01-01']
      );
      adminUserId = result.insertId;
      console.log('✅ Admin user created (user_id =', adminUserId + ')');
    }

    // 3. Ensure admins table entry exists
    const adminRow = await query(
      'SELECT admin_id FROM admins WHERE user_id = ?',
      [adminUserId]
    );

    if (adminRow.length === 0) {
      await query(
        'INSERT INTO admins (user_id, designation, contact_email) VALUES (?, ?, ?)',
        [adminUserId, 'System Administrator', 'admin@leaveease.com']
      );
      console.log('✅ admins table entry created for user_id =', adminUserId);
    } else {
      console.log('✅ admins table entry already exists (admin_id =', adminRow[0].admin_id + ')');
    }

    // 4. Verify the fix immediately
    const verify = await query(
      "SELECT password FROM users WHERE email = 'admin@leaveease.com'"
    );
    const ok = await bcrypt.compare('admin123', verify[0].password);
    console.log('\n🔍 Verification — bcrypt.compare("admin123", new_hash):', ok ? '✅ TRUE' : '❌ FALSE');

    if (ok) {
      console.log('\n✅ Done! Admin login is ready:');
      console.log('   Email:    admin@leaveease.com');
      console.log('   Password: admin123\n');
    } else {
      console.log('\n❌ Something went wrong — hash still does not match. Check bcrypt installation.\n');
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    db.end();
  }
}

resetAdmin();
