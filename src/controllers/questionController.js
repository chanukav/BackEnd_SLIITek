const Question = require("../models/Question");
const Answer = require("../models/Answer");
const Comment = require("../models/Comment");

const QUESTION_CATEGORIES = [
  "Academic",
  "Career & Internships",
  "Campus Life",
  "Technical / Programming Help",
  "Study Resources",
  "Clubs & Events",
  "General / Other",
];

const createQuestion = async (req, res) => {
  try {
    const { title, body, category } = req.body;

    if (!title || !body) {
      return res.status(400).json({ message: "Title and body are required" });
    }

    const nextCategory =
      typeof category === "string" && category.trim()
        ? category.trim()
        : "General / Other";

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
    const { title, body, category } = req.body;

    const hasTitle = typeof title === "string" && title.trim();
    const hasBody = typeof body === "string" && body.trim();
    const hasCategory = typeof category === "string" && category.trim();

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

    if (hasTitle) question.title = title.trim();
    if (hasBody) question.body = body.trim();
    if (hasCategory) {
      const nextCategory = category.trim();
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

const QUESTION_SEARCH_STATUS = ["open", "solved", "locked"];

const searchQuestions = async (req, res) => {
  try {
    const rawQuery = typeof req.query.q === "string" ? req.query.q : "";
    const q = rawQuery.trim();

    if (!q) {
      return res.status(400).json({ message: "Search query (q) is required" });
    }

    if (q.length < 2) {
      return res.json([]);
    }

    const rawCategory = typeof req.query.category === "string" ? req.query.category : "";
    const category = rawCategory.trim();
    if (category && !QUESTION_CATEGORIES.includes(category)) {
      return res.status(400).json({ message: "Invalid category" });
    }

    const rawStatus = typeof req.query.status === "string" ? req.query.status : "";
    const status = rawStatus.trim();
    if (status && !QUESTION_SEARCH_STATUS.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const skip = (page - 1) * limit;

    const tokens = q
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 10);

    const escapedTokens = tokens.map(escapeRegExp).filter((t) => t.length >= 2);
    if (!escapedTokens.length) {
      return res.json([]);
    }

    const tokenRegex = new RegExp(escapedTokens.join("|"), "i");

    const filter = {
      $or: [{ title: { $regex: tokenRegex } }, { body: { $regex: tokenRegex } }],
    };
    if (category) filter.category = category;
    if (status) filter.status = status;

    const questions = await Question.find(filter)
      .populate("authorId", "firstName lastName email role")
      .populate("bestAnswerId")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.json(questions);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getQuestionSuggestions = async (req, res) => {
  try {
    const rawTitle = typeof req.query.title === "string" ? req.query.title : "";
    const title = rawTitle.trim();

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
  searchQuestions,
  getQuestionSuggestions,
  updateQuestion,
  deleteQuestion,
};
