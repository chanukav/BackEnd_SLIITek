const mongoose = require("mongoose");

const moderationTargetSchema = new mongoose.Schema({
  targetType: {
    type: String,
    enum: ["question", "answer", "comment"],
    required: true
  },
  targetId: {
    type: String,
    required: true
  },
  reportCount: {
    type: Number,
    default: 0
  },
  isHidden: {
    type: Boolean,
    default: false
  },
  hiddenReason: {
    type: String,
    default: ""
  },
  hiddenAt: {
    type: Date,
    default: null
  },
  lastReportedAt: {
    type: Date,
    default: null
  },
  lastAction: {
    type: String,
    enum: ["none", "removed", "warning", "suspend", "ban"],
    default: "none"
  },
  lastActionBy: {
    type: String,
    default: null
  },
  lastActionAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

moderationTargetSchema.index({ targetType: 1, targetId: 1 }, { unique: true });
moderationTargetSchema.index({ isHidden: 1 });
moderationTargetSchema.index({ reportCount: -1 });

module.exports = mongoose.model("ModerationTarget", moderationTargetSchema);
