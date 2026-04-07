const mongoose = require("mongoose");

// Stores a single upvote per user per answer (idempotent).
const answerVoteSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    answerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Answer",
      required: true,
      index: true,
    },
    value: {
      type: Number,
      enum: [1, -1],
      default: 1,
    },
  },
  { timestamps: true }
);

answerVoteSchema.index({ userId: 1, answerId: 1 }, { unique: true });

module.exports = mongoose.model("AnswerVote", answerVoteSchema);

