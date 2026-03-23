const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  userId: {
    type: String, // later you can use ObjectId
    required: true
  },
  type: {
    type: String,
    enum: ["NEW_ANSWER", "COMMENT", "BEST_ANSWER", "ANNOUNCEMENT"],
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

module.exports = mongoose.model("Notification", notificationSchema);
