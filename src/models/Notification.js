const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  email: {
    type: String, // Kept as String to support "global" and non-ObjectId types
    required: true,
    trim: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        return v === 'all' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: "Invalid email address"
    }
  },
  senderEmail: {
    type: String,
    lowercase: true,
    trim: true
  },
  type: {
    type: String,
    enum: ["answer", "comment", "best_answer", "report_update", "announcement"],
    required: true
  },
  entityType: {
    type: String,
    required: true,
    trim: true,
    maxlength: [80, "Entity type must be at most 80 characters"],
  },
  entityId: {
    type: String, // Changed to String for flexibility
    required: true,
    trim: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
    minlength: [3, "Title must be at least 3 characters"],
    maxlength: [120, "Title must be at most 120 characters"],
  },
  message: {
    type: String,
    required: true,
    trim: true,
    minlength: [5, "Message must be at least 5 characters"],
    maxlength: [800, "Message must be at most 800 characters"],
  },
  isRead: {
    type: Boolean,
    default: false
  },
  readBy: {
    type: [String],
    default: []
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
