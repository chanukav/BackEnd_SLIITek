const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  createQuestion,
  getQuestions,
  getQuestionById,
} = require("../controllers/questionController");

router.get("/", getQuestions);
router.get("/:id", getQuestionById);
router.post("/", protect, createQuestion);

module.exports = router;
