require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const calendarRoutes = require('./routes/calendar');
const session = require('express-session');

const app = express();

const db = require('./db'); // DB connection module

// Promisify db.query
function queryAsync(sql, params) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
}

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

// Session configuration
// IMPORTANT: secure:true requires HTTPS — it must be false for plain HTTP localhost.
// We only enable it when explicitly running behind HTTPS in production.
app.use(session({
  secret: process.env.SESSION_SECRET || 'leaveease-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,          // false = works on HTTP (localhost). Change to true only with HTTPS.
    httpOnly: true,         // prevents JS from reading the cookie (security best practice)
    maxAge: 1000 * 60 * 60 * 8  // session lasts 8 hours
  }
}));

// Authentication middleware
const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect('/login');
};

// Static Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'views', 'signup.html')));
app.get('/forgot', (req, res) => res.sendFile(path.join(__dirname, 'views', 'forgot.html')));

// Use calendar routes
app.use('/api', calendarRoutes);

// Dashboard route
app.get('/dashboard', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const userSql = 'SELECT name FROM users WHERE user_id = ?';
    const userResults = await queryAsync(userSql, [userId]);
    if (userResults.length === 0) {
      return res.render('employee-dashboard', {
        user: { name: 'User' },
        leavesApplied: 0,
        leavesAppliedThisMonth: 0,
        leavesAppliedThisYear: 0,
        recentLeaves: [],
        stats: { approved: 0, rejected: 0, pending: 0, total: 0 },
        monthlyLeaveCounts: [],
        notifications: []
      });
    }
    // Count total leave requests
    const countSql = 'SELECT COUNT(*) AS leavesApplied FROM leave_applications WHERE user_id = ?';
    const countResults = await queryAsync(countSql, [userId]);
    // Count leaves applied this month
    const monthSql = `SELECT COUNT(*) AS leavesAppliedThisMonth FROM leave_applications WHERE user_id = ? AND MONTH(applied_at) = MONTH(CURDATE()) AND YEAR(applied_at) = YEAR(CURDATE())`;
    const monthResults = await queryAsync(monthSql, [userId]);
    // Count leaves applied this year
    const yearSql = `SELECT COUNT(*) AS leavesAppliedThisYear FROM leave_applications WHERE user_id = ? AND YEAR(applied_at) = YEAR(CURDATE())`;
    const yearResults = await queryAsync(yearSql, [userId]);
    // Get recent leave requests (last 5)
    const recentSql = `
      SELECT la.leave_application_id, lt.name AS leave_type, DATE_FORMAT(la.from_date, '%Y-%m-%d') AS from_date, DATE_FORMAT(la.to_date, '%Y-%m-%d') AS to_date, la.status
      FROM leave_applications la
      JOIN leave_types lt ON la.leave_type_id = lt.leave_type_id
      WHERE la.user_id = ?
      ORDER BY la.applied_at DESC
      LIMIT 5
    `;
    const recentLeaves = await queryAsync(recentSql, [userId]);
    // Stats for approved, rejected, pending, total
    const statsSql = `
      SELECT
        SUM(status = 'approved') AS approved,
        SUM(status = 'rejected') AS rejected,
        SUM(status = 'pending') AS pending,
        COUNT(*) AS total
      FROM leave_applications
      WHERE user_id = ?
    `;
    const statsResults = await queryAsync(statsSql, [userId]);
    // Monthly leave counts for the current year (only approved)
    const monthlySql = `
      SELECT MONTH(applied_at) AS month, COUNT(*) AS count
      FROM leave_applications
      WHERE user_id = ? AND YEAR(applied_at) = YEAR(CURDATE()) AND status = 'approved'
      GROUP BY MONTH(applied_at)
      ORDER BY month
    `;
    const monthlyResults = await queryAsync(monthlySql, [userId]);
    // Prepare array of 12 months
    const monthlyLeaveCounts = Array(12).fill(0);
    monthlyResults.forEach(row => {
      monthlyLeaveCounts[row.month - 1] = row.count;
    });
    res.render('employee-dashboard', {
      user: userResults[0],
      leavesApplied: countResults[0].leavesApplied,
      leavesAppliedThisMonth: monthResults[0].leavesAppliedThisMonth,
      leavesAppliedThisYear: yearResults[0].leavesAppliedThisYear,
      recentLeaves,
      stats: statsResults[0],
      monthlyLeaveCounts,
      notifications: []
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.render('employee-dashboard', {
      user: { name: 'User' },
      leavesApplied: 0,
      leavesAppliedThisMonth: 0,
      leavesAppliedThisYear: 0,
      recentLeaves: [],
      stats: { approved: 0, rejected: 0, pending: 0, total: 0 },
      monthlyLeaveCounts: [],
      notifications: []
    });
  }
});

// Employee Profile route
app.get(['/profile', '/employee-profile.html'], isAuthenticated, async (req, res) => {
  console.log('Session user:', req.session.user);
  try {
    const userId = req.session.user.id;
    const sql = 'SELECT name, email, dob FROM users WHERE user_id = ?';
    const results = await queryAsync(sql, [userId]);
    if (results.length === 0) {
      return res.status(404).send('User not found');
    }
    res.render('employee-profile', { user: results[0] });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).send('Something went wrong!');
  }
});

// Logout route
app.get('/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).send('Error during logout');
    }
    res.redirect('/login');
  });
});

// Signup Handler
app.post('/signup', async (req, res) => {
  console.log('Received signup request:', req.body); // Debug log

  const { name, email, password, dob } = req.body;

  // Check each field individually
  if (!name) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }
  if (!password) {
    return res.status(400).json({ error: 'Password is required.' });
  }
  if (!dob) {
    return res.status(400).json({ error: 'Date of Birth is required.' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  // Validate password length
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  try {
    // Check if email already exists
    const checkEmailSql = 'SELECT * FROM users WHERE email = ?';
    const existingUsers = await queryAsync(checkEmailSql, [email]);
    
    if (existingUsers.length > 0) {
      return res.status(400).json({ error: 'Email already registered. Please use a different email.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const sql = 'INSERT INTO users (name, email, password, dob) VALUES (?, ?, ?, ?)';
    await queryAsync(sql, [name, email, hashedPassword, dob]);

    res.status(200).json({ success: true, message: 'Signup successful!' });
  } catch (error) {
    console.error('Error inserting user:', error);
    res.status(500).json({ error: 'Signup failed. Please try again.' });
  }
});

// Forgot Password Handler
app.post('/forgot', async (req, res) => {
  const { email, dob, password, confirm_password } = req.body;

  if (!email || !dob || !password || !confirm_password) {
    return res.send(`<h2>All fields are required.</h2><a href="/forgot">Go Back</a>`);
  }

  if (password !== confirm_password) {
    return res.send(`<h2>Passwords do not match.</h2><a href="/forgot">Try Again</a>`);
  }

  try {
    const checkSql = 'SELECT * FROM users WHERE email = ? AND dob = ?';
    const users = await queryAsync(checkSql, [email, dob]);

    if (users.length === 0) {
      return res.send(`<h2>No matching user found.</h2><a href="/forgot">Try Again</a>`);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const updateSql = 'UPDATE users SET password = ? WHERE email = ? AND dob = ?';
    await queryAsync(updateSql, [hashedPassword, email, dob]);

    res.send(`
      <html>
        <head>
          <meta http-equiv="refresh" content="2;url=/login" />
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding-top: 50px; background-color: #f2f2f2; }
            h2 { color: #2e7d32; }
            p { color: #555; }
          </style>
        </head>
        <body>
          <h2>Password Reset Successful!</h2>
          <p>Redirecting to login page...</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Forgot password error:', error);
    res.send(`<h2>Internal Server Error</h2><a href="/forgot">Go Back</a>`);
  }
});

// Helper to check if user is admin
async function isAdmin(userId) {
  const result = await queryAsync('SELECT * FROM admins WHERE user_id = ?', [userId]);
  return result.length > 0;
}

// Admin dashboard route
app.get('/admin-dashboard', isAuthenticated, async (req, res) => {
  const isAdminUser = await isAdmin(req.session.user.id);
  if (!isAdminUser) {
    return res.status(403).send('Access denied.');
  }
  try {
    // Fetch leave stats
    const [pending, approved, rejected, total] = await Promise.all([
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications WHERE status = 'pending'`, []),
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications WHERE status = 'approved'`, []),
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications WHERE status = 'rejected'`, []),
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications`, [])
    ]);
    const stats = {
      pending: pending[0].count,
      approved: approved[0].count,
      rejected: rejected[0].count,
      total: total[0].count
    };
    res.render('admin-dashboard', { stats, notifications: [], allUsers: [] });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.render('admin-dashboard', { stats: {pending:0,approved:0,rejected:0,total:0}, notifications: [], allUsers: [], error: 'Something went wrong!' });
  }
});

// Admin: Get user leave stats (monthly and yearly)
app.get('/admin/user-stats/:userId', isAuthenticated, async (req, res) => {
  const isAdminUser = await isAdmin(req.session.user.id);
  if (!isAdminUser) {
    return res.status(403).send('Access denied.');
  }
  const userId = req.params.userId;
  try {
    // Get user info
    const user = (await queryAsync('SELECT name, email FROM users WHERE user_id = ?', [userId]))[0];
    // Monthly leave counts (approved only)
    const monthlySql = `
      SELECT MONTH(applied_at) AS month, COUNT(*) AS count
      FROM leave_applications
      WHERE user_id = ? AND YEAR(applied_at) = YEAR(CURDATE()) AND status = 'approved'
      GROUP BY MONTH(applied_at)
      ORDER BY month
    `;
    const monthlyResults = await queryAsync(monthlySql, [userId]);
    const monthlyLeaveCounts = Array(12).fill(0);
    monthlyResults.forEach(row => {
      monthlyLeaveCounts[row.month - 1] = row.count;
    });
    // Yearly leave count (approved only)
    const yearSql = `
      SELECT YEAR(applied_at) AS year, COUNT(*) AS count
      FROM leave_applications
      WHERE user_id = ? AND status = 'approved'
      GROUP BY YEAR(applied_at)
      ORDER BY year
    `;
    const yearlyResults = await queryAsync(yearSql, [userId]);
    res.json({
      user,
      monthlyLeaveCounts,
      yearlyResults
    });
  } catch (error) {
    res.status(500).json({ error: 'Could not fetch user stats.' });
  }
});

// Admin leave requests page
app.get('/admin/leave-requests', isAuthenticated, async (req, res) => {
  const isAdminUser = await isAdmin(req.session.user.id);
  if (!isAdminUser) {
    return res.status(403).send('Access denied.');
  }
  try {
    // Fetch all leave requests for the tabs
    const [pending, approved, rejected] = await Promise.all([
      queryAsync(`
        SELECT la.leave_application_id, u.user_id, u.name, lt.name AS leave_type, la.from_date, la.to_date, la.reason
        FROM leave_applications la
        JOIN users u ON la.user_id = u.user_id
        JOIN leave_types lt ON la.leave_type_id = lt.leave_type_id
        WHERE la.status = 'pending'
        ORDER BY la.applied_at DESC
      `, []),
      queryAsync(`
        SELECT la.leave_application_id, u.user_id, u.name, lt.name AS leave_type, la.from_date, la.to_date, la.reason
        FROM leave_applications la
        JOIN users u ON la.user_id = u.user_id
        JOIN leave_types lt ON la.leave_type_id = lt.leave_type_id
        WHERE la.status = 'approved'
        ORDER BY la.applied_at DESC
      `, []),
      queryAsync(`
        SELECT la.leave_application_id, u.user_id, u.name, lt.name AS leave_type, la.from_date, la.to_date, la.reason
        FROM leave_applications la
        JOIN users u ON la.user_id = u.user_id
        JOIN leave_types lt ON la.leave_type_id = lt.leave_type_id
        WHERE la.status = 'rejected'
        ORDER BY la.applied_at DESC
      `, [])
    ]);
    res.render('admin-leave-requests', { 
      pending, 
      approved, 
      rejected, 
      notifications: [],
      activeTab: 'pending' // Default to pending tab
    });
  } catch (error) {
    console.error('Admin leave requests error:', error);
    res.render('admin-leave-requests', { 
      pending: [], 
      approved: [], 
      rejected: [], 
      notifications: [], 
      activeTab: 'pending',
      error: 'Something went wrong!' 
    });
  }
});

// Pending leave requests
app.get('/admin/leave-requests/pending', isAuthenticated, async (req, res) => {
  const isAdminUser = await isAdmin(req.session.user.id);
  if (!isAdminUser) {
    return res.status(403).send('Access denied.');
  }
  try {
    const [pending, approved, rejected] = await Promise.all([
      queryAsync(`
        SELECT la.leave_application_id, u.user_id, u.name, lt.name AS leave_type, la.from_date, la.to_date, la.reason
        FROM leave_applications la
        JOIN users u ON la.user_id = u.user_id
        JOIN leave_types lt ON la.leave_type_id = lt.leave_type_id
        WHERE la.status = 'pending'
        ORDER BY la.applied_at DESC
      `, []),
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications WHERE status = 'approved'`, []),
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications WHERE status = 'rejected'`, [])
    ]);
    res.render('admin-leave-requests', { 
      pending, 
      approved: [], 
      rejected: [], 
      notifications: [],
      activeTab: 'pending'
    });
  } catch (error) {
    console.error('Pending requests error:', error);
    res.render('admin-leave-requests', { 
      pending: [], 
      approved: [], 
      rejected: [], 
      notifications: [], 
      activeTab: 'pending',
      error: 'Something went wrong!' 
    });
  }
});

// Approved leave requests
app.get('/admin/leave-requests/approved', isAuthenticated, async (req, res) => {
  const isAdminUser = await isAdmin(req.session.user.id);
  if (!isAdminUser) {
    return res.status(403).send('Access denied.');
  }
  try {
    const [approved, pending, rejected] = await Promise.all([
      queryAsync(`
        SELECT la.leave_application_id, u.user_id, u.name, lt.name AS leave_type, la.from_date, la.to_date, la.reason
        FROM leave_applications la
        JOIN users u ON la.user_id = u.user_id
        JOIN leave_types lt ON la.leave_type_id = lt.leave_type_id
        WHERE la.status = 'approved'
        ORDER BY la.applied_at DESC
      `, []),
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications WHERE status = 'pending'`, []),
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications WHERE status = 'rejected'`, [])
    ]);
    res.render('admin-leave-requests', { 
      pending: [], 
      approved, 
      rejected: [], 
      notifications: [],
      activeTab: 'approved'
    });
  } catch (error) {
    console.error('Approved requests error:', error);
    res.render('admin-leave-requests', { 
      pending: [], 
      approved: [], 
      rejected: [], 
      notifications: [], 
      activeTab: 'approved',
      error: 'Something went wrong!' 
    });
  }
});

// Rejected leave requests
app.get('/admin/leave-requests/rejected', isAuthenticated, async (req, res) => {
  const isAdminUser = await isAdmin(req.session.user.id);
  if (!isAdminUser) {
    return res.status(403).send('Access denied.');
  }
  try {
    const [rejected, pending, approved] = await Promise.all([
      queryAsync(`
        SELECT la.leave_application_id, u.user_id, u.name, lt.name AS leave_type, la.from_date, la.to_date, la.reason
        FROM leave_applications la
        JOIN users u ON la.user_id = u.user_id
        JOIN leave_types lt ON la.leave_type_id = lt.leave_type_id
        WHERE la.status = 'rejected'
        ORDER BY la.applied_at DESC
      `, []),
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications WHERE status = 'pending'`, []),
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications WHERE status = 'approved'`, [])
    ]);
    res.render('admin-leave-requests', { 
      pending: [], 
      approved: [], 
      rejected, 
      notifications: [],
      activeTab: 'rejected'
    });
  } catch (error) {
    console.error('Rejected requests error:', error);
    res.render('admin-leave-requests', { 
      pending: [], 
      approved: [], 
      rejected: [], 
      notifications: [], 
      activeTab: 'rejected',
      error: 'Something went wrong!' 
    });
  }
});

// Approve leave request
app.post('/admin/leave/approve/:leaveId', isAuthenticated, async (req, res) => {
  const isAdminUser = await isAdmin(req.session.user.id);
  if (!isAdminUser) {
    return res.status(403).send('Access denied.');
  }
  try {
    const leaveId = req.params.leaveId;
    // Get the leave application
    const leave = (await queryAsync('SELECT * FROM leave_applications WHERE leave_application_id = ?', [leaveId]))[0];
    if (!leave) return res.status(404).send('Leave application not found');
    if (leave.status !== 'pending') return res.status(400).send('Leave already processed');
    // Calculate days
    const days = Math.floor((new Date(leave.to_date) - new Date(leave.from_date)) / (1000*60*60*24)) + 1;
    // Approve the leave
    await queryAsync('UPDATE leave_applications SET status = ? WHERE leave_application_id = ?', ['approved', leaveId]);
    // The trigger will update user_leave_balances
    // Optionally, refresh the employee's session if they are logged in (if you have a session store)
    res.redirect('/admin/leave-requests/pending');
  } catch (error) {
    console.error('Approve leave error:', error);
    res.status(500).send('Something went wrong!');
  }
});

// Reject leave request
app.post('/admin/leave/reject/:leaveId', isAuthenticated, async (req, res) => {
  const isAdminUser = await isAdmin(req.session.user.id);
  if (!isAdminUser) {
    return res.status(403).send('Access denied.');
  }
  try {
    const leaveId = req.params.leaveId;
    // Get the leave application
    const leave = (await queryAsync('SELECT * FROM leave_applications WHERE leave_application_id = ?', [leaveId]))[0];
    if (!leave) return res.status(404).send('Leave application not found');
    if (leave.status !== 'pending') return res.status(400).send('Leave already processed');
    // Reject the leave
    await queryAsync('UPDATE leave_applications SET status = ? WHERE leave_application_id = ?', ['rejected', leaveId]);
    res.redirect('/admin/leave-requests/pending');
  } catch (error) {
    console.error('Reject leave error:', error);
    res.status(500).send('Something went wrong!');
  }
});

// Admin profile route
app.get('/admin-profile', isAuthenticated, async (req, res) => {
  const isAdminUser = await isAdmin(req.session.user.id);
  if (!isAdminUser) {
    return res.status(403).send('Access denied.');
  }
  // Fetch stats for profile
  try {
    const [pending, approved, rejected, total] = await Promise.all([
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications WHERE status = 'pending'`, []),
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications WHERE status = 'approved'`, []),
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications WHERE status = 'rejected'`, []),
      queryAsync(`SELECT COUNT(*) as count FROM leave_applications`, [])
    ]);
    const stats = {
      pending: pending[0].count,
      approved: approved[0].count,
      rejected: rejected[0].count,
      total: total[0].count
    };
    res.render('admin-profile', { user: req.session.user, stats });
  } catch (error) {
    res.render('admin-profile', { user: req.session.user, stats: {pending:0,approved:0,rejected:0,total:0}, error: 'Could not load stats.' });
  }
});

// Admin password change (optional, for completeness)
app.post('/admin-profile/change-password', isAuthenticated, async (req, res) => {
  const isAdminUser = await isAdmin(req.session.user.id);
  if (!isAdminUser) {
    return res.status(403).send('Access denied.');
  }
  const { oldPassword, newPassword, confirmPassword } = req.body;
  if (!oldPassword || !newPassword || !confirmPassword) {
    return res.redirect('/admin-profile?error=' + encodeURIComponent('All fields are required.'));
  }
  if (newPassword.length < 6) {
    return res.redirect('/admin-profile?error=' + encodeURIComponent('New password must be at least 6 characters.'));
  }
  if (newPassword !== confirmPassword) {
    return res.redirect('/admin-profile?error=' + encodeURIComponent('New passwords do not match.'));
  }
  try {
    const sql = 'SELECT password FROM users WHERE email = ?';
    const results = await queryAsync(sql, [req.session.user.email]);
    if (results.length === 0) {
      return res.redirect('/admin-profile?error=' + encodeURIComponent('User not found.'));
    }
    const passwordMatch = await bcrypt.compare(oldPassword, results[0].password);
    if (!passwordMatch) {
      return res.redirect('/admin-profile?error=' + encodeURIComponent('Old password is incorrect.'));
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    await queryAsync('UPDATE users SET password = ? WHERE email = ?', [hashed, req.session.user.email]);
    return res.redirect('/admin-profile?success=' + encodeURIComponent('Password updated successfully!'));
  } catch (error) {
    console.error('Admin password change error:', error);
    return res.redirect('/admin-profile?error=' + encodeURIComponent('Something went wrong!'));
  }
});

// Login Handler
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.redirect('/login?error=' + encodeURIComponent('Please enter email and password'));
  }

  try {
    const sql = 'SELECT * FROM users WHERE email = ?';
    const results = await queryAsync(sql, [email]);

    if (results.length === 0) {
      return res.redirect('/login?error=' + encodeURIComponent('User not found'));
    }

    const user = results[0];
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.redirect('/login?error=' + encodeURIComponent('Incorrect password'));
    }

    // Set user session
    req.session.user = {
      id: user.user_id,
      name: user.name,
      email: user.email
    };
    
    // Redirect only admin@leaveease.com to admin dashboard
    if (user.email === 'admin@leaveease.com') {
      console.log('Admin logged in:', req.session.user);
      return res.redirect('/admin-dashboard');
    } else {
      console.log('User logged in:', req.session.user);
      return res.redirect('/dashboard');
    }
  } catch (error) {
    console.error('Login error:', error);
    return res.redirect('/login?error=' + encodeURIComponent('Login failed. Try again'));
  }
});

// MySQL connection test route
app.get('/db-test', (req, res) => {
  db.query('SELECT 1 + 1 AS solution', (err, results) => {
    if (err) {
      return res.status(500).send('Database connection failed: ' + err.message);
    }
    res.send('Database connected! Test result: ' + results[0].solution);
  });
});

// Debug route to check all users in the users table
app.get('/db-users', (req, res) => {
  db.query('SELECT * FROM users', (err, results) => {
    if (err) {
      return res.status(500).send('Error fetching users: ' + err.message);
    }
    res.json(results);
  });
});

// Password reset route
app.post('/profile/reset-password', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { oldPassword, newPassword, confirmPassword } = req.body;
    if (!oldPassword || !newPassword || !confirmPassword) {
      return renderProfileWithMessage(res, userId, { error: 'All fields are required.' });
    }
    if (newPassword.length < 6) {
      return renderProfileWithMessage(res, userId, { error: 'New password must be at least 6 characters.' });
    }
    if (newPassword !== confirmPassword) {
      return renderProfileWithMessage(res, userId, { error: 'New passwords do not match.' });
    }
    // Get current password hash
    const sql = 'SELECT password, name, email, dob FROM users WHERE user_id = ?';
    const results = await queryAsync(sql, [userId]);
    if (results.length === 0) {
      return renderProfileWithMessage(res, userId, { error: 'User not found.' });
    }
    const user = results[0];
    const passwordMatch = await bcrypt.compare(oldPassword, user.password);
    if (!passwordMatch) {
      return renderProfileWithMessage(res, userId, { error: 'Old password is incorrect.' });
    }
    // Hash and update new password
    const hashed = await bcrypt.hash(newPassword, 10);
    await queryAsync('UPDATE users SET password = ? WHERE user_id = ?', [hashed, userId]);
    return renderProfileWithMessage(res, userId, { success: 'Password updated successfully!' });
  } catch (error) {
    console.error('Password reset error:', error);
    return res.status(500).send('Something went wrong!');
  }
});

// Edit profile (name and email)
app.post('/profile/edit', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { name, email } = req.body;
    if (!name || !email) {
      return renderProfileWithMessage(res, userId, { error: 'Name and email are required.' });
    }
    // Check if email is already used by another user
    const checkSql = 'SELECT user_id FROM users WHERE email = ? AND user_id != ?';
    const existing = await queryAsync(checkSql, [email, userId]);
    if (existing.length > 0) {
      return renderProfileWithMessage(res, userId, { error: 'Email is already in use by another account.' });
    }
    await queryAsync('UPDATE users SET name = ?, email = ? WHERE user_id = ?', [name, email, userId]);
    // Update session
    req.session.user.name = name;
    req.session.user.email = email;
    return renderProfileWithMessage(res, userId, { success: 'Profile updated successfully!' });
  } catch (error) {
    console.error('Profile update error:', error);
    return res.status(500).send('Something went wrong!');
  }
});

// Helper to render profile with messages
async function renderProfileWithMessage(res, userId, msg) {
  try {
    const sql = 'SELECT name, email, dob FROM users WHERE user_id = ?';
    const results = await queryAsync(sql, [userId]);
    if (results.length === 0) {
      return res.status(404).send('User not found');
    }
    res.render('employee-profile', { user: results[0], ...msg });
  } catch (error) {
    res.status(500).send('Something went wrong!');
  }
}

// Test EJS rendering route
app.get('/test-ejs', (req, res) => {
  res.render('employee-profile', { user: { name: 'Test User', email: 'test@example.com', dob: '2000-01-01' } });
});

// Leave Apply GET
app.get('/leave-apply', isAuthenticated, async (req, res) => {
  try {
    const leaveTypes = await queryAsync('SELECT leave_type_id, name FROM leave_types', []);
    res.render('leave-apply', { leaveTypes });
  } catch (error) {
    console.error('Leave Apply GET error:', error);
    res.status(500).send('Something went wrong!');
  }
});

// Leave Apply POST
app.post('/leave-apply', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { leaveType, fromDate, toDate, reason } = req.body;
    if (!leaveType || !fromDate || !toDate || !reason) {
      const leaveTypes = await queryAsync('SELECT leave_type_id, name FROM leave_types', []);
      return res.render('leave-apply', { leaveTypes, error: 'All fields are required.' });
    }
    if (new Date(fromDate) > new Date(toDate)) {
      const leaveTypes = await queryAsync('SELECT leave_type_id, name FROM leave_types', []);
      return res.render('leave-apply', { leaveTypes, error: 'From Date cannot be after To Date.' });
    }
    await queryAsync(
      'INSERT INTO leave_applications (user_id, leave_type_id, from_date, to_date, reason) VALUES (?, ?, ?, ?, ?)',
      [userId, leaveType, fromDate, toDate, reason]
    );
    const leaveTypes = await queryAsync('SELECT leave_type_id, name FROM leave_types', []);
    res.render('leave-apply', { leaveTypes, success: 'Leave request submitted successfully!' });
  } catch (error) {
    console.error('Leave Apply POST error:', error);
    const leaveTypes = await queryAsync('SELECT leave_type_id, name FROM leave_types', []);
    res.render('leave-apply', { leaveTypes, error: 'Something went wrong!' });
  }
});

// Admin view logs page
app.get('/admin/logs', isAuthenticated, async (req, res) => {
  const isAdminUser = await isAdmin(req.session.user.id);
  if (!isAdminUser) {
    return res.status(403).send('Access denied.');
  }
  try {
    const logs = await queryAsync(
      'SELECT l.*, u.name FROM logs l LEFT JOIN users u ON l.user_id = u.user_id ORDER BY l.timestamp DESC LIMIT 100',
      []
    );
    res.render('admin-logs', { logs });
  } catch (error) {
    console.error('Logs fetch error:', error);
    res.render('admin-logs', { logs: [], error: 'Could not load logs.' });
  }
});

// Edit leave request
app.get('/leave-edit/:id', isAuthenticated, async (req, res) => {
  try {
    const leaveId = req.params.id;
    const userId = req.session.user.id;
    
    // Get leave request details
    const leaveSql = `
      SELECT la.*, lt.name as leave_type_name
      FROM leave_applications la
      JOIN leave_types lt ON la.leave_type_id = lt.leave_type_id
      WHERE la.leave_application_id = ? AND la.user_id = ? AND la.status = 'pending'
    `;
    const leaveResult = await queryAsync(leaveSql, [leaveId, userId]);
    
    if (leaveResult.length === 0) {
      return res.status(404).render('error', { 
        message: 'Leave request not found or not editable',
        error: { status: 404 }
      });
    }
    
    const leaveTypes = await queryAsync('SELECT leave_type_id, name FROM leave_types', []);
    res.render('leave-edit', { 
      leave: leaveResult[0],
      leaveTypes,
      error: null,
      success: null
    });
  } catch (error) {
    console.error('Edit leave error:', error);
    res.status(500).render('error', { 
      message: 'Something went wrong while fetching leave request',
      error: { status: 500 }
    });
  }
});

// Update leave request
app.post('/leave-edit/:id', isAuthenticated, async (req, res) => {
  try {
    const leaveId = req.params.id;
    const userId = req.session.user.id;
    const { leaveType, fromDate, toDate, reason } = req.body;
    
    if (!leaveType || !fromDate || !toDate || !reason) {
      const leaveTypes = await queryAsync('SELECT leave_type_id, name FROM leave_types', []);
      return res.render('leave-edit', { 
        leave: { leave_application_id: leaveId, leave_type_id: leaveType, from_date: fromDate, to_date: toDate, reason },
        leaveTypes,
        error: 'All fields are required.',
        success: null
      });
    }

    if (new Date(fromDate) > new Date(toDate)) {
      const leaveTypes = await queryAsync('SELECT leave_type_id, name FROM leave_types', []);
      return res.render('leave-edit', { 
        leave: { leave_application_id: leaveId, leave_type_id: leaveType, from_date: fromDate, to_date: toDate, reason },
        leaveTypes,
        error: 'From Date cannot be after To Date.',
        success: null
      });
    }
    
    // Verify the leave request belongs to the user and is pending
    const verifySql = 'SELECT * FROM leave_applications WHERE leave_application_id = ? AND user_id = ? AND status = "pending"';
    const verifyResult = await queryAsync(verifySql, [leaveId, userId]);
    
    if (verifyResult.length === 0) {
      return res.status(404).render('error', { 
        message: 'Leave request not found or not editable',
        error: { status: 404 }
      });
    }
    
    // Update the leave request
    await queryAsync(
      'UPDATE leave_applications SET leave_type_id = ?, from_date = ?, to_date = ?, reason = ? WHERE leave_application_id = ?',
      [leaveType, fromDate, toDate, reason, leaveId]
    );
    
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Update leave error:', error);
    res.status(500).render('error', { 
      message: 'Something went wrong while updating leave request',
      error: { status: 500 }
    });
  }
});

// Delete leave request
app.delete('/leave-delete/:id', isAuthenticated, async (req, res) => {
  try {
    const leaveId = req.params.id;
    const userId = req.session.user.id;
    
    // Verify the leave request belongs to the user and is pending
    const verifySql = 'SELECT * FROM leave_applications WHERE leave_application_id = ? AND user_id = ? AND status = "pending"';
    const verifyResult = await queryAsync(verifySql, [leaveId, userId]);
    
    if (verifyResult.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Leave request not found or not deletable' 
      });
    }
    
    // Delete the leave request
    await queryAsync('DELETE FROM leave_applications WHERE leave_application_id = ?', [leaveId]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete leave error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Something went wrong while deleting the leave request' 
    });
  }
});

// 404 Handler
app.use((req, res) => res.status(404).send('Page not found'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something went wrong!');
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
