const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  createQuestion,
  getQuestions,
  getQuestionById,
  searchQuestions,
  getQuestionSuggestions,
  updateQuestion,
  deleteQuestion,
} = require("../controllers/questionController");

router.get("/", getQuestions);
router.get("/search", searchQuestions);
router.get("/suggestions", getQuestionSuggestions);
router.get("/:id", getQuestionById);
router.post("/", protect, createQuestion);
router.put("/:id", protect, updateQuestion);
router.delete("/:id", protect, deleteQuestion);

module.exports = router;
