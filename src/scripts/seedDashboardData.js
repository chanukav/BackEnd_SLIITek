const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const User = require("../models/user");
const Notification = require("../models/Notification");
const UserDashboardStat = require("../models/UserDashboardStat");
const UserRecentAnswer = require("../models/UserRecentAnswer");
const { USER_NOTIFICATION_TTL_MS } = require("../utils/notificationExpiry");

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const statByRole = {
  admin: { reputationPoints: 980, myQuestions: 25, myAnswers: 120, communitiesJoined: 6 },
  moderator: { reputationPoints: 640, myQuestions: 18, myAnswers: 77, communitiesJoined: 5 },
  user: { reputationPoints: 210, myQuestions: 9, myAnswers: 15, communitiesJoined: 3 },
};

const sampleRecentAnswers = (userId) => [
  {
    userId,
    questionId: "q-itpm-zip",
    questionTitle: "How to submit ITPM assignment ZIP?",
    answerSnippet: "Include project without node_modules...",
    fullAnswer:
      "Include your project folder without node_modules, then zip the root. Upload via the LMS submission link before the deadline. Double-check the rubric PDF for naming rules.",
    upvotes: 15,
    isBestAnswer: true,
    answeredAt: new Date("2026-03-24T12:00:00.000Z"),
  },
  {
    userId,
    questionId: "q-rest-api",
    questionTitle: "What is REST API?",
    answerSnippet: "REST is an architectural style...",
    fullAnswer:
      "REST is an architectural style for networked applications. It uses HTTP methods (GET, POST, PUT, DELETE) and stateless communication between client and server.",
    upvotes: 8,
    isBestAnswer: false,
    answeredAt: new Date("2026-03-23T12:00:00.000Z"),
  },
  {
    userId,
    questionId: "q-mongo-connect",
    questionTitle: "How to connect MongoDB?",
    answerSnippet: "Use mongoose.connect() with URI...",
    fullAnswer:
      "Use mongoose.connect(process.env.MONGO_URI) after loading dotenv. Handle connection errors and listen for connected/disconnected events in production.",
    upvotes: 20,
    isBestAnswer: true,
    answeredAt: new Date("2026-03-22T12:00:00.000Z"),
  },
  {
    userId,
    questionId: "q-tcp-udp",
    questionTitle: "Difference between TCP and UDP?",
    answerSnippet: "TCP is reliable, UDP is faster...",
    fullAnswer:
      "TCP provides reliable, ordered delivery with congestion control. UDP is connectionless and faster but may drop packets—use it when latency matters more than reliability.",
    upvotes: 5,
    isBestAnswer: false,
    answeredAt: new Date("2026-03-21T12:00:00.000Z"),
  },
  {
    userId,
    questionId: "q-summer",
    questionTitle: "Summer answers",
    answerSnippet: "TCP is reliable, UDP is faster...",
    fullAnswer:
      "Same concepts apply: compare reliability, ordering, and use cases when answering summer exam-style questions.",
    upvotes: 5,
    isBestAnswer: false,
    answeredAt: new Date("2026-03-21T14:00:00.000Z"),
  },
];

const seedDashboardData = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing in .env");
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB connected for dashboard seed.");

  const users = await User.find({
    email: { $in: ["admin@sliitek.com", "moderator@sliitek.com", "it100000@my.sliit.lk"] },
  });

  for (const user of users) {
    const defaults = statByRole[user.role] || statByRole.user;

    await UserDashboardStat.findOneAndUpdate(
      { userId: user._id },
      { $set: defaults },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );

    await Notification.findOneAndUpdate(
      {
        email: user.email,
        type: "announcement",
        entityType: "dashboard",
        entityId: String(user._id),
      },
      {
        $set: {
          title: "Welcome to your dashboard",
          message: "Your personalized dashboard data is now live.",
          isRead: false,
          expiresAt: new Date(Date.now() + USER_NOTIFICATION_TTL_MS),
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );

    await UserRecentAnswer.deleteMany({ userId: user._id });
    await UserRecentAnswer.insertMany(sampleRecentAnswers(user._id));

    await Notification.findOneAndUpdate(
      {
        email: user.email,
        type: "answer",
        entityType: "question",
        entityId: `${user._id}-q1`,
      },
      {
        $set: {
          title: "New activity on your post",
          message: "Someone answered one of your questions.",
          isRead: false,
          expiresAt: new Date(Date.now() + USER_NOTIFICATION_TTL_MS),
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );

    console.log(`Seeded dashboard data for: ${user.email}`);
  }

  console.log("Dashboard data seed completed.");
};

seedDashboardData()
  .catch((error) => {
    console.error("Dashboard seed failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
    console.log("MongoDB connection closed.");
  });
