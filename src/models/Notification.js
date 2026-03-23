const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  email: {
    type: String, // Kept as String to support "global" and non-ObjectId types
    required: true
  },
  type: {
    type: String,
    enum: ["answer", "comment", "best_answer", "report_update", "announcement"],
    required: true
  },
  entityType: {
    type: String,
    required: true
  },
  entityId: {
    type: String, // Changed to String for flexibility
    required: true
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  isRead: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
notificationSchema.index({ email: 1, isRead: 1 });
notificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
