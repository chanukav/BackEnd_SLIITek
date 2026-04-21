const mongoose = require("mongoose");

const auditSchema = new mongoose.Schema({
  action: String,
  performedBy: String,
  targetId: String,
  metadata: Object
}, { timestamps: true });

module.exports = mongoose.model("AuditLog", auditSchema);
