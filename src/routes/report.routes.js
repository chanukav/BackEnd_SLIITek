const express = require('express');
const {
    createReport,
    getReports,
    reviewReport
} = require('../controllers/report.controller');

const router = express.Router();

// Allow users to submit a report & allow moderators to view all reports
router.route('/')
    .get(getReports)
    .post(createReport);

// Allow moderators to review a report directly
router.route('/:id/review')
    .put(reviewReport);

module.exports = router;
