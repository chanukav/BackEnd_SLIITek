const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, authorize } = require('../middleware/authMiddleware');
const {
    createReport,
    getReports,
    reviewReport,
    getQueueSummary,
    getTargetModerationState,
    getUserModerationState
} = require('../controllers/report.controller');

const router = express.Router();

const reportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20 // 20 reports per 15 min
});

// Protect all routes
router.use(protect);

// Allow logged-in users to submit a report & allow moderators to view all reports
router.route('/')
    .get(authorize("admin", "moderator"), getReports)
    .post(reportLimiter, createReport);

// Moderator queue summary (counts + top reported targets)
router.route('/queue/summary')
    .get(authorize("admin", "moderator"), getQueueSummary);

// Allow moderators to review a report directly
router.route('/:id/review')
    .put(authorize("admin", "moderator"), reviewReport);

// Query moderation state for target content
router.route('/targets/:targetType/:targetId/state')
    .get(getTargetModerationState);

// Query moderation state for user sanctions
router.route('/users/:userId/state')
    .get(getUserModerationState);

module.exports = router;
