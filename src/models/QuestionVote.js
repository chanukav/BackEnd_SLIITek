const mongoose = require("mongoose");

// Stores a single upvote per user per question (idempotent).
const questionVoteSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

questionVoteSchema.index({ userId: 1, questionId: 1 }, { unique: true });

module.exports = mongoose.model("QuestionVote", questionVoteSchema);
