// app.js  –  LeaveEase  (Professional Edition)
// ─────────────────────────────────────────────────────────────
require('dotenv').config();
const express  = require('express');
const path     = require('path');
const bcrypt   = require('bcrypt');
const session  = require('express-session');
const db       = require('./db');
const calendarRoutes = require('./routes/calendar');
const { requireAuth, requireAdmin, requireEmployee } = require('./middleware/auth');

const app = express();

// ── Promisify db.query ────────────────────────────────────────
function queryAsync(sql, params) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
}

// ── View engine ───────────────────────────────────────────────
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// ── Middleware ────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'leaveease-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 8
  }
}));

// ── Calendar API ──────────────────────────────────────────────
app.use('/api', calendarRoutes);

// ═══════════════════════════════════════════════════════════════
// PUBLIC ROUTES  (no auth required)
// ═══════════════════════════════════════════════════════════════

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Login page (EJS so we can show error inline)
app.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    return req.session.user.role === 'admin'
      ? res.redirect('/admin-dashboard')
      : res.redirect('/dashboard');
  }
  res.render('login', { error: req.query.error || null });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.render('login', { error: 'Please enter email and password.' });
  }
  try {
    const results = await queryAsync('SELECT * FROM users WHERE email = ? AND is_active = 1', [email]);
    if (results.length === 0) {
      return res.render('login', { error: 'Invalid credentials or account disabled.' });
    }
    const user = results[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.render('login', { error: 'Invalid credentials.' });
    }
    req.session.user = {
      id:    user.user_id,
      name:  user.name,
      email: user.email,
      role:  user.role
    };
    return user.role === 'admin'
      ? res.redirect('/admin-dashboard')
      : res.redirect('/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    return res.render('login', { error: 'Login failed. Please try again.' });
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Forgot password (kept for employees)
app.get('/forgot', (req, res) => res.sendFile(path.join(__dirname, 'views', 'forgot.html')));

app.post('/forgot', async (req, res) => {
  const { email, dob, password, confirm_password } = req.body;
  if (!email || !dob || !password || !confirm_password) {
    return res.send('<h2>All fields are required.</h2><a href="/forgot">Go Back</a>');
  }
  if (password !== confirm_password) {
    return res.send('<h2>Passwords do not match.</h2><a href="/forgot">Try Again</a>');
  }
  try {
    const users = await queryAsync('SELECT * FROM users WHERE email = ? AND dob = ?', [email, dob]);
    if (users.length === 0) {
      return res.send('<h2>No matching user found.</h2><a href="/forgot">Try Again</a>');
    }
    const hashed = await bcrypt.hash(password, 10);
    await queryAsync('UPDATE users SET password = ? WHERE email = ? AND dob = ?', [hashed, email, dob]);
    res.send('<html><head><meta http-equiv="refresh" content="2;url=/login"/></head><body style="font-family:Arial;text-align:center;padding-top:50px"><h2 style="color:#2e7d32">Password Reset Successful!</h2><p>Redirecting to login...</p></body></html>');
  } catch (err) {
    console.error('Forgot password error:', err);
    res.send('<h2>Internal Server Error</h2><a href="/forgot">Go Back</a>');
  }
});

// Block old public signup route — redirect to login
app.get('/signup',  (req, res) => res.redirect('/login'));
app.post('/signup', (req, res) => res.status(403).json({ error: 'Self-registration is disabled. Contact your administrator.' }));

// ═══════════════════════════════════════════════════════════════
// EMPLOYEE ROUTES
// ═══════════════════════════════════════════════════════════════

app.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [userRows, countRows, monthRows, yearRows, recentLeaves, statsRows, monthlyRows] = await Promise.all([
      queryAsync('SELECT name FROM users WHERE user_id = ?', [userId]),
      queryAsync('SELECT COUNT(*) AS leavesApplied FROM leave_applications WHERE user_id = ?', [userId]),
      queryAsync(`SELECT COUNT(*) AS leavesAppliedThisMonth FROM leave_applications WHERE user_id = ? AND MONTH(applied_at)=MONTH(CURDATE()) AND YEAR(applied_at)=YEAR(CURDATE())`, [userId]),
      queryAsync(`SELECT COUNT(*) AS leavesAppliedThisYear FROM leave_applications WHERE user_id = ? AND YEAR(applied_at)=YEAR(CURDATE())`, [userId]),
      queryAsync(`SELECT la.leave_application_id, lt.name AS leave_type, DATE_FORMAT(la.from_date,'%Y-%m-%d') AS from_date, DATE_FORMAT(la.to_date,'%Y-%m-%d') AS to_date, la.status FROM leave_applications la JOIN leave_types lt ON la.leave_type_id=lt.leave_type_id WHERE la.user_id=? ORDER BY la.applied_at DESC LIMIT 5`, [userId]),
      queryAsync(`SELECT SUM(status='approved') AS approved, SUM(status='rejected') AS rejected, SUM(status='pending') AS pending, COUNT(*) AS total FROM leave_applications WHERE user_id=?`, [userId]),
      queryAsync(`SELECT MONTH(applied_at) AS month, COUNT(*) AS count FROM leave_applications WHERE user_id=? AND YEAR(applied_at)=YEAR(CURDATE()) AND status='approved' GROUP BY MONTH(applied_at) ORDER BY month`, [userId])
    ]);
    const monthlyLeaveCounts = Array(12).fill(0);
    monthlyRows.forEach(r => { monthlyLeaveCounts[r.month - 1] = r.count; });
    res.render('employee-dashboard', {
      user: userRows[0] || { name: 'Employee' },
      leavesApplied: countRows[0].leavesApplied,
      leavesAppliedThisMonth: monthRows[0].leavesAppliedThisMonth,
      leavesAppliedThisYear: yearRows[0].leavesAppliedThisYear,
      recentLeaves,
      stats: statsRows[0],
      monthlyLeaveCounts,
      notifications: []
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.render('employee-dashboard', {
      user: { name: 'Employee' }, leavesApplied: 0, leavesAppliedThisMonth: 0,
      leavesAppliedThisYear: 0, recentLeaves: [],
      stats: { approved: 0, rejected: 0, pending: 0, total: 0 },
      monthlyLeaveCounts: Array(12).fill(0), notifications: []
    });
  }
});

app.get(['/profile', '/employee-profile.html'], requireAuth, async (req, res) => {
  try {
    const rows = await queryAsync('SELECT name, email, dob FROM users WHERE user_id = ?', [req.session.user.id]);
    if (!rows.length) return res.status(404).send('User not found');
    res.render('employee-profile', { user: rows[0] });
  } catch (err) {
    res.status(500).send('Something went wrong!');
  }
});

app.post('/profile/edit', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const { name, email } = req.body;
  if (!name || !email) return renderProfileMsg(res, userId, { error: 'Name and email are required.' });
  try {
    const existing = await queryAsync('SELECT user_id FROM users WHERE email=? AND user_id!=?', [email, userId]);
    if (existing.length) return renderProfileMsg(res, userId, { error: 'Email already in use.' });
    await queryAsync('UPDATE users SET name=?, email=? WHERE user_id=?', [name, email, userId]);
    req.session.user.name  = name;
    req.session.user.email = email;
    return renderProfileMsg(res, userId, { success: 'Profile updated.' });
  } catch (err) {
    return renderProfileMsg(res, userId, { error: 'Something went wrong.' });
  }
});

app.post('/profile/reset-password', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const { oldPassword, newPassword, confirmPassword } = req.body;
  if (!oldPassword || !newPassword || !confirmPassword) return renderProfileMsg(res, userId, { error: 'All fields required.' });
  if (newPassword.length < 6) return renderProfileMsg(res, userId, { error: 'Password must be at least 6 characters.' });
  if (newPassword !== confirmPassword) return renderProfileMsg(res, userId, { error: 'Passwords do not match.' });
  try {
    const rows = await queryAsync('SELECT password, name, email, dob FROM users WHERE user_id=?', [userId]);
    if (!rows.length) return renderProfileMsg(res, userId, { error: 'User not found.' });
    const match = await bcrypt.compare(oldPassword, rows[0].password);
    if (!match) return renderProfileMsg(res, userId, { error: 'Old password is incorrect.' });
    const hashed = await bcrypt.hash(newPassword, 10);
    await queryAsync('UPDATE users SET password=? WHERE user_id=?', [hashed, userId]);
    return renderProfileMsg(res, userId, { success: 'Password updated.' });
  } catch (err) {
    return renderProfileMsg(res, userId, { error: 'Something went wrong.' });
  }
});

async function renderProfileMsg(res, userId, msg) {
  try {
    const rows = await queryAsync('SELECT name, email, dob FROM users WHERE user_id=?', [userId]);
    res.render('employee-profile', { user: rows[0] || {}, ...msg });
  } catch (err) {
    res.status(500).send('Something went wrong!');
  }
}

app.get('/leave-apply', requireAuth, async (req, res) => {
  const leaveTypes = await queryAsync('SELECT leave_type_id, name FROM leave_types', []);
  res.render('leave-apply', { leaveTypes });
});

app.post('/leave-apply', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const { leaveType, fromDate, toDate, reason } = req.body;
  const leaveTypes = await queryAsync('SELECT leave_type_id, name FROM leave_types', []);
  if (!leaveType || !fromDate || !toDate || !reason)
    return res.render('leave-apply', { leaveTypes, error: 'All fields are required.' });
  if (new Date(fromDate) > new Date(toDate))
    return res.render('leave-apply', { leaveTypes, error: 'From Date cannot be after To Date.' });
  try {
    await queryAsync('INSERT INTO leave_applications (user_id,leave_type_id,from_date,to_date,reason) VALUES (?,?,?,?,?)',
      [userId, leaveType, fromDate, toDate, reason]);
    res.render('leave-apply', { leaveTypes, success: 'Leave request submitted successfully!' });
  } catch (err) {
    res.render('leave-apply', { leaveTypes, error: 'Something went wrong.' });
  }
});

app.get('/leave-edit/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.id;
  try {
    const rows = await queryAsync(
      `SELECT la.*, lt.name as leave_type_name FROM leave_applications la JOIN leave_types lt ON la.leave_type_id=lt.leave_type_id WHERE la.leave_application_id=? AND la.user_id=? AND la.status='pending'`,
      [id, userId]);
    if (!rows.length) return res.status(404).render('error', { message: 'Leave not found or not editable.', error: { status: 404 } });
    const leaveTypes = await queryAsync('SELECT leave_type_id, name FROM leave_types', []);
    res.render('leave-edit', { leave: rows[0], leaveTypes, error: null, success: null });
  } catch (err) {
    res.status(500).render('error', { message: 'Something went wrong.', error: { status: 500 } });
  }
});

app.post('/leave-edit/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.id;
  const { leaveType, fromDate, toDate, reason } = req.body;
  const leaveTypes = await queryAsync('SELECT leave_type_id, name FROM leave_types', []);
  if (!leaveType || !fromDate || !toDate || !reason)
    return res.render('leave-edit', { leave: { leave_application_id: id, leave_type_id: leaveType, from_date: fromDate, to_date: toDate, reason }, leaveTypes, error: 'All fields required.', success: null });
  if (new Date(fromDate) > new Date(toDate))
    return res.render('leave-edit', { leave: { leave_application_id: id, leave_type_id: leaveType, from_date: fromDate, to_date: toDate, reason }, leaveTypes, error: 'From Date cannot be after To Date.', success: null });
  try {
    const verify = await queryAsync('SELECT * FROM leave_applications WHERE leave_application_id=? AND user_id=? AND status="pending"', [id, userId]);
    if (!verify.length) return res.status(404).render('error', { message: 'Leave not found.', error: { status: 404 } });
    await queryAsync('UPDATE leave_applications SET leave_type_id=?,from_date=?,to_date=?,reason=? WHERE leave_application_id=?',
      [leaveType, fromDate, toDate, reason, id]);
    res.redirect('/dashboard');
  } catch (err) {
    res.status(500).render('error', { message: 'Something went wrong.', error: { status: 500 } });
  }
});

app.delete('/leave-delete/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.id;
  try {
    const verify = await queryAsync('SELECT * FROM leave_applications WHERE leave_application_id=? AND user_id=? AND status="pending"', [id, userId]);
    if (!verify.length) return res.status(404).json({ success: false, message: 'Not found or not deletable.' });
    await queryAsync('DELETE FROM leave_applications WHERE leave_application_id=?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════

app.get('/admin-dashboard', requireAdmin, async (req, res) => {
  try {
    const [pending, approved, rejected, total, employees] = await Promise.all([
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications WHERE status='pending'`, []),
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications WHERE status='approved'`, []),
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications WHERE status='rejected'`, []),
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications`, []),
      queryAsync(`SELECT COUNT(*) as count FROM users WHERE role='employee' AND is_active=1`, [])
    ]);
    res.render('admin-dashboard', {
      stats: { pending: pending[0].count, approved: approved[0].count, rejected: rejected[0].count, total: total[0].count },
      employeeCount: employees[0].count,
      notifications: [], allUsers: []
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.render('admin-dashboard', { stats: { pending:0,approved:0,rejected:0,total:0 }, employeeCount:0, notifications:[], allUsers:[] });
  }
});

// ── User Management ───────────────────────────────────────────

app.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await queryAsync(
      `SELECT user_id, name, email, dob, role, is_active, created_at FROM users WHERE role='employee' ORDER BY created_at DESC`, []);
    res.render('admin-users', { users, success: req.query.success || null, error: req.query.error || null });
  } catch (err) {
    res.render('admin-users', { users: [], error: 'Could not load users.', success: null });
  }
});

app.get('/admin/create-user', requireAdmin, (req, res) => {
  res.render('admin-create-user', { error: null, success: null });
});

app.post('/admin/create-user', requireAdmin, async (req, res) => {
  const { name, email, dob, password } = req.body;
  if (!name || !email || !dob || !password)
    return res.render('admin-create-user', { error: 'All fields are required.', success: null });
  if (password.length < 6)
    return res.render('admin-create-user', { error: 'Password must be at least 6 characters.', success: null });
  try {
    const existing = await queryAsync('SELECT user_id FROM users WHERE email=?', [email]);
    if (existing.length)
      return res.render('admin-create-user', { error: 'Email already registered.', success: null });
    const hashed = await bcrypt.hash(password, 10);
    await queryAsync('INSERT INTO users (name,email,password,dob,role,is_active) VALUES (?,?,?,?,?,?)',
      [name, email, hashed, dob, 'employee', 1]);
    res.render('admin-create-user', { error: null, success: `Employee account created for ${name}.` });
  } catch (err) {
    console.error('Create user error:', err);
    res.render('admin-create-user', { error: 'Something went wrong.', success: null });
  }
});

app.post('/admin/reset-password/:userId', requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6)
    return res.redirect('/admin/users?error=' + encodeURIComponent('Password must be at least 6 characters.'));
  try {
    const hashed = await bcrypt.hash(newPassword, 10);
    await queryAsync('UPDATE users SET password=? WHERE user_id=? AND role="employee"', [hashed, userId]);
    res.redirect('/admin/users?success=' + encodeURIComponent('Password reset successfully.'));
  } catch (err) {
    res.redirect('/admin/users?error=' + encodeURIComponent('Something went wrong.'));
  }
});

app.post('/admin/toggle-user/:userId', requireAdmin, async (req, res) => {
  const { userId } = req.params;
  try {
    await queryAsync('UPDATE users SET is_active = NOT is_active WHERE user_id=? AND role="employee"', [userId]);
    res.redirect('/admin/users?success=' + encodeURIComponent('User status updated.'));
  } catch (err) {
    res.redirect('/admin/users?error=' + encodeURIComponent('Something went wrong.'));
  }
});

// ── Leave Requests ────────────────────────────────────────────

const leaveRequestQuery = (status) => `
  SELECT la.leave_application_id, u.user_id, u.name, lt.name AS leave_type,
         la.from_date, la.to_date, la.reason
  FROM leave_applications la
  JOIN users u  ON la.user_id=u.user_id
  JOIN leave_types lt ON la.leave_type_id=lt.leave_type_id
  WHERE la.status='${status}' ORDER BY la.applied_at DESC`;

app.get('/admin/leave-requests',          requireAdmin, (req, res) => res.redirect('/admin/leave-requests/pending'));
app.get('/admin/leave-requests/pending',  requireAdmin, serveLeaveTab('pending'));
app.get('/admin/leave-requests/approved', requireAdmin, serveLeaveTab('approved'));
app.get('/admin/leave-requests/rejected', requireAdmin, serveLeaveTab('rejected'));

function serveLeaveTab(tab) {
  return async (req, res) => {
    try {
      const [pending, approved, rejected] = await Promise.all([
        queryAsync(leaveRequestQuery('pending'),  []),
        queryAsync(leaveRequestQuery('approved'), []),
        queryAsync(leaveRequestQuery('rejected'), [])
      ]);
      res.render('admin-leave-requests', { pending, approved, rejected, notifications: [], activeTab: tab });
    } catch (err) {
      res.render('admin-leave-requests', { pending:[], approved:[], rejected:[], notifications:[], activeTab: tab, error: 'Something went wrong.' });
    }
  };
}

app.post('/admin/leave/approve/:leaveId', requireAdmin, async (req, res) => {
  try {
    const leave = (await queryAsync('SELECT * FROM leave_applications WHERE leave_application_id=?', [req.params.leaveId]))[0];
    if (!leave || leave.status !== 'pending') return res.status(400).send('Already processed.');
    await queryAsync('UPDATE leave_applications SET status="approved" WHERE leave_application_id=?', [req.params.leaveId]);
    res.redirect('/admin/leave-requests/pending');
  } catch (err) { res.status(500).send('Something went wrong.'); }
});

app.post('/admin/leave/reject/:leaveId', requireAdmin, async (req, res) => {
  try {
    const leave = (await queryAsync('SELECT * FROM leave_applications WHERE leave_application_id=?', [req.params.leaveId]))[0];
    if (!leave || leave.status !== 'pending') return res.status(400).send('Already processed.');
    await queryAsync('UPDATE leave_applications SET status="rejected" WHERE leave_application_id=?', [req.params.leaveId]);
    res.redirect('/admin/leave-requests/pending');
  } catch (err) { res.status(500).send('Something went wrong.'); }
});

// ── Admin Stats / Profile / Logs ──────────────────────────────

app.get('/admin/user-stats/:userId', requireAdmin, async (req, res) => {
  const { userId } = req.params;
  try {
    const user = (await queryAsync('SELECT name, email FROM users WHERE user_id=?', [userId]))[0];
    const monthlyRows = await queryAsync(
      `SELECT MONTH(applied_at) AS month, COUNT(*) AS count FROM leave_applications WHERE user_id=? AND YEAR(applied_at)=YEAR(CURDATE()) AND status='approved' GROUP BY MONTH(applied_at) ORDER BY month`, [userId]);
    const monthlyLeaveCounts = Array(12).fill(0);
    monthlyRows.forEach(r => { monthlyLeaveCounts[r.month - 1] = r.count; });
    const yearlyResults = await queryAsync(
      `SELECT YEAR(applied_at) AS year, COUNT(*) AS count FROM leave_applications WHERE user_id=? AND status='approved' GROUP BY YEAR(applied_at) ORDER BY year`, [userId]);
    const typeResults = await queryAsync(
      `SELECT lt.name AS type, COUNT(*) AS count FROM leave_applications la JOIN leave_types lt ON la.leave_type_id=lt.leave_type_id WHERE la.user_id=? AND la.status='approved' GROUP BY lt.name`, [userId]);
    res.json({ user, monthlyLeaveCounts, yearlyResults, typeResults });
  } catch (err) { res.status(500).json({ error: 'Could not fetch stats.' }); }
});

app.get('/admin-profile', requireAdmin, async (req, res) => {
  try {
    const [pending, approved, rejected, total] = await Promise.all([
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications WHERE status='pending'`, []),
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications WHERE status='approved'`, []),
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications WHERE status='rejected'`, []),
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications`, [])
    ]);
    res.render('admin-profile', {
      user: req.session.user,
      stats: { pending: pending[0].count, approved: approved[0].count, rejected: rejected[0].count, total: total[0].count }
    });
  } catch (err) {
    res.render('admin-profile', { user: req.session.user, stats: { pending:0,approved:0,rejected:0,total:0 } });
  }
});

app.post('/admin-profile/change-password', requireAdmin, async (req, res) => {
  const { oldPassword, newPassword, confirmPassword } = req.body;
  if (!oldPassword || !newPassword || !confirmPassword)
    return res.redirect('/admin-profile?error=' + encodeURIComponent('All fields required.'));
  if (newPassword.length < 6)
    return res.redirect('/admin-profile?error=' + encodeURIComponent('Password must be at least 6 characters.'));
  if (newPassword !== confirmPassword)
    return res.redirect('/admin-profile?error=' + encodeURIComponent('Passwords do not match.'));
  try {
    const rows = await queryAsync('SELECT password FROM users WHERE email=?', [req.session.user.email]);
    if (!rows.length) return res.redirect('/admin-profile?error=' + encodeURIComponent('User not found.'));
    const match = await bcrypt.compare(oldPassword, rows[0].password);
    if (!match) return res.redirect('/admin-profile?error=' + encodeURIComponent('Old password incorrect.'));
    const hashed = await bcrypt.hash(newPassword, 10);
    await queryAsync('UPDATE users SET password=? WHERE email=?', [hashed, req.session.user.email]);
    res.redirect('/admin-profile?success=' + encodeURIComponent('Password updated.'));
  } catch (err) {
    res.redirect('/admin-profile?error=' + encodeURIComponent('Something went wrong.'));
  }
});

app.get('/admin/logs', requireAdmin, async (req, res) => {
  try {
    const logs = await queryAsync(
      'SELECT l.*, u.name FROM logs l LEFT JOIN users u ON l.user_id=u.user_id ORDER BY l.timestamp DESC LIMIT 100', []);
    res.render('admin-logs', { logs });
  } catch (err) {
    res.render('admin-logs', { logs: [], error: 'Could not load logs.' });
  }
});

// ── Debug / Health routes ─────────────────────────────────────
app.get('/db-test', (req, res) => {
  db.query('SELECT 1+1 AS solution', (err, results) => {
    if (err) return res.status(500).send('DB error: ' + err.message);
    res.send('DB connected. Result: ' + results[0].solution);
  });
});

// ── 404 & Error handlers ──────────────────────────────────────
app.use((req, res) => res.status(404).render('error', { message: 'Page not found.', error: { status: 404 } }));
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { message: 'Internal server error.', error: { status: 500 } });
});

// ── Start server ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LeaveEase running on http://localhost:${PORT}`));
