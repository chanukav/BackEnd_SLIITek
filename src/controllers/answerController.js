const Answer = require("../models/Answer");
const Question = require("../models/Question");
const Comment = require("../models/Comment");
const AnswerVote = require("../models/AnswerVote");
const User = require("../models/user");
const { notificationQueue } = require("../queues/notificationQueue");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

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

const postAnswer = async (req, res) => {
  try {
    const { questionId } = req.params;
    const { body, parentAnswerId = null } = req.body;

    if (!isValidObjectId(questionId)) {
      return res.status(400).json({ message: "That question id doesn’t look valid." });
    }

    if (parentAnswerId && !isValidObjectId(parentAnswerId)) {
      return res.status(400).json({ message: "That parent answer id doesn’t look valid." });
    }

    if (typeof body !== "string") {
      return res.status(400).json({ message: "Answer must be plain text." });
    }

    const trimmedBody = body.trim();

    if (!trimmedBody) {
      return res
        .status(400)
        .json({ message: "Please write an answer before submitting." });
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
    });

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
            title: "New Answer",
            message: `${req.user.firstName} ${req.user.lastName} answered your question: "${question.title}"`,
          });
        }
      } else {
        // Reply to an answer: Notify all users who interacted with this answer thread
        const parentAnswer = await Answer.findById(parentAnswerId);
        if (parentAnswer) {
          // Find all replies to this parent answer
          const replies = await Answer.find({ parentAnswerId }).select("authorId").lean();
          
          // Collect unique user IDs who interacted with this thread
          const interactUserIds = new Set();
          interactUserIds.add(parentAnswer.authorId.toString());
          replies.forEach(r => interactUserIds.add(r.authorId.toString()));
          
          // Remove the user who is currently replying
          interactUserIds.delete(req.user._id.toString());
          
          if (interactUserIds.size > 0) {
            const usersToNotify = await User.find({ _id: { $in: Array.from(interactUserIds) } }).select("email");
            
            for (const u of usersToNotify) {
              await notificationQueue.add("new-reply", {
                email: u.email,
                type: "comment",
                entityType: "Answer",
                entityId: parentAnswerId.toString(),
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

    if (!isValidObjectId(answerId)) {
      return res.status(400).json({ message: "That answer id doesn’t look valid." });
    }

    if (typeof body !== "string") {
      return res.status(400).json({ message: "Answer must be plain text." });
    }

    const trimmedBody = body.trim();

    if (!trimmedBody) {
      return res
        .status(400)
        .json({ message: "Please write an answer before submitting." });
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

    answer.body = trimmedBody;
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

    // Fetch all answers for the question
    const answers = await Answer.find({ questionId })
      .populate("authorId", "firstName lastName faculty academicYear role")
      .sort({ voteScore: -1, isBest: -1, createdAt: -1 })
      .lean();

    // If user is authenticated, mark which answers are liked by them.
    const userId = getUserIdFromAuthHeaderOptional(req);
    if (userId && answers.length) {
      const answerIds = answers.map((a) => a._id);
      const votes = await AnswerVote.find({
        userId,
        answerId: { $in: answerIds },
      })
        .select("answerId")
        .lean();

      const likedSet = new Set(votes.map((v) => v.answerId.toString()));
      answers.forEach((a) => {
        a.likedByMe = likedSet.has(a._id.toString());
      });
    } else {
      answers.forEach((a) => {
        a.likedByMe = false;
      });
    }

    // Build a map of answers by their _id
    const answerMap = {};
    answers.forEach(ans => {
      ans.replies = [];
      answerMap[ans._id.toString()] = ans;
    });

    // Organize answers into a nested structure
    const nestedAnswers = [];
    answers.forEach(ans => {
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

const voteAnswer = async (req, res) => {
  try {
    const { answerId } = req.params;

    if (!isValidObjectId(answerId)) {
      return res.status(400).json({ message: "That answer id doesn’t look valid." });
    }

    const answer = await Answer.findById(answerId);
    if (!answer) {
      return res.status(404).json({ message: "Answer not found" });
    }

    const vote = {
      userId: req.user._id,
      answerId: answer._id,
    };

    let created = false;
    try {
      await AnswerVote.create(vote);
      created = true;
    } catch (err) {
      // Unique constraint: user can vote only once per answer.
      if (err?.code !== 11000) throw err;
    }

    if (created) {
      answer.voteScore = (answer.voteScore || 0) + 1;
      await answer.save();
    }

    return res.json({
      message: created ? "Like recorded" : "Already liked",
      answerId: answer._id,
      voteScore: answer.voteScore,
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
      answer.voteScore = Math.max(0, (answer.voteScore || 0) - 1);
      await answer.save();
    }

    return res.json({
      message: deleted ? "Like removed" : "Not liked yet",
      answerId: answer._id,
      voteScore: answer.voteScore,
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

module.exports = {
  postAnswer,
  editAnswer,
  deleteAnswer,
  markBestAnswer,
  getAnswersByQuestion,
  voteAnswer,
  unvoteAnswer,
  addCommentToAnswer,
};
