const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Question = require("../models/Question");
const Answer = require("../models/Answer");
const Comment = require("../models/Comment");
const QuestionVote = require("../models/QuestionVote");
const AnswerVote = require("../models/AnswerVote");
const { deleteBlobIfExists } = require("../utils/azureBlob");

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const uploadsRoot = path.join(__dirname, "..", "uploads");

/** Exact titles from seedQuestions.js — removes only these rows. */
const SEED_QUESTION_TITLES = [
  "How do I prepare effectively for SLIIT mid-term exams?",
  "What companies usually recruit for software internships from SLIIT?",
  "Why does my React useEffect run twice in development?",
  "Best way to join tech clubs and hackathons on campus?",
  "Where can I find quiet study spots near the cafeteria?",
];

const unlinkUploadUrl = (url) => {
  if (typeof url !== "string" || !url.startsWith("/uploads/")) return;
  const rel = url.replace(/^\/uploads\//, "");
  const abs = path.join(uploadsRoot, rel);
  const normRoot = path.normalize(uploadsRoot + path.sep);
  const normAbs = path.normalize(abs);
  if (!normAbs.startsWith(normRoot)) return;
  fs.unlink(abs, () => {});
};

const deleteQuestionImageAsset = async (img) => {
  if (!img) return;
  if (img.blobName) {
    try {
      await deleteBlobIfExists(img.blobName);
    } catch {}
    return;
  }
  if (img.url) unlinkUploadUrl(img.url);
};

const removeOneQuestion = async (question) => {
  const answers = await Answer.find({ questionId: question._id }).select("_id");
  const answerIds = answers.map((a) => a._id);

  if (answerIds.length) {
    await AnswerVote.deleteMany({ answerId: { $in: answerIds } });
    await Comment.deleteMany({ targetType: "answer", targetId: { $in: answerIds } });
  }
  await Comment.deleteMany({ targetType: "question", targetId: question._id });
  await Answer.deleteMany({ questionId: question._id });
  await QuestionVote.deleteMany({ questionId: question._id });

  for (const img of question.images || []) {
    // eslint-disable-next-line no-await-in-loop
    await deleteQuestionImageAsset(img);
  }

  await question.deleteOne();
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing in .env");
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB connected. Removing seed Q&A…");

  let removed = 0;
  let missing = 0;

  for (const title of SEED_QUESTION_TITLES) {
    const q = await Question.findOne({ title });
    if (!q) {
      missing += 1;
      console.log(`Not found (skip): ${title.slice(0, 55)}…`);
      continue;
    }
    await removeOneQuestion(q);
    removed += 1;
    console.log(`Removed: ${title}`);
  }

  console.log(`Done. Removed ${removed} questions (${missing} titles not in DB).`);
};

main()
  .catch((err) => {
    console.error("Cleanup failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
    console.log("MongoDB connection closed.");
  });
