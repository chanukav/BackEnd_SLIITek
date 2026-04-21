const Report = require("../models/Report");
const ModerationTarget = require("../models/ModerationTarget");
const UserModeration = require("../models/UserModeration");
const User = require("../models/user");
const { notificationQueue } = require("../queues/notificationQueue");
const Question = require("../models/Question");
const Answer = require("../models/Answer");
const Comment = require("../models/Comment");

const AUTO_HIDE_THRESHOLD = Number(process.env.REPORT_AUTO_HIDE_THRESHOLD || 5);
const { detectSpam } = require("../utils/spamDetector");

const MAX_DETAILS_LENGTH = Number(process.env.REPORT_MAX_DETAILS_LENGTH || 1000);
const VALID_ACTIONS = ["none", "removed", "warning", "suspend", "ban"];
const VALID_STATUSES = ["pending", "reviewed", "dismissed", "action_taken"];

const resolveActionUserId = async (report, providedActionUserId) => {
    if (providedActionUserId) return providedActionUserId;
    const targetId = String(report.targetId || "").trim();
    if (!targetId) return null;

    if (report.targetType === "question") {
        const question = await Question.findById(targetId).select("authorId");
        return question?.authorId ? String(question.authorId) : null;
    }

    if (report.targetType === "answer") {
        const answer = await Answer.findById(targetId).select("authorId");
        return answer?.authorId ? String(answer.authorId) : null;
    }

    if (report.targetType === "comment") {
        const comment = await Comment.findById(targetId).select("authorId");
        return comment?.authorId ? String(comment.authorId) : null;
    }

    return null;
};

const upsertTargetState = async ({ targetType, targetId, action = "none", actionBy = null }) => {
    const reportCount = await Report.countDocuments({ targetType, targetId });
    const shouldAutoHide = AUTO_HIDE_THRESHOLD > 0 && reportCount >= AUTO_HIDE_THRESHOLD;

    const update = {
        reportCount,
        lastReportedAt: new Date(),
        lastAction: action,
        lastActionBy: actionBy,
        lastActionAt: new Date()
    };

    if (shouldAutoHide) {
        update.isHidden = true;
        update.hiddenReason = `auto_hidden_after_${AUTO_HIDE_THRESHOLD}_reports`;
        update.hiddenAt = new Date();
    }

    return ModerationTarget.findOneAndUpdate(
        { targetType, targetId },
        update,
        { returnDocument: 'after', upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
};

const { reportQueue } = require("../queues/reportQueue");

exports.createReport = async (req, res) => {
    try {
        const { targetType, targetId, reason, details = "" } = req.body;
        const reportedBy = req.user ? req.user._id : req.body.reportedBy;

        if (!targetType || !targetId || !reportedBy || !reason) {
            return res.status(400).json({
                success: false,
                message: "targetType, targetId, reportedBy and reason are required"
            });
        }

        if (details.length > MAX_DETAILS_LENGTH) {
            return res.status(400).json({
                success: false,
                message: `details cannot exceed ${MAX_DETAILS_LENGTH} characters`
            });
        }

        const newReport = await Report.create({
            targetType,
            targetId,
            reportedBy,
            reason,
            details,
            autoFlagged: false // will be processed by worker
        });

        // Add to Redis Queue instead of processing directly
        await reportQueue.add("process-report", {
            reportId: newReport._id
        });

        // Real-Time Moderation: broadcast to admins
        try {
            const io = require("../utils/socket").getIO();
            io.emit("new-report", newReport);
        } catch (socketErr) {
            console.error("Socket error on new report:", socketErr);
        }

        return res.status(201).json({
            success: true,
            data: newReport,
            meta: { message: "Report added to processing queue" }
        });
    } catch (error) {
        if (error && error.code === 11000) {
            const existingReport = await Report.findOne({
                targetType: req.body.targetType,
                targetId: req.body.targetId,
                reportedBy: req.user ? req.user._id : req.body.reportedBy
            });

            return res.status(200).json({
                success: true,
                data: existingReport || null,
                meta: {
                    duplicate: true,
                    message: "You have already reported this content"
                }
            });
        }
        return res.status(400).json({ success: false, error: error.message });
    }
};

exports.getReports = async (req, res) => {
    try {
        const { status, targetType, reason, page = 1, limit = 20 } = req.query;
        const query = {};

        if (status) query.status = status;
        if (targetType) query.targetType = targetType;
        if (reason) query.reason = reason;

        const pageNumber = Math.max(Number(page) || 1, 1);
        const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 100);
        const skip = (pageNumber - 1) * pageSize;

        const [reports, total] = await Promise.all([
            Report.find(query).sort({ createdAt: -1 }).skip(skip).limit(pageSize),
            Report.countDocuments(query)
        ]);

        return res.status(200).json({
            success: true,
            count: reports.length,
            total,
            page: pageNumber,
            pages: Math.ceil(total / pageSize) || 1,
            data: reports
        });
    } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
    }
};

exports.getQueueSummary = async (req, res) => {
    try {
        const [statusCounts, topTargets] = await Promise.all([
            Report.aggregate([
                { $group: { _id: "$status", count: { $sum: 1 } } }
            ]),
            Report.aggregate([
                {
                    $group: {
                        _id: { targetType: "$targetType", targetId: "$targetId" },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { count: -1 } },
                { $limit: 10 }
            ])
        ]);

        return res.status(200).json({
            success: true,
            data: {
                statusCounts,
                topReportedTargets: topTargets
            }
        });
    } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
    }
};

exports.reviewReport = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, action = "none", moderationNotes = "", actionUserId = null } = req.body;
        const reviewedBy = req.user ? req.user._id : req.body.reviewedBy;

        if (!reviewedBy) {
            return res.status(400).json({ success: false, message: "Moderator authentication required (reviewedBy missing)" });
        }

        if (status && !VALID_STATUSES.includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status" });
        }

        if (!VALID_ACTIONS.includes(action)) {
            return res.status(400).json({ success: false, message: "Invalid action" });
        }

        const report = await Report.findById(id);
        if (!report) {
            return res.status(404).json({ success: false, message: "Report not found" });
        }

        const finalStatus = status || (action === "none" ? "reviewed" : "action_taken");

        report.status = finalStatus;
        report.action = action;
        report.reviewedBy = reviewedBy;
        report.reviewedAt = Date.now();
        report.moderationNotes = moderationNotes;
        await report.save();

        const targetUpdate = await upsertTargetState({
            targetType: report.targetType,
            targetId: report.targetId,
            action,
            actionBy: reviewedBy
        });

        // Audit Logging
        const AuditLog = require("../models/AuditLog");
        await AuditLog.create({
            action: action.toUpperCase() || "REVIEW_REPORT",
            performedBy: req.user ? req.user._id : reviewedBy,
            targetId: actionUserId || report.reportedBy || report._id,
            metadata: { reason: report.reason, reportId: id, details: moderationNotes }
        });

        if (action === "removed") {
            targetUpdate.isHidden = true;
            targetUpdate.hiddenReason = "removed_by_moderator";
            targetUpdate.hiddenAt = new Date();
            await targetUpdate.save();
            console.log(
                `[Moderation] Content ${report.targetType}:${report.targetId} removed by moderator ${reviewedBy}`
            );
        }

        const resolvedActionUserId = await resolveActionUserId(report, actionUserId);

        if (["warning", "suspend", "ban"].includes(action) && resolvedActionUserId) {
            const userModeration = await UserModeration.findOneAndUpdate(
                { userId: resolvedActionUserId },
                {
                    $setOnInsert: { userId: resolvedActionUserId },
                    $set: {
                        lastAction: action,
                        lastActionAt: new Date(),
                        isSuspended: action === "suspend",
                        isBanned: action === "ban"
                    },
                    $inc: {
                        warningCount: action === "warning" ? 1 : 0,
                        suspensionCount: action === "suspend" ? 1 : 0
                    },
                    $push: {
                        events: {
                            action,
                            by: reviewedBy,
                            reason: moderationNotes,
                            reportId: String(report._id),
                            createdAt: new Date()
                        }
                    }
                },
                { returnDocument: 'after', upsert: true, runValidators: true, setDefaultsOnInsert: true }
            );
            console.log(
                `[Moderation] User ${resolvedActionUserId} received ${action} (moderator: ${reviewedBy}, report: ${report._id})`
            );

            const actionUser = await User.findById(resolvedActionUserId).select("email");
            if (actionUser?.email) {
                const actionLabel = action.charAt(0).toUpperCase() + action.slice(1);
                const typeLabel = String(report.targetType || "content").toLowerCase();
                const notes = typeof moderationNotes === "string" ? moderationNotes.trim() : "";
                const body = notes
                    ? `${actionLabel} issued for reported ${typeLabel}. Reason: ${notes}`
                    : `${actionLabel} issued for reported ${typeLabel}.`;

                await notificationQueue.add("sendNotification", {
                    email: actionUser.email.toLowerCase(),
                    type: "report_update",
                    title: `Moderation ${actionLabel}`,
                    message: body,
                    entityType: "Report",
                    entityId: String(report._id)
                });
            }

            return res.status(200).json({
                success: true,
                data: report,
                moderationTarget: targetUpdate,
                userModeration
            });
        }

        return res.status(200).json({
            success: true,
            data: report,
            moderationTarget: targetUpdate
        });
    } catch (error) {
        console.error("reviewReport Error:", error);
        return res.status(400).json({ success: false, error: String(error), stack: error.stack, message: error.message });
    }
};

exports.getTargetModerationState = async (req, res) => {
    try {
        const { targetType, targetId } = req.params;
        const state = await ModerationTarget.findOne({ targetType, targetId });

        return res.status(200).json({
            success: true,
            data: state || {
                targetType,
                targetId,
                reportCount: 0,
                isHidden: false,
                hiddenReason: "",
                hiddenAt: null,
                lastAction: "none"
            }
        });
    } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
    }
};

exports.getUserModerationState = async (req, res) => {
    try {
        const { userId } = req.params;
        const state = await UserModeration.findOne({ userId });
        return res.status(200).json({
            success: true,
            data: state || {
                userId,
                warningCount: 0,
                suspensionCount: 0,
                isSuspended: false,
                isBanned: false,
                lastAction: "none",
                events: []
            }
        });
    } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
    }
};
