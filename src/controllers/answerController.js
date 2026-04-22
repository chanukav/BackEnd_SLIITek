const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Answer = require("../models/Answer");
const Question = require("../models/Question");
const Comment = require("../models/Comment");
const AnswerVote = require("../models/AnswerVote");
const User = require("../models/user");
const { notificationQueue } = require("../queues/notificationQueue");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const {
  uploadAnswerImage,
  deleteBlobIfExists,
  hydrateAnswerImages,
} = require("../utils/azureBlob");

// Must match `server.js`: express.static(path.join(__dirname, "..", "uploads")) from `/src`.
const uploadsRoot = path.join(__dirname, "..", "..", "uploads");
const MAX_ANSWER_IMAGES = 4;
const ANSWER_BODY_MAX_LENGTH = 2000;
const ANSWER_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_ANSWER_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const unlinkUploadUrl = (url) => {
  if (typeof url !== "string" || !url.startsWith("/uploads/")) return;
  const rel = url.replace(/^\/uploads\//, "");
  const abs = path.join(uploadsRoot, rel);
  const normRoot = path.normalize(uploadsRoot + path.sep);
  const normAbs = path.normalize(abs);
  if (!normAbs.startsWith(normRoot)) return;
  fs.unlink(normAbs, () => {});
};

const deleteAnswerImageAsset = async (img) => {
  if (!img) return;
  if (img.blobName) {
    try {
      await deleteBlobIfExists(img.blobName);
    } catch {}
    return;
  }
  if (img.url) unlinkUploadUrl(img.url);
};

const hasAzureBlobStorage = () =>
  Boolean(String(process.env.AZURE_STORAGE_CONNECTION_STRING || "").trim());

/** Saves one buffer to local disk under /uploads/answers/:answerId/ (dev / fallback when Azure fails). */
async function saveAnswerImageLocal({ answerId, buffer, originalName }) {
  const idStr = String(answerId);
  const relDir = path.join("answers", idStr);
  const dir = path.join(uploadsRoot, relDir);
  await fs.promises.mkdir(dir, { recursive: true });
  let ext = path.extname(String(originalName || "")).toLowerCase();
  const okExt = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
  if (!okExt.has(ext)) ext = ".jpg";
  const fname = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
  const absFile = path.join(dir, fname);
  await fs.promises.writeFile(absFile, buffer);
  return { url: `/uploads/answers/${idStr}/${fname}`, blobName: "" };
}

const validateAnswerImageFiles = (files) => {
  const badFile = files.find((f) => {
    const mime = String(f?.mimetype || "").toLowerCase();
    const size = Number(f?.size || 0);
    return !ALLOWED_ANSWER_IMAGE_MIME_TYPES.has(mime) || size <= 0 || size > ANSWER_IMAGE_MAX_SIZE_BYTES;
  });

  if (!badFile) return "";
  const mime = String(badFile?.mimetype || "").toLowerCase();
  if (!ALLOWED_ANSWER_IMAGE_MIME_TYPES.has(mime)) {
    return "Only JPEG, PNG, GIF, and WebP images are allowed.";
  }
  return "Each answer image must be smaller than 5MB.";
};

async function buildAnswerImageRecords(answerId, userId, files) {
  const newImages = [];
  for (const f of files) {
    let rec;
    if (hasAzureBlobStorage()) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const uploaded = await uploadAnswerImage({
          answerId,
          userId,
          buffer: f.buffer,
          contentType: f.mimetype,
          originalName: f.originalname,
        });
        rec = {
          url: uploaded.url,
          blobName: uploaded.blobName || "",
          uploadedAt: new Date(),
        };
      } catch (e) {
        console.error("[answers] Azure upload failed, using local disk:", e?.message);
        // eslint-disable-next-line no-await-in-loop
        const loc = await saveAnswerImageLocal({
          answerId,
          buffer: f.buffer,
          originalName: f.originalname,
        });
        rec = { url: loc.url, blobName: "", uploadedAt: new Date() };
      }
    } else {
      // eslint-disable-next-line no-await-in-loop
      const loc = await saveAnswerImageLocal({
        answerId,
        buffer: f.buffer,
        originalName: f.originalname,
      });
      rec = { url: loc.url, blobName: "", uploadedAt: new Date() };
    }
    newImages.push(rec);
  }
  return newImages;
}
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

const postAnswer = async (req, res) => {
  try {
    const { questionId } = req.params;
    const rawBody = req.body?.body;
    const parentRaw = req.body?.parentAnswerId;
    const parentAnswerId =
      parentRaw && String(parentRaw).trim() && String(parentRaw) !== "null"
        ? String(parentRaw).trim()
        : null;
    const files = Array.isArray(req.files) ? req.files : [];

    if (!isValidObjectId(questionId)) {
      return res.status(400).json({ message: "That question id doesn’t look valid." });
    }

    if (parentAnswerId && !isValidObjectId(parentAnswerId)) {
      return res.status(400).json({ message: "That parent answer id doesn’t look valid." });
    }

    if (rawBody != null && typeof rawBody !== "string") {
      return res.status(400).json({ message: "Answer must be plain text." });
    }

    const trimmedBody = typeof rawBody === "string" ? rawBody.trim() : "";

    if (!trimmedBody && !files.length) {
      return res.status(400).json({
        message: "Please write an answer or attach at least one image.",
      });
    }

    if (trimmedBody.length > ANSWER_BODY_MAX_LENGTH) {
      return res.status(400).json({
        message: `Answer text must be at most ${ANSWER_BODY_MAX_LENGTH} characters.`,
      });
    }

    if (files.length > MAX_ANSWER_IMAGES) {
      return res.status(400).json({
        message: `You can attach at most ${MAX_ANSWER_IMAGES} images per answer.`,
      });
    }
    const fileValidationError = validateAnswerImageFiles(files);
    if (fileValidationError) {
      return res.status(400).json({ message: fileValidationError });
    }

    const question = await Question.findById(questionId);
    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }

    if (question.status === "locked") {
      return res.status(403).json({ message: "Question is locked" });
    }

    // If parentAnswerId is provided, check if it exists and belongs to the same question
    if (parentAnswerId) {
      const parentAnswer = await Answer.findById(parentAnswerId);
      if (!parentAnswer) {
        return res.status(404).json({ message: "Parent answer not found" });
      }
      if (parentAnswer.questionId.toString() !== questionId) {
        return res.status(400).json({ message: "Parent answer does not belong to this question" });
      }
    }

    const answer = await Answer.create({
      questionId,
      authorId: req.user._id,
      body: trimmedBody,
      parentAnswerId: parentAnswerId || null,
      images: [],
    });

    if (files.length) {
      const newImages = await buildAnswerImageRecords(
        answer._id.toString(),
        req.user._id.toString(),
        files
      );
      answer.images = newImages;
      await answer.save();
    }
    // --- Notification Logic ---
    try {
      const qAuthor = await User.findById(question.authorId).select("email _id");
      
      if (!parentAnswerId) {
        // New top-level answer: Notify ONLY the question author
        if (qAuthor && qAuthor._id.toString() !== req.user._id.toString()) {
          await notificationQueue.add("new-answer", {
            email: qAuthor.email,
            type: "answer",
            entityType: "Question",
            entityId: question._id.toString(),
            answerId: answer._id.toString(),
            title: "New Answer",
            message: `${req.user.firstName} ${req.user.lastName} answered your question: "${question.title}"`,
          });
        }
      } else {
        // Reply to an answer: notify parent author, sibling repliers, ancestor authors, and question owner
        const parentAnswer = await Answer.findById(parentAnswerId);
        if (parentAnswer) {
          const interactUserIds = new Set();

          interactUserIds.add(parentAnswer.authorId.toString());

          const replies = await Answer.find({ parentAnswerId }).select("authorId").lean();
          replies.forEach((r) => interactUserIds.add(r.authorId.toString()));

          // Walk up so e.g. top-level answer author still gets notified on nested "reply to reply"
          let ancestorId = parentAnswer.parentAnswerId;
          while (ancestorId) {
            const ancestor = await Answer.findById(ancestorId).select("authorId parentAnswerId").lean();
            if (!ancestor) break;
            interactUserIds.add(ancestor.authorId.toString());
            ancestorId = ancestor.parentAnswerId;
          }

          if (qAuthor && qAuthor._id) {
            interactUserIds.add(qAuthor._id.toString());
          }

          interactUserIds.delete(req.user._id.toString());

          if (interactUserIds.size > 0) {
            const usersToNotify = await User.find({ _id: { $in: Array.from(interactUserIds) } }).select("email");

            for (const u of usersToNotify) {
              await notificationQueue.add("new-reply", {
                email: u.email,
                type: "comment",
                entityType: "Answer",
                entityId: parentAnswerId.toString(),
                questionId: question._id.toString(),
                title: "New Reply",
                message: `${req.user.firstName} ${req.user.lastName} replied to an answer on: "${question.title}"`,
              });
            }
          }
        }
      }
    } catch (notifErr) {
      console.error("Failed to send notifications:", notifErr);
    }

    const answerOut = answer.toObject ? answer.toObject() : answer;
    const answerHydrated = await hydrateAnswerImages(answerOut);

    return res.status(201).json({
      message: "Answer posted successfully",
      answer: answerHydrated,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const editAnswer = async (req, res) => {
  try {
    const { answerId } = req.params;
    const { body } = req.body;

    if (!isValidObjectId(answerId)) {
      return res.status(400).json({ message: "That answer id doesn’t look valid." });
    }

    if (typeof body !== "string") {
      return res.status(400).json({ message: "Answer must be plain text." });
    }

    const trimmedBody = body.trim();

    const answer = await Answer.findById(answerId);
    if (!answer) {
      return res.status(404).json({ message: "Answer not found" });
    }

    if (answer.authorId.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ message: "Only answer owner can edit this answer" });
    }

    const hasImages = Array.isArray(answer.images) && answer.images.length > 0;
    if (!trimmedBody && !hasImages) {
      return res
        .status(400)
        .json({ message: "Please write an answer before submitting." });
    }

    answer.body = trimmedBody;
    await answer.save();

    const answerOut = answer.toObject ? answer.toObject() : answer;
    const answerHydrated = await hydrateAnswerImages(answerOut);

    return res.json({
      message: "Answer updated successfully",
      answer: answerHydrated,
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

    // Cascade delete nested replies (Facebook-style thread)
    const collectDescendantIds = async (parentId) => {
      const children = await Answer.find({ parentAnswerId: parentId }).select("_id").lean();
      const ids = children.map((c) => c._id);
      for (const childId of ids) {
        const descendants = await collectDescendantIds(childId);
        ids.push(...descendants);
      }
      return ids;
    };

    const idsToDelete = [answer._id, ...(await collectDescendantIds(answer._id))];

    const question = await Question.findById(answer.questionId);
    if (question?.bestAnswerId && idsToDelete.some((id) => id.toString() === question.bestAnswerId.toString())) {
      question.bestAnswerId = null;
      question.status = "open";
      await question.save();
    }

    await Comment.deleteMany({ targetType: "answer", targetId: { $in: idsToDelete } });
    await AnswerVote.deleteMany({ answerId: { $in: idsToDelete } });
    await Answer.deleteMany({ _id: { $in: idsToDelete } });

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

    const answerHydrated = await hydrateAnswerImages(answer.toObject());

    return res.json({
      message: "Best answer marked successfully",
      answer: answerHydrated,
      question,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getAnswersByQuestion = async (req, res) => {
  try {
    const { questionId } = req.params;

    // Fetch all answers for the question
    const answers = await Answer.find({ questionId })
      .populate("authorId", "firstName lastName faculty academicYear role")
      .sort({ voteScore: -1, isBest: -1, createdAt: -1 })
      .lean();

    const answersHydrated = await Promise.all(answers.map((a) => hydrateAnswerImages(a)));

    // If user is authenticated, mark which answers are liked by them.
    const userId = getUserIdFromAuthHeaderOptional(req);
    if (userId && answersHydrated.length) {
      const answerIds = answersHydrated.map((a) => a._id);
      const votes = await AnswerVote.find({
        userId,
        answerId: { $in: answerIds },
      })
        .select("answerId value")
        .lean();

      const voteMap = new Map(
        votes.map((v) => [
          v.answerId.toString(),
          v.value === -1 ? -1 : 1,
        ])
      );
      answersHydrated.forEach((a) => {
        const mv = voteMap.get(a._id.toString()) ?? 0;
        a.myVote = mv;
        a.likedByMe = mv === 1;
        a.dislikedByMe = mv === -1;
      });
    } else {
      answersHydrated.forEach((a) => {
        a.myVote = 0;
        a.likedByMe = false;
        a.dislikedByMe = false;
      });
    }

    // Build a map of answers by their _id
    const answerMap = {};
    answersHydrated.forEach((ans) => {
      ans.replies = [];
      answerMap[ans._id.toString()] = ans;
    });

    // Organize answers into a nested structure
    const nestedAnswers = [];
    answersHydrated.forEach((ans) => {
      if (ans.parentAnswerId) {
        const parent = answerMap[ans.parentAnswerId.toString()];
        if (parent) {
          parent.replies.push(ans);
        }
      } else {
        nestedAnswers.push(ans);
      }
    });

    return res.json(nestedAnswers);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const addAnswerImages = async (req, res) => {
  try {
    const { answerId } = req.params;
    const files = Array.isArray(req.files) ? req.files : [];

    if (!isValidObjectId(answerId)) {
      return res.status(400).json({ message: "That answer id doesn’t look valid." });
    }
    if (!files.length) {
      return res.status(400).json({ message: "No image files uploaded" });
    }

    const answer = await Answer.findById(answerId);
    if (!answer) {
      return res.status(404).json({ message: "Answer not found" });
    }

    if (answer.authorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Only the answer author can add images" });
    }

    const question = await Question.findById(answer.questionId);
    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }
    if (question.status === "locked") {
      return res.status(403).json({ message: "Question is locked" });
    }

    const currentCount = (answer.images || []).length;
    if (currentCount + files.length > MAX_ANSWER_IMAGES) {
      return res.status(400).json({
        message: `You can attach at most ${MAX_ANSWER_IMAGES} images per answer`,
      });
    }
    const fileValidationError = validateAnswerImageFiles(files);
    if (fileValidationError) {
      return res.status(400).json({ message: fileValidationError });
    }

    const newImages = await buildAnswerImageRecords(
      answer._id.toString(),
      req.user._id.toString(),
      files
    );

    answer.images = [...(answer.images || []), ...newImages];
    await answer.save();

    const populated = await Answer.findById(answer._id)
      .populate("authorId", "firstName lastName faculty academicYear role")
      .lean();
    const hydrated = await hydrateAnswerImages(populated);

    return res.status(201).json({
      message: "Images uploaded",
      answer: hydrated,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const removeAnswerImage = async (req, res) => {
  try {
    const { answerId } = req.params;
    const { url } = req.body;

    if (!url || typeof url !== "string" || !url.trim()) {
      return res.status(400).json({ message: "Image url is required" });
    }
    const trimmedUrl = url.trim();

    if (!isValidObjectId(answerId)) {
      return res.status(400).json({ message: "That answer id doesn’t look valid." });
    }

    const answer = await Answer.findById(answerId);
    if (!answer) {
      return res.status(404).json({ message: "Answer not found" });
    }

    if (answer.authorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Only the answer author can remove images" });
    }

    const images = answer.images || [];
    const idx = images.findIndex((img) => (img.url || "").trim() === trimmedUrl);
    if (idx === -1) {
      return res.status(404).json({ message: "Image not found on this answer" });
    }

    const remainingAfter = images.length - 1;
    const hasText = !!(answer.body && answer.body.trim());
    if (!hasText && remainingAfter === 0) {
      return res.status(400).json({
        message: "Add text before removing the last image, or delete the answer instead.",
      });
    }

    const [removed] = images.splice(idx, 1);
    answer.images = images;
    await answer.save();

    await deleteAnswerImageAsset(removed);

    const populated = await Answer.findById(answer._id)
      .populate("authorId", "firstName lastName faculty academicYear role")
      .lean();
    const hydrated = await hydrateAnswerImages(populated);

    return res.json({
      message: "Image removed",
      answer: hydrated,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
const normalizeVoteValue = (doc) => (doc?.value === -1 ? -1 : 1);

const voteAnswer = async (req, res) => {
  try {
    const { answerId } = req.params;
    const type = req.body?.type === "dislike" ? "dislike" : "like";

    if (!isValidObjectId(answerId)) {
      return res.status(400).json({ message: "That answer id doesn’t look valid." });
    }

    const answer = await Answer.findById(answerId);
    if (!answer) {
      return res.status(404).json({ message: "Answer not found" });
    }

    const existing = await AnswerVote.findOne({
      userId: req.user._id,
      answerId: answer._id,
    });

    const prev = existing ? normalizeVoteValue(existing) : null;

    if (type === "like") {
      if (prev === 1) {
        await AnswerVote.deleteOne({ _id: existing._id });
        answer.voteScore = Math.max(0, (answer.voteScore || 0) - 1);
      } else if (prev === -1) {
        existing.value = 1;
        await existing.save();
        answer.dislikeCount = Math.max(0, (answer.dislikeCount || 0) - 1);
        answer.voteScore = (answer.voteScore || 0) + 1;
      } else {
        try {
          await AnswerVote.create({
            userId: req.user._id,
            answerId: answer._id,
            value: 1,
          });
          answer.voteScore = (answer.voteScore || 0) + 1;
        } catch (err) {
          if (err?.code !== 11000) throw err;
        }
      }
    } else {
      if (prev === -1) {
        await AnswerVote.deleteOne({ _id: existing._id });
        answer.dislikeCount = Math.max(0, (answer.dislikeCount || 0) - 1);
      } else if (prev === 1) {
        existing.value = -1;
        await existing.save();
        answer.voteScore = Math.max(0, (answer.voteScore || 0) - 1);
        answer.dislikeCount = (answer.dislikeCount || 0) + 1;
      } else {
        try {
          await AnswerVote.create({
            userId: req.user._id,
            answerId: answer._id,
            value: -1,
          });
          answer.dislikeCount = (answer.dislikeCount || 0) + 1;
        } catch (err) {
          if (err?.code !== 11000) throw err;
        }
      }
    }

    await answer.save();

    const row = await AnswerVote.findOne({
      userId: req.user._id,
      answerId: answer._id,
    }).lean();
    const myVote = row ? normalizeVoteValue(row) : 0;

    return res.json({
      message: "Vote updated",
      answerId: answer._id,
      voteScore: answer.voteScore,
      dislikeCount: answer.dislikeCount || 0,
      myVote,
      likedByMe: myVote === 1,
      dislikedByMe: myVote === -1,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const unvoteAnswer = async (req, res) => {
  try {
    const { answerId } = req.params;

    if (!isValidObjectId(answerId)) {
      return res.status(400).json({ message: "That answer id doesn’t look valid." });
    }

    const answer = await Answer.findById(answerId);
    if (!answer) {
      return res.status(404).json({ message: "Answer not found" });
    }

    const deleted = await AnswerVote.findOneAndDelete({
      userId: req.user._id,
      answerId: answer._id,
    });

    if (deleted) {
      const was = normalizeVoteValue(deleted);
      if (was === 1) {
        answer.voteScore = Math.max(0, (answer.voteScore || 0) - 1);
      } else {
        answer.dislikeCount = Math.max(0, (answer.dislikeCount || 0) - 1);
      }
      await answer.save();
    }

    return res.json({
      message: deleted ? "Vote removed" : "No vote yet",
      answerId: answer._id,
      voteScore: answer.voteScore,
      dislikeCount: answer.dislikeCount || 0,
      myVote: 0,
      likedByMe: false,
      dislikedByMe: false,
    });
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

    // --- Notification Logic for Comment ---
    try {
      // Find all comments on this answer
      const comments = await Comment.find({ targetType: "answer", targetId: answerId }).select("authorId").lean();
      
      // Collect unique user IDs who interacted with this answer (answer author + comment authors)
      const interactUserIds = new Set();
      interactUserIds.add(answer.authorId.toString());
      comments.forEach(c => interactUserIds.add(c.authorId.toString()));
      
      // Remove the user who is currently commenting
      interactUserIds.delete(req.user._id.toString());
      
      if (interactUserIds.size > 0) {
        const usersToNotify = await User.find({ _id: { $in: Array.from(interactUserIds) } }).select("email");
        
        for (const u of usersToNotify) {
          await notificationQueue.add("new-comment", {
            email: u.email,
            type: "comment",
            entityType: "Answer",
            entityId: answerId.toString(),
            questionId: answer.questionId.toString(),
            title: "New Comment",
            message: `${req.user.firstName} ${req.user.lastName} commented on an answer you follow.`,
          });
        }
      }
    } catch (notifErr) {
      console.error("Failed to send notifications for comment:", notifErr);
    }

    return res.status(201).json({
      message: "Comment added to answer",
      comment,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getMyAnswers = async (req, res) => {
  try {
    const answers = await Answer.find({ authorId: req.user._id })
      .populate("questionId", "title status")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json(answers);
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
  addAnswerImages,
  removeAnswerImage,
  getMyAnswers,
  voteAnswer,
  unvoteAnswer,
  addCommentToAnswer,
};
