const mongoose = require("mongoose");

const QUESTION_CATEGORIES = [
  "Academic",
  "Career & Internships",
  "Campus Life",
  "Technical / Programming Help",
  "Study Resources",
  "Clubs & Events",
  "General / Other",
];

const questionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: QUESTION_CATEGORIES,
      default: "General / Other",
      trim: true,
    },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["open", "solved", "locked"],
      default: "open",
    },
    bestAnswerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Answer",
      default: null,
    },
    voteScore: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Question", questionSchema);
