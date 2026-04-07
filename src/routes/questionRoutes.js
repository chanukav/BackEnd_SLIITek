const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { uploadQuestionImages } = require("../middleware/uploadMiddleware");
const {
  createQuestion,
  getQuestions,
  getQuestionById,
  searchQuestions,
  getQuestionSuggestions,
  updateQuestion,
  deleteQuestion,
  addQuestionImages,
  removeQuestionImage,
  voteQuestion,
  unvoteQuestion,
} = require("../controllers/questionController");

router.get("/", getQuestions);
router.get("/search", searchQuestions);
router.get("/suggestions", getQuestionSuggestions);
router.get("/:id", getQuestionById);
router.post("/", protect, createQuestion);
router.post("/:id/vote", protect, voteQuestion);
router.delete("/:id/vote", protect, unvoteQuestion);
router.post(
  "/:id/images",
  protect,
  uploadQuestionImages.array("images", 8),
  addQuestionImages
);
router.delete("/:id/images", protect, removeQuestionImage);
router.put("/:id", protect, updateQuestion);
router.delete("/:id", protect, deleteQuestion);

module.exports = router;
