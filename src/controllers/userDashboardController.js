const User = require("../models/user");
const Notification = require("../models/Notification");
const UserDashboardStat = require("../models/UserDashboardStat");
const UserRecentAnswer = require("../models/UserRecentAnswer");

const getMyDashboardOverview = async (req, res) => {
  try {
    const userId = req.user?._id;
    const email = req.user?.email;

    const [user, stats, unreadNotifications] = await Promise.all([
      User.findById(userId),
      UserDashboardStat.findOne({ userId }),
      Notification.countDocuments({ email, isRead: false }),
    ]);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        profile: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          name: `${user.firstName} ${user.lastName}`,
          email: user.email,
          role: user.role,
          faculty: user.faculty,
          academicYear: user.academicYear,
          phone: user.phone,
        },
        stats: {
          reputationPoints: stats?.reputationPoints ?? 0,
          myQuestions: stats?.myQuestions ?? 0,
          myAnswers: stats?.myAnswers ?? 0,
          communitiesJoined: stats?.communitiesJoined ?? 0,
          unreadNotifications,
        },
        loginActivity: (user.loginLogs || [])
          .slice()
          .reverse()
          .map((log) => ({
            time: log.time,
            ip: log.ip,
            status: log.status,
          })),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard overview",
      error: error.message,
    });
  }
};

const getMyRecentAnswers = async (req, res) => {
  try {
    const userId = req.user?._id;
    const rows = await UserRecentAnswer.find({ userId })
      .sort({ answeredAt: -1 })
      .lean();

    const data = rows.map((row) => ({
      id: String(row._id),
      questionId: row.questionId,
      questionTitle: row.questionTitle,
      answerSnippet: row.answerSnippet,
      fullAnswer: row.fullAnswer,
      upvotes: row.upvotes,
      isBestAnswer: row.isBestAnswer,
      date: row.answeredAt,
    }));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch recent answers",
      error: error.message,
    });
  }
};

module.exports = {
  getMyDashboardOverview,
  getMyRecentAnswers,
};
