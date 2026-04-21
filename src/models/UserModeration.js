const mongoose = require("mongoose");

const userModerationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    unique: true
  },

  warningCount: { type: Number, default: 0 },
  suspensionCount: { type: Number, default: 0 },

  isSuspended: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },

  events: [
    {
      action: String,
      reason: String,
      by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      reportId: mongoose.Schema.Types.ObjectId,
      createdAt: { type: Date, default: Date.now }
    }
  ]

}, { timestamps: true });

module.exports = mongoose.model("UserModeration", userModerationSchema);
