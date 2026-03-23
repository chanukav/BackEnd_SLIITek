const Report = require('../models/Report');

// Create a new report (User reporting content)
exports.createReport = async (req, res) => {
    try {
        const { targetType, targetId, reportedBy, reason, details } = req.body;
        
        const newReport = await Report.create({
            targetType,
            targetId,
            reportedBy,
            reason,
            details
        });

        // Optional: Auto-hide content if report count exceeds a threshold (e.g. 5)
        const reportCount = await Report.countDocuments({ targetType, targetId });
        if (reportCount >= 5) {
            // In a fully implemented system, we would:
            // if (targetType === 'question' || targetType === 'answer') {
            //     await Post.findByIdAndUpdate(targetId, { hidden: true });
            // }
            console.log(`[Auto-Moderation] Content ${targetType}:${targetId} received ${reportCount} reports. Auto-hiding content...`);
        }

        res.status(201).json({
            success: true,
            data: newReport
        });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

// Get all reports (Moderator Review Queue)
exports.getReports = async (req, res) => {
    try {
        const { status } = req.query;
        // Allows filtering by status (e.g., ?status=pending)
        const query = status ? { status } : {};
        
        const reports = await Report.find(query).sort({ createdAt: -1 });
        
        res.status(200).json({ 
            success: true, 
            count: reports.length, 
            data: reports 
        });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

// Review a report and take action (Moderator Action)
exports.reviewReport = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, action, reviewedBy } = req.body;

        const report = await Report.findById(id);
        if (!report) {
            return res.status(404).json({ success: false, message: "Report not found" });
        }

        // Update report status
        report.status = status || report.status;
        report.action = action || report.action;
        report.reviewedBy = reviewedBy || report.reviewedBy;
        report.reviewedAt = Date.now();

        // Perform moderation actions
        if (action === "removed") {
            // Simulation of content removal
            console.log(`[Moderation] Content ${report.targetType}:${report.targetId} removed by moderator ${reviewedBy}`);
            // e.g. await Post.findByIdAndDelete(report.targetId);
        } else if (action === "warning" || action === "suspend" || action === "ban") {
            // Simulation of user warning/suspension
            console.log(`[Moderation] User action ${action} applied based on report ${report._id} by moderator ${reviewedBy}`);
            // Would look up the content's author and apply action to User model
        }

        await report.save();

        res.status(200).json({
            success: true,
            data: report
        });

    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};
