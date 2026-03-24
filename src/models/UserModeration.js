const mongoose = require("mongoose");

const moderationEventSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ["warning", "suspend", "ban"],
    required: true
  },
  by: {
    type: String,
    required: true
  },
  reason: {
    type: String,
    default: ""
  },
  reportId: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const userModerationSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true
  },
  warningCount: {
    type: Number,
    default: 0
  },
  suspensionCount: {
    type: Number,
    default: 0
  },
  isSuspended: {
    type: Boolean,
    default: false
  },
  isBanned: {
    type: Boolean,
    default: false
  },
  lastAction: {
    type: String,
    enum: ["none", "warning", "suspend", "ban"],
    default: "none"
  },
  lastActionAt: {
    type: Date,
    default: null
  },
  events: {
    type: [moderationEventSchema],
    default: []
  }
}, { timestamps: true });

module.exports = mongoose.model("UserModeration", userModerationSchema);
