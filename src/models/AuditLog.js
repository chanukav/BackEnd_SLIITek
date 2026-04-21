const mongoose = require("mongoose");

const auditSchema = new mongoose.Schema({
  action: String,
  performedBy: mongoose.Schema.Types.ObjectId,
  targetId: mongoose.Schema.Types.ObjectId,
  metadata: Object
}, { timestamps: true });

module.exports = mongoose.model("AuditLog", auditSchema);
