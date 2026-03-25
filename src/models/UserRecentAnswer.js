const mongoose = require("mongoose");

const userRecentAnswerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    questionId: {
      type: String,
      required: true,
      trim: true,
    },
    questionTitle: {
      type: String,
      required: true,
      trim: true,
    },
    answerSnippet: {
      type: String,
      required: true,
      trim: true,
    },
    fullAnswer: {
      type: String,
      required: true,
      trim: true,
    },
    upvotes: {
      type: Number,
      default: 0,
      min: 0,
    },
    isBestAnswer: {
      type: Boolean,
      default: false,
    },
    answeredAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

userRecentAnswerSchema.index({ userId: 1, answeredAt: -1 });

module.exports = mongoose.model("UserRecentAnswer", userRecentAnswerSchema);
