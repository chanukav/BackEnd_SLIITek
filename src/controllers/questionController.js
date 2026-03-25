const Question = require("../models/Question");
const Answer = require("../models/Answer");
const Comment = require("../models/Comment");
const mongoose = require("mongoose");

const QUESTION_CATEGORIES = [
  "Academic",
  "Career & Internships",
  "Campus Life",
  "Technical / Programming Help",
  "Study Resources",
  "Clubs & Events",
  "General / Other",
];

const QUESTION_VALIDATION = {
  title: { min: 5, max: 150 },
  body: { min: 10, max: 5000 },
};

const normalizeOptionalString = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const validateLength = (label, value, { min, max }) => {
  if (value.length < min) return `${label} must be at least ${min} characters`;
  if (value.length > max) return `${label} must be at most ${max} characters`;
  return null;
};

const createQuestion = async (req, res) => {
  try {
    const title = normalizeOptionalString(req.body?.title);
    const body = normalizeOptionalString(req.body?.body);
    const category = normalizeOptionalString(req.body?.category);

    if (!title || !body) {
      return res.status(400).json({ message: "Title and body are required" });
    }

    const titleLengthError = validateLength(
      "Title",
      title,
      QUESTION_VALIDATION.title
    );
    if (titleLengthError) {
      return res.status(400).json({ message: titleLengthError });
    }

    const bodyLengthError = validateLength(
      "Body",
      body,
      QUESTION_VALIDATION.body
    );
    if (bodyLengthError) {
      return res.status(400).json({ message: bodyLengthError });
    }

    const nextCategory = category ?? "General / Other";

    if (!QUESTION_CATEGORIES.includes(nextCategory)) {
      return res.status(400).json({ message: "Invalid category" });
    }

    const question = await Question.create({
      title,
      body,
      category: nextCategory,
      authorId: req.user._id,
    });

    return res.status(201).json({
      message: "Question created successfully",
      question,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getQuestions = async (req, res) => {
  try {
    const questions = await Question.find()
      .populate("authorId", "firstName lastName email role")
      .populate("bestAnswerId")
      .sort({ createdAt: -1 });

    return res.json(questions);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getQuestionById = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid question id" });
    }

    const question = await Question.findById(req.params.id)
      .populate("authorId", "firstName lastName email role")
      .populate("bestAnswerId");

    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }

    return res.json(question);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const updateQuestion = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid question id" });
    }

    const title = normalizeOptionalString(req.body?.title);
    const body = normalizeOptionalString(req.body?.body);
    const category = normalizeOptionalString(req.body?.category);

    const hasTitle = Boolean(title);
    const hasBody = Boolean(body);
    const hasCategory = Boolean(category);

    if (!hasTitle && !hasBody && !hasCategory) {
      return res.status(400).json({ message: "Title, body, or category is required" });
    }

    const question = await Question.findById(req.params.id);

    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }

    if (question.authorId.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ message: "Only question owner can edit this question" });
    }

    if (hasTitle) {
      const titleLengthError = validateLength(
        "Title",
        title,
        QUESTION_VALIDATION.title
      );
      if (titleLengthError) {
        return res.status(400).json({ message: titleLengthError });
      }
      question.title = title;
    }

    if (hasBody) {
      const bodyLengthError = validateLength(
        "Body",
        body,
        QUESTION_VALIDATION.body
      );
      if (bodyLengthError) {
        return res.status(400).json({ message: bodyLengthError });
      }
      question.body = body;
    }

    if (hasCategory) {
      const nextCategory = category;
      if (!QUESTION_CATEGORIES.includes(nextCategory)) {
        return res.status(400).json({ message: "Invalid category" });
      }
      question.category = nextCategory;
    }

    await question.save();

    const populated = await Question.findById(question._id)
      .populate("authorId", "firstName lastName email role")
      .populate("bestAnswerId");

    return res.json({
      message: "Question updated successfully",
      question: populated,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const deleteQuestion = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid question id" });
    }

    const question = await Question.findById(req.params.id);

    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }

    if (question.authorId.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ message: "Only question owner can delete this question" });
    }

    const answers = await Answer.find({ questionId: question._id }).select("_id");
    const answerIds = answers.map((a) => a._id);

    if (answerIds.length) {
      await Comment.deleteMany({ targetType: "answer", targetId: { $in: answerIds } });
    }
    await Comment.deleteMany({ targetType: "question", targetId: question._id });
    await Answer.deleteMany({ questionId: question._id });
    await question.deleteOne();

    return res.json({ message: "Question deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getQuestionSuggestions = async (req, res) => {
  try {
    const rawTitle = typeof req.query.title === "string" ? req.query.title : "";
    const title = rawTitle.trim();

    if (title.length > QUESTION_VALIDATION.title.max) {
      return res.json([]);
    }

    if (title.length < 3) {
      return res.json([]);
    }

    const tokens = title
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2)
      .slice(0, 6);

    if (!tokens.length) {
      return res.json([]);
    }

    // Match titles that contain all tokens (any order).
    const pattern = `${tokens.map((t) => `(?=.*${escapeRegExp(t)})`).join("")}.*`;
    const titleRegex = new RegExp(pattern, "i");

    const suggestions = await Question.find({ title: { $regex: titleRegex } })
      .select("title category status authorId createdAt")
      .populate("authorId", "firstName lastName")
      .sort({ createdAt: -1 })
      .limit(5);

    return res.json(suggestions);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createQuestion,
  getQuestions,
  getQuestionById,
  getQuestionSuggestions,
  updateQuestion,
  deleteQuestion,
};
