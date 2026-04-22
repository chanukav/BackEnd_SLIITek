const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { uploadQuestionImages } = require("../middleware/uploadMiddleware");
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
  addAnswerImages,
  removeAnswerImage,
} = require("../controllers/answerController");

const postAnswerIfMultipart = (req, res, next) => {
  const ct = String(req.headers["content-type"] || "").toLowerCase();
  if (ct.includes("multipart/form-data")) {
    return uploadQuestionImages.array("images", 4)(req, res, next);
  }
  next();
};

router.get("/me", protect, getMyAnswers);
router.get("/question/:questionId", getAnswersByQuestion);
router.post("/:questionId", protect, postAnswerIfMultipart, postAnswer);
router.post(
  "/:answerId/images",
  protect,
  uploadQuestionImages.array("images", 4),
  addAnswerImages
);
router.delete("/:answerId/images", protect, removeAnswerImage);
router.put("/:answerId", protect, editAnswer);
router.delete("/:answerId", protect, deleteAnswer);
router.patch("/:answerId/best", protect, markBestAnswer);
router.post("/:answerId/comments", protect, addCommentToAnswer);
router.post("/:answerId/vote", protect, voteAnswer);
router.delete("/:answerId/vote", protect, unvoteAnswer);

module.exports = router;
