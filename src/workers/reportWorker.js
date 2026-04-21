const { Worker } = require("bullmq");
const { detectSpam } = require("../utils/spamDetector");
const Report = require("../models/Report");
const ModerationTarget = require("../models/ModerationTarget");
const User = require("../models/user");
const { connection } = require("../queues/reportQueue");

const AUTO_HIDE_THRESHOLD = Number(process.env.REPORT_AUTO_HIDE_THRESHOLD || 5);

const reportWorker = new Worker(
  "reportQueue",
  async (job) => {
    const { reportId } = job.data;
    
    // Find report
    const report = await Report.findById(reportId);
    if (!report) return;

    // Detect Spam
    const autoFlagged = detectSpam(report.details);
    report.autoFlagged = autoFlagged;
    await report.save();

    // Smart Reporting / Weighted Score logic
    let user = await User.findById(report.reportedBy);
    const itemScore = user && user.trustScore ? user.trustScore : 1;

    let target = await ModerationTarget.findOne({
      targetType: report.targetType,
      targetId: report.targetId
    });

    if (!target) {
      target = await ModerationTarget.create({
        targetType: report.targetType,
        targetId: report.targetId,
        reportCount: 0,
        weightedScore: 0
      });
    }

    target.reportCount++;
    if (target.weightedScore === undefined) target.weightedScore = 0;
    target.weightedScore += itemScore;

    // Hide logic
    // Using requirement: target.weightedScore >= 10 OR count threshold
    if (target.reportCount >= AUTO_HIDE_THRESHOLD || target.weightedScore >= 10) {
      target.isHidden = true;
      target.hiddenReason = "auto_hidden_threshold";
    }

    await target.save();
    console.log(`[Worker] Processed Report ${reportId}. Target ${target.targetId} isHidden=${target.isHidden}`);
  },
  { connection }
);

reportWorker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed successfully`);
});

reportWorker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job.id} failed:`, err);
});

module.exports = reportWorker;
