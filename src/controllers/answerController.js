const Answer = require("../models/Answer");
const Question = require("../models/Question");
const Comment = require("../models/Comment");

const postAnswer = async (req, res) => {
  try {
    const { questionId } = req.params;
    const { body } = req.body;

    if (!body || !body.trim()) {
      return res.status(400).json({ message: "Answer body is required" });
    }

    const question = await Question.findById(questionId);
    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }

    if (question.status === "locked") {
      return res.status(403).json({ message: "Question is locked" });
    }

    const answer = await Answer.create({
      questionId,
      authorId: req.user._id,
      body,
    });

    return res.status(201).json({
      message: "Answer posted successfully",
      answer,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const editAnswer = async (req, res) => {
  try {
    const { answerId } = req.params;
    const { body } = req.body;

    if (!body || !body.trim()) {
      return res.status(400).json({ message: "Answer body is required" });
    }

    const answer = await Answer.findById(answerId);
    if (!answer) {
      return res.status(404).json({ message: "Answer not found" });
    }

    if (answer.authorId.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ message: "Only answer owner can edit this answer" });
    }

    answer.body = body;
    await answer.save();

    return res.json({
      message: "Answer updated successfully",
      answer,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const deleteAnswer = async (req, res) => {
  try {
    const { answerId } = req.params;

    const answer = await Answer.findById(answerId);
    if (!answer) {
      return res.status(404).json({ message: "Answer not found" });
    }

    const isOwner = answer.authorId.toString() === req.user._id.toString();
    const isModerator = ["moderator", "admin"].includes(req.user.role);

    if (!isOwner && !isModerator) {
      return res.status(403).json({ message: "Not allowed to delete this answer" });
    }

    const question = await Question.findById(answer.questionId);
    if (
      question &&
      question.bestAnswerId &&
      question.bestAnswerId.toString() === answer._id.toString()
    ) {
      question.bestAnswerId = null;
      question.status = "open";
      await question.save();
    }

    await Comment.deleteMany({ targetType: "answer", targetId: answer._id });
    await answer.deleteOne();

    return res.json({ message: "Answer deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const markBestAnswer = async (req, res) => {
  try {
    const { answerId } = req.params;

    const answer = await Answer.findById(answerId);
    if (!answer) {
      return res.status(404).json({ message: "Answer not found" });
    }

    const question = await Question.findById(answer.questionId);
    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }

    const isQuestionOwner = question.authorId.toString() === req.user._id.toString();
    const isModerator = ["moderator", "admin"].includes(req.user.role);

    if (!isQuestionOwner && !isModerator) {
      return res.status(403).json({
        message: "Only question owner or moderator can mark best answer",
      });
    }

    await Answer.updateMany(
      { questionId: question._id },
      { $set: { isBest: false } }
    );

    answer.isBest = true;
    await answer.save();

    question.bestAnswerId = answer._id;
    question.status = "solved";
    await question.save();

    return res.json({
      message: "Best answer marked successfully",
      answer,
      question,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getAnswersByQuestion = async (req, res) => {
  try {
    const { questionId } = req.params;

    const answers = await Answer.find({ questionId })
      .populate("authorId", "firstName lastName faculty academicYear role")
      .sort({ isBest: -1, voteScore: -1, createdAt: -1 });

    return res.json(answers);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const addCommentToAnswer = async (req, res) => {
  try {
    const { answerId } = req.params;
    const { body, parentCommentId = null } = req.body;

    if (!body || !body.trim()) {
      return res.status(400).json({ message: "Comment body is required" });
    }

    const answer = await Answer.findById(answerId);
    if (!answer) {
      return res.status(404).json({ message: "Answer not found" });
    }

    const comment = await Comment.create({
      targetType: "answer",
      targetId: answerId,
      authorId: req.user._id,
      body,
      parentCommentId,
    });

    return res.status(201).json({
      message: "Comment added to answer",
      comment,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  postAnswer,
  editAnswer,
  deleteAnswer,
  markBestAnswer,
  getAnswersByQuestion,
  addCommentToAnswer,
};
