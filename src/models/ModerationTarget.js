const mongoose = require("mongoose");

const moderationTargetSchema = new mongoose.Schema({
  targetType: String,
  targetId: String,

  reportCount: {
    type: Number,
    default: 0
  },
  weightedScore: {
    type: Number,
    default: 0
  },

  isHidden: {
    type: Boolean,
    default: false
  },

  hiddenReason: String,
  lastAction: String

}, { timestamps: true });

moderationTargetSchema.index({ targetType: 1, targetId: 1 }, { unique: true });

module.exports = mongoose.model("ModerationTarget", moderationTargetSchema);
