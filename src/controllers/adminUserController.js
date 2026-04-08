const path = require("path");
const fs = require("fs");
const User = require("../models/user");
const Question = require("../models/Question");
const Answer = require("../models/Answer");
const Comment = require("../models/Comment");
const AnswerVote = require("../models/AnswerVote");
const Notification = require("../models/Notification");
const UserRecentAnswer = require("../models/UserRecentAnswer");
const UserDashboardStat = require("../models/UserDashboardStat");
const UserModeration = require("../models/UserModeration");
const Report = require("../models/Report");
const { deleteBlobIfExists } = require("../utils/azureBlob");

const uploadsDir = path.join(__dirname, "..", "uploads");

const removeAvatarFile = (avatarPath) => {
  if (!avatarPath || typeof avatarPath !== "string") return;
  const basename = path.basename(avatarPath);
  const abs = path.join(uploadsDir, basename);
  if (fs.existsSync(abs)) {
    fs.unlinkSync(abs);
  }
};

const deleteQuestionImageAsset = async (img) => {
  if (!img) return;
  if (img.blobName) {
    try {
      await deleteBlobIfExists(img.blobName);
    } catch {
      /* ignore */
    }
    return;
  }
  if (typeof img.url === "string" && img.url.startsWith("/uploads/")) {
    const rel = img.url.replace(/^\/uploads\//, "");
    const abs = path.join(uploadsDir, rel);
    const normRoot = path.normalize(uploadsDir + path.sep);
    const normAbs = path.normalize(abs);
    if (normAbs.startsWith(normRoot) && fs.existsSync(abs)) {
      fs.unlinkSync(abs);
    }
  }
};

async function purgeUserContentFixed(userDoc) {
  if (!userDoc) return;
  const userId = userDoc._id;
  const email = userDoc.email;

  removeAvatarFile(userDoc.avatar);
  removeAvatarFile(userDoc.sliitIdPhoto);

  const ownedQuestions = await Question.find({ authorId: userId });
  for (const question of ownedQuestions) {
    const answers = await Answer.find({ questionId: question._id }).select("_id");
    const answerIds = answers.map((a) => a._id);
    if (answerIds.length) {
      await Comment.deleteMany({
        targetType: "answer",
        targetId: { $in: answerIds },
      });
    }
    await Comment.deleteMany({
      targetType: "question",
      targetId: question._id,
    });
    await Answer.deleteMany({ questionId: question._id });
    for (const img of question.images || []) {
      // eslint-disable-next-line no-await-in-loop
      await deleteQuestionImageAsset(img);
    }
    await question.deleteOne();
  }

  const remainingAnswers = await Answer.find({ authorId: userId }).select("_id");
  const remainingAnswerIds = remainingAnswers.map((a) => a._id);
  if (remainingAnswerIds.length) {
    await Comment.deleteMany({
      targetType: "answer",
      targetId: { $in: remainingAnswerIds },
    });
    await AnswerVote.deleteMany({ answerId: { $in: remainingAnswerIds } });
  }
  await Answer.deleteMany({ authorId: userId });

  await Comment.deleteMany({ authorId: userId });
  await AnswerVote.deleteMany({ userId: userId });
  await UserRecentAnswer.deleteMany({ userId: userId });
  await UserDashboardStat.deleteMany({ userId: userId });
  await UserModeration.deleteMany({ userId: String(userId) });
  await Notification.deleteMany({ email });
  await Report.deleteMany({ reportedBy: String(userId) });

  await User.deleteOne({ _id: userId });
}

const listUsers = async (req, res) => {
  try {
    const roleQ = req.query.role;
    const query = {};
    if (roleQ && ["user", "moderator", "admin"].includes(String(roleQ))) {
      query.role = roleQ;
    }

    const [total, blockedCount, users] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isBlocked: true }),
      User.find(query)
        .select("firstName lastName email role isBlocked")
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const activeCount = total - blockedCount;

    const rows = users.map((u) => ({
      id: String(u._id),
      name: `${u.firstName} ${u.lastName}`.trim(),
      email: u.email,
      role: u.role,
      status: u.isBlocked ? "Blocked" : "Active",
    }));

    return res.status(200).json({
      success: true,
      data: {
        stats: {
          total,
          active: activeCount,
          blocked: blockedCount,
        },
        users: rows,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const patchUserBlock = async (req, res) => {
  try {
    const { isBlocked } = req.body;
    if (typeof isBlocked !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isBlocked (boolean) is required",
      });
    }

    const target = await User.findById(req.params.id);
    if (!target) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (target._id.equals(req.user._id)) {
      return res.status(400).json({
        success: false,
        message: "You cannot change your own block status",
      });
    }

    if (req.user.role === "moderator" && target.role !== "user") {
      return res.status(403).json({
        success: false,
        message: "Moderators can only block student accounts",
      });
    }

    target.isBlocked = isBlocked;
    await target.save();

    return res.status(200).json({
      success: true,
      data: {
        id: String(target._id),
        isBlocked: target.isBlocked,
        status: target.isBlocked ? "Blocked" : "Active",
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const deleteUserAdmin = async (req, res) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (target._id.equals(req.user._id)) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your own account here",
      });
    }

    if (req.user.role === "moderator" && target.role !== "user") {
      return res.status(403).json({
        success: false,
        message: "Moderators can only delete student accounts",
      });
    }

    await purgeUserContentFixed(target);

    return res.status(200).json({
      success: true,
      message: "User deleted",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  listUsers,
  patchUserBlock,
  deleteUserAdmin,
};
