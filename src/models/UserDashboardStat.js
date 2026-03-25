const mongoose = require("mongoose");

const userDashboardStatSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    reputationPoints: {
      type: Number,
      default: 0,
      min: 0,
    },
    myQuestions: {
      type: Number,
      default: 0,
      min: 0,
    },
    myAnswers: {
      type: Number,
      default: 0,
      min: 0,
    },
    communitiesJoined: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("UserDashboardStat", userDashboardStatSchema);
