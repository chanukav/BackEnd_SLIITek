const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema({
  targetType: {
    type: String,
    enum: ["question", "answer", "comment"],
    required: true
  },
  targetId: {
    type: String, // could be ObjectId based on usage, keeping String for generic fallback or if using ObjectId later
    required: true
  },
  reportedBy: {
    type: String, // String/ObjectId for user
    required: true
  },
  reason: {
    type: String,
    enum: ["spam", "misinformation", "abuse", "other"],
    required: true
  },
  details: {
    type: String,
    default: ""
  },
  status: {
    type: String,
    enum: ["pending", "reviewed", "dismissed", "action_taken"],
    default: "pending"
  },
  reviewedBy: {
    type: String, // Mod/Admin userId
    default: null
  },
  action: {
    type: String,
    enum: ["none", "removed", "warning", "suspend", "ban"],
    default: "none"
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  reviewedAt: {
    type: Date,
    default: null
  },
  autoFlagged: {
    type: Boolean,
    default: false
  },
  moderationNotes: {
    type: String,
    default: ""
  }
});

// Indexes based on requirements
reportSchema.index({ status: 1 });
reportSchema.index({ targetType: 1, targetId: 1 });
reportSchema.index({ createdAt: -1 });
reportSchema.index({ targetType: 1, targetId: 1, reportedBy: 1 }, { unique: true });

module.exports = mongoose.model("Report", reportSchema);
