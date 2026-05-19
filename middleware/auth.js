// middleware/auth.js
// ─────────────────────────────────────────────────────────────
// Role-based access control middleware.
// Usage in routes:
//   const { requireAuth, requireAdmin, requireEmployee } = require('./middleware/auth');
// ─────────────────────────────────────────────────────────────

// Any logged-in user
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/login');
}

// Admin only — checks role stored in session
function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  // Logged in but wrong role → 403, not redirect to login
  if (req.session && req.session.user) {
    return res.status(403).render('error', {
      message: 'Access denied. Admin privileges required.',
      error: { status: 403 }
    });
  }
  res.redirect('/login');
}

// Employee only
function requireEmployee(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'employee') {
    return next();
  }
  if (req.session && req.session.user) {
    return res.status(403).render('error', {
      message: 'Access denied.',
      error: { status: 403 }
    });
  }
  res.redirect('/login');
}

module.exports = { requireAuth, requireAdmin, requireEmployee };
