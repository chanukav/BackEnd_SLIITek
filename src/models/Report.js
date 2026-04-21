const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema({
  targetType: {
    type: String,
    enum: ["question", "answer", "comment"],
    required: true
  },
  targetId: {
    type: String,
    required: true,
    index: true
  },
  reportedBy: {
    type: String,
    ref: "User"
  },
  reason: {
    type: String,
    enum: ["spam", "misinformation", "abuse", "other"],
    required: true
  },
  details: String,
  status: {
    type: String,
    enum: ["pending", "reviewed", "dismissed", "action_taken"],
    default: "pending",
    index: true
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  action: {
    type: String,
    enum: ["none", "removed", "warning", "suspend", "ban"],
    default: "none"
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  autoFlagged: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

// Preserving the unique index from the previous schema so a user can't report the same target multiple times
reportSchema.index({ targetType: 1, targetId: 1, reportedBy: 1 }, { unique: true });

module.exports = mongoose.model("Report", reportSchema);
