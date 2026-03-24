const Report = require("../models/Report");
const ModerationTarget = require("../models/ModerationTarget");
const UserModeration = require("../models/UserModeration");

const AUTO_HIDE_THRESHOLD = Number(process.env.REPORT_AUTO_HIDE_THRESHOLD || 5);
const ENABLE_SPAM_DETECTION = (process.env.REPORT_ENABLE_SPAM_DETECTION || "true") !== "false";
const BLACKLIST_WORDS = (process.env.REPORT_BLACKLIST_WORDS || "scam,fake,spam,click here")
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
const MAX_DETAILS_LENGTH = Number(process.env.REPORT_MAX_DETAILS_LENGTH || 1000);

const VALID_ACTIONS = ["none", "removed", "warning", "suspend", "ban"];
const VALID_STATUSES = ["pending", "reviewed", "dismissed", "action_taken"];

const isLikelySpamText = (text = "") => {
    if (!ENABLE_SPAM_DETECTION || !text) return false;
    const normalized = String(text).toLowerCase();
    const repeatedPunctuation = /(.)\1{7,}/.test(normalized);
    const tooManyLinks = (normalized.match(/https?:\/\//g) || []).length >= 3;
    const blacklisted = BLACKLIST_WORDS.some((word) => normalized.includes(word));
    return repeatedPunctuation || tooManyLinks || blacklisted;
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
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
};

exports.createReport = async (req, res) => {
    try {
        const { targetType, targetId, reportedBy, reason, details = "" } = req.body;

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

        const autoFlagged = isLikelySpamText(details);

        const newReport = await Report.create({
            targetType,
            targetId,
            reportedBy,
            reason,
            details,
            autoFlagged
        });

        const targetState = await upsertTargetState({ targetType, targetId });

        if (targetState.isHidden) {
            console.log(
                `[Auto-Moderation] Content ${targetType}:${targetId} auto-hidden after ${targetState.reportCount} reports`
            );
        }

        return res.status(201).json({
            success: true,
            data: newReport,
            meta: {
                autoFlagged,
                targetHidden: targetState.isHidden,
                reportCount: targetState.reportCount
            }
        });
    } catch (error) {
        if (error && error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "You have already reported this content"
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
        const { status, action = "none", reviewedBy, moderationNotes = "", actionUserId = null } = req.body;

        if (!reviewedBy) {
            return res.status(400).json({ success: false, message: "reviewedBy is required" });
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

        if (action === "removed") {
            targetUpdate.isHidden = true;
            targetUpdate.hiddenReason = "removed_by_moderator";
            targetUpdate.hiddenAt = new Date();
            await targetUpdate.save();
            console.log(
                `[Moderation] Content ${report.targetType}:${report.targetId} removed by moderator ${reviewedBy}`
            );
        }

        if (["warning", "suspend", "ban"].includes(action) && actionUserId) {
            const userModeration = await UserModeration.findOneAndUpdate(
                { userId: actionUserId },
                {
                    $setOnInsert: { userId: actionUserId },
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
                { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
            );
            console.log(
                `[Moderation] User ${actionUserId} received ${action} (moderator: ${reviewedBy}, report: ${report._id})`
            );

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
        return res.status(400).json({ success: false, error: error.message });
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
