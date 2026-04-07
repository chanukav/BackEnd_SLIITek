const path = require("path");
const fs = require("fs");
const Question = require("../models/Question");
const Answer = require("../models/Answer");
const Comment = require("../models/Comment");
const { uploadQuestionImage, deleteBlobIfExists, hydrateQuestionImages } = require("../utils/azureBlob");
const QuestionVote = require("../models/QuestionVote");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const uploadsRoot = path.join(__dirname, "..", "uploads");
const MAX_QUESTION_IMAGES = 8;

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

// Optional auth helper: if `Authorization: Bearer <token>` exists and is valid,
// returns the userId; otherwise returns null.
const getUserIdFromAuthHeaderOptional = (req) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded?.id ? decoded.id.toString() : null;
  } catch {
    return null;
  }
};

const attachQuestionCountsAndMyVote = async (req, questionsPlain) => {
  if (!Array.isArray(questionsPlain) || !questionsPlain.length) return questionsPlain;

  const ids = questionsPlain.map((q) => q._id).filter(Boolean);
  const counts = await Answer.aggregate([
    { $match: { questionId: { $in: ids } } },
    { $group: { _id: "$questionId", count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((r) => [r._id.toString(), r.count]));

  const userId = getUserIdFromAuthHeaderOptional(req);
  let likedSet = new Set();
  if (userId) {
    const votes = await QuestionVote.find({
      userId,
      questionId: { $in: ids },
    })
      .select("questionId")
      .lean();
    likedSet = new Set(votes.map((v) => v.questionId.toString()));
  }

  return questionsPlain.map((q) => {
    const idStr = q._id?.toString?.() || String(q._id);
    return {
      ...q,
      answerCount: countMap.get(idStr) || 0,
      likedByMe: likedSet.has(idStr),
    };
  });
};

const unlinkUploadUrl = (url) => {
  if (typeof url !== "string" || !url.startsWith("/uploads/")) return;
  const rel = url.replace(/^\/uploads\//, "");
  const abs = path.join(uploadsRoot, rel);
  const normRoot = path.normalize(uploadsRoot + path.sep);
  const normAbs = path.normalize(abs);
  if (!normAbs.startsWith(normRoot)) return;
  fs.unlink(normAbs, () => {});
};

const deleteQuestionImageAsset = async (img) => {
  if (!img) return;
  // New approach: Azure blob
  if (img.blobName) {
    try {
      await deleteBlobIfExists(img.blobName);
    } catch {}
    return;
  }
  // Backward compatibility: local /uploads URLs
  if (img.url) unlinkUploadUrl(img.url);
};

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

    let out = await Promise.all(questions.map((q) => hydrateQuestionImages(q.toObject())));
    out = await attachQuestionCountsAndMyVote(req, out);
    return res.json(out);
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

    const hydrated = await hydrateQuestionImages(question.toObject());
    const [withCounts] = await attachQuestionCountsAndMyVote(req, [hydrated]);
    return res.json(withCounts);
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
      question: await hydrateQuestionImages(populated.toObject()),
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
    for (const img of question.images || []) {
      // eslint-disable-next-line no-await-in-loop
      await deleteQuestionImageAsset(img);
    }
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

    let out = await Promise.all(questions.map((q) => hydrateQuestionImages(q.toObject())));
    out = await attachQuestionCountsAndMyVote(req, out);
    return res.json(out);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const addQuestionImages = async (req, res) => {
  try {
    const question = await Question.findById(req.params.id);
    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }

    if (question.authorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Only the question owner can add images" });
    }

    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ message: "No image files uploaded" });
    }

    const currentCount = (question.images || []).length;
    if (currentCount + files.length > MAX_QUESTION_IMAGES) {
      return res.status(400).json({
        message: `You can attach at most ${MAX_QUESTION_IMAGES} images per question`,
      });
    }

    const newImages = [];
    for (const f of files) {
      // eslint-disable-next-line no-await-in-loop
      const uploaded = await uploadQuestionImage({
        questionId: question._id.toString(),
        buffer: f.buffer,
        contentType: f.mimetype,
        originalName: f.originalname,
      });
      newImages.push({
        url: uploaded.url,
        blobName: uploaded.blobName,
        uploadedAt: new Date(),
      });
    }

    question.images = [...(question.images || []), ...newImages];
    await question.save();

    const populated = await Question.findById(question._id)
      .populate("authorId", "firstName lastName email role")
      .populate("bestAnswerId");

    return res.status(201).json({
      message: "Images uploaded",
      question: await hydrateQuestionImages(populated.toObject()),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const removeQuestionImage = async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== "string" || !url.trim()) {
      return res.status(400).json({ message: "Image url is required" });
    }

    const trimmedUrl = url.trim();

    const question = await Question.findById(req.params.id);
    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }

    if (question.authorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Only the question owner can remove images" });
    }

    const images = question.images || [];
    const idx = images.findIndex((img) => img.url === trimmedUrl);
    if (idx === -1) {
      return res.status(404).json({ message: "Image not found on this question" });
    }

    const [removed] = images.splice(idx, 1);
    question.images = images;
    await question.save();

    await deleteQuestionImageAsset(removed);

    const populated = await Question.findById(question._id)
      .populate("authorId", "firstName lastName email role")
      .populate("bestAnswerId");

    return res.json({
      message: "Image removed",
      question: await hydrateQuestionImages(populated.toObject()),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const voteQuestion = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "That question id doesn’t look valid." });
    }

    const question = await Question.findById(id);
    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }

    let created = false;
    try {
      await QuestionVote.create({ userId: req.user._id, questionId: question._id });
      created = true;
    } catch (err) {
      if (err?.code !== 11000) throw err;
    }

    if (created) {
      question.voteScore = (question.voteScore || 0) + 1;
      await question.save();
    }

    return res.json({
      message: created ? "Vote recorded" : "Already voted",
      questionId: question._id,
      voteScore: question.voteScore || 0,
      likedByMe: true,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const unvoteQuestion = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "That question id doesn’t look valid." });
    }

    const question = await Question.findById(id);
    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }

    const deleted = await QuestionVote.findOneAndDelete({
      userId: req.user._id,
      questionId: question._id,
    });

    if (deleted) {
      question.voteScore = Math.max(0, (question.voteScore || 0) - 1);
      await question.save();
    }

    return res.json({
      message: deleted ? "Vote removed" : "Not voted yet",
      questionId: question._id,
      voteScore: question.voteScore || 0,
      likedByMe: false,
    });
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
  addQuestionImages,
  removeQuestionImage,
  voteQuestion,
  unvoteQuestion,
};
