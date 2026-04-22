const mongoose = require("mongoose");

const answerSchema = new mongoose.Schema(
  {
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      required: true,
      index: true,
    },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Text can be empty when the answer has image(s); API validates text-or-image on create/update.
    body: {
      type: String,
      trim: true,
      default: "",
    },
    voteScore: {
      type: Number,
      default: 0,
    },
    dislikeCount: {
      type: Number,
      default: 0,
    },
    isBest: {
      type: Boolean,
      default: false,
    },
    parentAnswerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Answer",
      default: null,
      index: true,
    },
    images: [
      {
        url: { type: String, default: "" },
        blobName: { type: String, default: "" },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Answer", answerSchema);
