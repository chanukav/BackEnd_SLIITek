const express = require('express');
const {
    createReport,
    getReports,
    reviewReport,
    getQueueSummary,
    getTargetModerationState,
    getUserModerationState
} = require('../controllers/report.controller');

const router = express.Router();

// Allow users to submit a report & allow moderators to view all reports
router.route('/')
    .get(getReports)
    .post(createReport);

// Moderator queue summary (counts + top reported targets)
router.route('/queue/summary')
    .get(getQueueSummary);

// Allow moderators to review a report directly
router.route('/:id/review')
    .put(reviewReport);

// Query moderation state for target content
router.route('/targets/:targetType/:targetId/state')
    .get(getTargetModerationState);

// Query moderation state for user sanctions
router.route('/users/:userId/state')
    .get(getUserModerationState);

module.exports = router;
