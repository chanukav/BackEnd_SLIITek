const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  postAnswer,
  editAnswer,
  deleteAnswer,
  markBestAnswer,
  getAnswersByQuestion,
  getMyAnswers,
  voteAnswer,
  unvoteAnswer,
  addCommentToAnswer,
} = require("../controllers/answerController");

router.get("/me", protect, getMyAnswers);
router.get("/question/:questionId", getAnswersByQuestion);
router.post("/:questionId", protect, postAnswer);
router.put("/:answerId", protect, editAnswer);
router.delete("/:answerId", protect, deleteAnswer);
router.patch("/:answerId/best", protect, markBestAnswer);
router.post("/:answerId/comments", protect, addCommentToAnswer);
router.post("/:answerId/vote", protect, voteAnswer);
router.delete("/:answerId/vote", protect, unvoteAnswer);

module.exports = router;
