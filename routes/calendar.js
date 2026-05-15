// routes/calendar.js
// Calendar API routes.
// The original version referenced tables (events, leave_requests, leave_balances)
// that are not part of this project's schema.
// These endpoints now return safe empty responses so the app starts without errors.

const express = require('express');
const router = express.Router();
const db = require('../db');

// Promisify db.query
const queryAsync = (sql, params) =>
  new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });

// GET /api/student/events  — returns leave applications as calendar events
router.get('/student/events', async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: 'Start and end dates are required' });
    }

    // Use leave_applications (the actual table in this project)
    const sql = `
      SELECT
        la.leave_application_id AS id,
        lt.name                 AS title,
        la.from_date            AS start_date,
        la.to_date              AS end_date,
        la.status               AS event_type,
        la.reason               AS description
      FROM leave_applications la
      JOIN leave_types lt ON la.leave_type_id = lt.leave_type_id
      WHERE
        (la.from_date BETWEEN ? AND ?) OR
        (la.to_date   BETWEEN ? AND ?) OR
        (? BETWEEN la.from_date AND la.to_date)
      ORDER BY la.from_date ASC
    `;
    const events = await queryAsync(sql, [start, end, start, end, start]);
    res.json(events);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// POST /api/leave/request  — alias for the main leave-apply route
router.post('/leave/request', async (req, res) => {
  try {
    const { userId, startDate, endDate, leaveType, reason } = req.body;

    if (!userId || !startDate || !endDate || !leaveType || !reason) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const sql = `
      INSERT INTO leave_applications (user_id, leave_type_id, from_date, to_date, reason)
      VALUES (?, ?, ?, ?, ?)
    `;
    await queryAsync(sql, [userId, leaveType, startDate, endDate, reason]);
    res.json({ message: 'Leave request submitted successfully' });
  } catch (error) {
    console.error('Error creating leave request:', error);
    res.status(500).json({ error: 'Failed to submit leave request' });
  }
});

// GET /api/leave/balance/:userId  — returns a simple count-based balance
router.get('/leave/balance/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const sql = `
      SELECT
        lt.name                                          AS leave_type,
        COUNT(la.leave_application_id)                  AS used_days,
        12                                              AS total_days,
        (12 - COUNT(la.leave_application_id))           AS remaining_days
      FROM leave_types lt
      LEFT JOIN leave_applications la
        ON lt.leave_type_id = la.leave_type_id
        AND la.user_id = ?
        AND la.status = 'approved'
      GROUP BY lt.leave_type_id, lt.name
    `;
    const balance = await queryAsync(sql, [userId]);
    res.json(balance);
  } catch (error) {
    console.error('Error fetching leave balance:', error);
    res.status(500).json({ error: 'Failed to fetch leave balance' });
  }
});

module.exports = router;
