const Notification = require('../models/Notification');
const mongoose = require('mongoose');
const { addClient, removeClient, pushToClient } = require('../utils/sseClients');
const { notificationQueue } = require('../queues/notificationQueue');
const { notExpiredWhere, isNotificationActive } = require('../utils/notificationExpiry');
const { notHiddenForRecipient } = require('../utils/notificationInboxFilters');

const staffSender = (n) => {
    const s = n?.senderEmail;
    return typeof s === 'string' && s.trim().length > 0;
};

function mapInboxIsReadForRecipient(notifications, normalizedEmail) {
    return notifications.map((n) => {
        if (n.email === 'all') {
            n.isRead = !!(n.readBy && n.readBy.includes(normalizedEmail));
        } else if (staffSender(n)) {
            const inReadBy = !!(n.readBy && n.readBy.includes(normalizedEmail));
            const legacyRead =
                String(n.email).toLowerCase() === normalizedEmail && n.isRead === true;
            n.isRead = inReadBy || legacyRead;
        }
        return n;
    });
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const escapeRegExp = (value) =>
    String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ─────────────────────────────────────────────
// SSE stream — one long-lived connection per client
// ─────────────────────────────────────────────
exports.sseStream = (req, res) => {
    const email = req.user.email.toLowerCase();

    // SSE headers
    res.writeHead(200, {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
        // Allow cross-origin SSE (CORS already handled globally, but keep explicit)
        'X-Accel-Buffering': 'no',
    });

    // Send an initial "connected" comment so the browser knows the stream is live
    res.write(': connected\n\n');

    // Keep-alive ping every 25 s (prevents proxy timeout / browser disconnect)
    const keepAlive = setInterval(() => {
        res.write(': ping\n\n');
    }, 25000);

    addClient(email, res);

    // Clean up when client disconnects
    req.on('close', () => {
        clearInterval(keepAlive);
        removeClient(email, res);
    });
};

// ─────────────────────────────────────────────
// Create a new notification and push via SSE
// ─────────────────────────────────────────────
exports.createNotification = async (req, res) => {
    try {
        const { email, type, title, message, entityType, entityId, questionId, answerId } = req.body;

        const allowedTypes = ["answer", "comment", "best_answer", "report_update", "announcement"];
        if (!type || !allowedTypes.includes(type)) {
            return res.status(400).json({
                success: false,
                message: `type must be one of: ${allowedTypes.join(", ")}`,
            });
        }

        const normalizedEmail =
            typeof email === "string" ? email.trim().toLowerCase() : email
        const normalizedTitle =
            typeof title === "string" ? title.trim() : title
        const normalizedMessage =
            typeof message === "string" ? message.trim() : message
        const normalizedEntityType =
            typeof entityType === "string" ? entityType.trim() : entityType
        const normalizedEntityId =
            typeof entityId === "string" ? entityId.trim() : entityId
        const normalizedQuestionId =
            typeof questionId === "string" ? questionId.trim() : ""
        const normalizedAnswerId =
            typeof answerId === "string" ? answerId.trim() : ""

        if (!normalizedEmail) {
            return res.status(400).json({ success: false, message: "Email is required" })
        }
        
        // If email is "all", it's a broadcast. Otherwise, validate the email format.
        if (normalizedEmail !== "all" && !emailRegex.test(normalizedEmail)) {
            return res.status(400).json({ success: false, message: "Valid email is required" })
        }
        if (!normalizedTitle || String(normalizedTitle).length < 3) {
            return res.status(400).json({ success: false, message: "Title is required (min 3 characters)" })
        }
        if (!normalizedMessage || String(normalizedMessage).length < 5) {
            return res.status(400).json({ success: false, message: "Message is required (min 5 characters)" })
        }

        const payload = {
            email: normalizedEmail,
            senderEmail: req.user.email.toLowerCase(),
            type,
            title: normalizedTitle,
            message: normalizedMessage,
            entityType: normalizedEntityType || 'System',
            entityId: normalizedEntityId || new mongoose.Types.ObjectId().toString()
        };

        if (normalizedQuestionId) {
            payload.questionId = normalizedQuestionId;
        }
        if (normalizedAnswerId) {
            payload.answerId = normalizedAnswerId;
        }

        // Add the notification job to the queue instead of saving directly
        await notificationQueue.add("sendNotification", payload, {
            attempts: 3,
            backoff: {
                type: "exponential",
                delay: 5000,
            },
        });

        res.status(202).json({ success: true, message: "Notification queued successfully" });
    } catch (error) {
        const status = error?.name === "ValidationError" ? 400 : 500
        res.status(status).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
// Get all notifications (Admin) — paginated + filtered
// ─────────────────────────────────────────────
exports.getAllNotifications = async (req, res) => {
    try {
        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const skip  = (page - 1) * limit;

        const filter = {};
        if (req.query.type && req.query.type !== 'all') {
            const allowedTypes = ['answer', 'comment', 'best_answer', 'report_update', 'announcement'];
            if (allowedTypes.includes(req.query.type)) filter.type = req.query.type;
        }
        if (req.query.isRead !== undefined && req.query.isRead !== 'all') {
            filter.isRead = req.query.isRead === 'true';
        }
        if (req.query.email) {
            const safe = escapeRegExp(req.query.email.trim().toLowerCase());
            filter.email = { $regex: `^${safe}`, $options: 'i' };
        }
        if (req.query.senderEmail) {
            const safe = escapeRegExp(req.query.senderEmail.trim().toLowerCase());
            filter.senderEmail = { $regex: `^${safe}$`, $options: 'i' };
        }
        
        console.log("getAllNotifications query:", req.query);
        console.log("getAllNotifications filter:", filter);

        const activeFilter = Object.keys(filter).length
            ? { $and: [filter, notExpiredWhere()] }
            : notExpiredWhere();

        const [rawList, total] = await Promise.all([
            Notification.find(activeFilter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            Notification.countDocuments(activeFilter),
        ]);

        // "Sent by me": recipient read state must not change read/unread appearance for staff
        const data = req.query.senderEmail
            ? rawList.map((n) => ({ ...n, isRead: false }))
            : rawList;

        res.status(200).json({
            success: true,
            count: data.length,
            total,
            page,
            pages: Math.ceil(total / limit),
            data,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
// Get notifications for a specific user
// ─────────────────────────────────────────────
exports.getUserNotifications = async (req, res) => {
    try {
        const { email } = req.params;
        const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : email

        if (!normalizedEmail) {
            return res.status(400).json({ success: false, message: "Email parameter is required" })
        }

        const requester = req.user;
        const isPrivileged = requester.role === 'admin' || requester.role === 'moderator';
        if (!isPrivileged && requester.email.toLowerCase() !== normalizedEmail) {
            return res.status(403).json({ success: false, message: "Forbidden: you can only view your own notifications" });
        }

        const safe = escapeRegExp(normalizedEmail)
        
        // Fetch both user-specific notifications and global broadcasts (non-expired, not recipient-dismissed)
        const notifications = await Notification.find({
            $and: [
                notExpiredWhere(),
                notHiddenForRecipient(normalizedEmail),
                {
                    $or: [
                        { email: { $regex: `^${safe}$`, $options: "i" } },
                        { email: "all" },
                    ],
                },
            ],
        }).sort({ createdAt: -1 }).lean();

        const mapped = mapInboxIsReadForRecipient(notifications, normalizedEmail);

        res.status(200).json({ success: true, count: mapped.length, data: mapped });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
// Mark ALL notifications as read for a user
// ─────────────────────────────────────────────
exports.markAllAsRead = async (req, res) => {
    try {
        const { email } = req.params;
        const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : email;

        if (!normalizedEmail) {
            return res.status(400).json({ success: false, message: "Email parameter is required" });
        }

        const requester = req.user;
        const isPrivileged = requester.role === 'admin' || requester.role === 'moderator';
        if (!isPrivileged && requester.email.toLowerCase() !== normalizedEmail) {
            return res.status(403).json({ success: false, message: "Forbidden: you can only update your own notifications" });
        }

        const safe = escapeRegExp(normalizedEmail);
        
        // System-generated directed (no staff sender): flip isRead
        await Notification.updateMany(
            {
                $and: [
                    notExpiredWhere(),
                    notHiddenForRecipient(normalizedEmail),
                    { email: { $regex: `^${safe}$`, $options: "i" }, isRead: false },
                    {
                        $or: [
                            { senderEmail: { $exists: false } },
                            { senderEmail: null },
                            { senderEmail: "" },
                        ],
                    },
                ],
            },
            { $set: { isRead: true } }
        );

        // Staff-sent directed to this user: per-recipient read in readBy (does not touch isRead)
        await Notification.updateMany(
            {
                $and: [
                    notExpiredWhere(),
                    notHiddenForRecipient(normalizedEmail),
                    { email: { $regex: `^${safe}$`, $options: "i" } },
                    { senderEmail: { $gt: "" } },
                ],
            },
            { $addToSet: { readBy: normalizedEmail }, $set: { isRead: false } }
        );

        // Broadcasts: each viewer records read in readBy (per-user only)
        await Notification.updateMany(
            {
                $and: [
                    notExpiredWhere(),
                    notHiddenForRecipient(normalizedEmail),
                    { email: "all" },
                ],
            },
            { $addToSet: { readBy: normalizedEmail } }
        );

        res.status(200).json({ success: true, message: "All notifications marked as read" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
// Mark single notification as read
// ─────────────────────────────────────────────
exports.markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const notification = await Notification.findById(id);

        if (!notification) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }

        if (!isNotificationActive(notification)) {
            return res.status(404).json({ success: false, message: "Notification expired" });
        }

        const requester = req.user;
        const isPrivileged = requester.role === 'admin' || requester.role === 'moderator';
        if (!isPrivileged && notification.email !== "all" && notification.email !== requester.email.toLowerCase()) {
            return res.status(403).json({ success: false, message: "Forbidden: not your notification" });
        }

        const reqEmail = requester.email.toLowerCase();
        if (
            !isPrivileged &&
            notification.hiddenFor &&
            notification.hiddenFor.includes(reqEmail)
        ) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }

        if (notification.email === "all") {
            if (!notification.readBy.includes(reqEmail)) {
                notification.readBy.push(reqEmail);
                await notification.save();
            }
        } else if (staffSender(notification)) {
            if (!notification.readBy.includes(reqEmail)) {
                notification.readBy.push(reqEmail);
            }
            notification.isRead = false;
            await notification.save();
        } else {
            notification.isRead = true;
            await notification.save();
        }

        const mapped = notification.toObject();
        if (mapped.email === "all") {
            mapped.isRead = mapped.readBy && mapped.readBy.includes(reqEmail);
        } else if (staffSender(mapped)) {
            mapped.isRead = !!(mapped.readBy && mapped.readBy.includes(reqEmail));
        }

        res.status(200).json({ success: true, data: mapped });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
// Mark single notification as unread
// ─────────────────────────────────────────────
exports.markAsUnread = async (req, res) => {
    try {
        const { id } = req.params;
        const notification = await Notification.findById(id);

        if (!notification) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }

        if (!isNotificationActive(notification)) {
            return res.status(404).json({ success: false, message: "Notification expired" });
        }

        const requester = req.user;
        const isPrivileged = requester.role === 'admin' || requester.role === 'moderator';
        if (!isPrivileged && notification.email !== "all" && notification.email !== requester.email.toLowerCase()) {
            return res.status(403).json({ success: false, message: "Forbidden: not your notification" });
        }

        const reqEmail = requester.email.toLowerCase();
        if (
            !isPrivileged &&
            notification.hiddenFor &&
            notification.hiddenFor.includes(reqEmail)
        ) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }

        if (notification.email === "all") {
            notification.readBy = notification.readBy.filter(e => e !== reqEmail);
            await notification.save();
        } else if (staffSender(notification)) {
            notification.readBy = notification.readBy.filter(e => e !== reqEmail);
            notification.isRead = false;
            await notification.save();
        } else {
            notification.isRead = false;
            await notification.save();
        }

        const mapped = notification.toObject();
        if (mapped.email === "all") {
            mapped.isRead = !!(mapped.readBy && mapped.readBy.includes(reqEmail));
        } else if (staffSender(mapped)) {
            mapped.isRead = !!(mapped.readBy && mapped.readBy.includes(reqEmail));
        }

        res.status(200).json({ success: true, data: mapped });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
// Delete a notification
// ─────────────────────────────────────────────
exports.deleteNotification = async (req, res) => {
    try {
        const { id } = req.params;
        const notification = await Notification.findById(id);

        if (!notification) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }

        if (!isNotificationActive(notification)) {
            return res.status(404).json({ success: false, message: "Notification expired" });
        }

        const requester = req.user;
        const isPrivileged = requester.role === 'admin' || requester.role === 'moderator';
        const reqEmail = requester.email.toLowerCase();
        const sender = notification.senderEmail && String(notification.senderEmail).trim();

        // System global broadcast (no sender): only staff may remove the row
        if (notification.email === "all" && !isPrivileged && !sender) {
            return res.status(403).json({ success: false, message: "Forbidden: cannot delete global notification" });
        }

        if (!isPrivileged && notification.email !== "all" && notification.email !== reqEmail) {
            return res.status(403).json({ success: false, message: "Forbidden: not your notification" });
        }

        // User dismisses admin/mod notification (direct or broadcast): inbox + counts only; "Sent by me" unchanged
        if (!isPrivileged && sender) {
            if (notification.email === "all" || notification.email === reqEmail) {
                await Notification.updateOne(
                    { _id: notification._id },
                    { $addToSet: { hiddenFor: reqEmail } }
                );
                return res.status(200).json({ success: true, data: {} });
            }
        }

        await notification.deleteOne();
        res.status(200).json({ success: true, data: {} });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
// Update a notification you sent (Sent by me) — admin / moderator only
// ─────────────────────────────────────────────
exports.updateSentNotification = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid notification id" });
        }

        const requester = req.user;
        if (requester.role !== "admin" && requester.role !== "moderator") {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }

        const notification = await Notification.findById(id);
        if (!notification) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }
        if (!isNotificationActive(notification)) {
            return res.status(404).json({ success: false, message: "Notification expired" });
        }

        const reqEmail = requester.email.toLowerCase();
        const docSender = (notification.senderEmail || "").toLowerCase().trim();
        if (!docSender || docSender !== reqEmail) {
            return res.status(403).json({
                success: false,
                message: "You can only edit notifications you sent",
            });
        }

        const { type, title, message, entityType, entityId } = req.body;
        const allowedTypes = ["answer", "comment", "best_answer", "report_update", "announcement"];
        let touched = false;

        if (type !== undefined) {
            if (!allowedTypes.includes(type)) {
                return res.status(400).json({ success: false, message: "Invalid notification type" });
            }
            notification.type = type;
            touched = true;
        }
        if (title !== undefined) {
            const t = typeof title === "string" ? title.trim() : "";
            if (t.length < 3 || t.length > 120) {
                return res.status(400).json({
                    success: false,
                    message: "Title must be between 3 and 120 characters",
                });
            }
            notification.title = t;
            touched = true;
        }
        if (message !== undefined) {
            const m = typeof message === "string" ? message.trim() : "";
            if (m.length < 5 || m.length > 800) {
                return res.status(400).json({
                    success: false,
                    message: "Message must be between 5 and 800 characters",
                });
            }
            notification.message = m;
            touched = true;
        }
        if (entityType !== undefined) {
            const et = typeof entityType === "string" ? entityType.trim() : "";
            if (!et || et.length > 80) {
                return res.status(400).json({
                    success: false,
                    message: "Entity type is required and must be at most 80 characters",
                });
            }
            notification.entityType = et;
            touched = true;
        }
        if (entityId !== undefined) {
            const eid = typeof entityId === "string" ? entityId.trim() : "";
            if (eid.length > 200) {
                return res.status(400).json({
                    success: false,
                    message: "Entity ID must be at most 200 characters",
                });
            }
            notification.entityId = eid || new mongoose.Types.ObjectId().toString();
            touched = true;
        }

        if (!touched) {
            return res.status(400).json({ success: false, message: "No valid fields to update" });
        }

        await notification.save();
        res.status(200).json({ success: true, data: notification });
    } catch (error) {
        const status = error?.name === "ValidationError" ? 400 : 500;
        res.status(status).json({ success: false, message: error.message });
    }
};
