const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { getMyDashboardOverview, getMyRecentAnswers } = require("../controllers/userDashboardController");

const router = express.Router();

router.get("/me/overview", protect, getMyDashboardOverview);
router.get("/me/recent-answers", protect, getMyRecentAnswers);

module.exports = router;
