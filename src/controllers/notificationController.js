const Notification = require('../models/Notification');
const mongoose = require('mongoose');
const { addClient, removeClient, pushToClient } = require('../utils/sseClients');
const { notificationQueue } = require('../queues/notificationQueue');

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
        const { email, type, title, message, entityType, entityId } = req.body;

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

        const [notifications, total] = await Promise.all([
            Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
            Notification.countDocuments(filter),
        ]);

        res.status(200).json({
            success: true,
            count: notifications.length,
            total,
            page,
            pages: Math.ceil(total / limit),
            data: notifications,
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
        
        // Fetch both user-specific notifications and global broadcasts
        const notifications = await Notification.find({
            $or: [
                { email: { $regex: `^${safe}$`, $options: "i" } },
                { email: "all" }
            ]
        }).sort({ createdAt: -1 }).lean();

        // Map isRead for global notifications
        const mapped = notifications.map(n => {
            if (n.email === "all") {
                n.isRead = n.readBy && n.readBy.includes(normalizedEmail);
            }
            return n;
        });

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
        
        // Update individual notifications
        await Notification.updateMany(
            { email: { $regex: `^${safe}$`, $options: 'i' }, isRead: false },
            { $set: { isRead: true } }
        );

        // Update global notifications
        await Notification.updateMany(
            { email: "all", readBy: { $ne: normalizedEmail } },
            { $push: { readBy: normalizedEmail } }
        );

        // We don't have an exact count of modified global ones easily, but success is true
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

        const requester = req.user;
        const isPrivileged = requester.role === 'admin' || requester.role === 'moderator';
        if (!isPrivileged && notification.email !== "all" && notification.email !== requester.email.toLowerCase()) {
            return res.status(403).json({ success: false, message: "Forbidden: not your notification" });
        }

        if (notification.email === "all") {
            if (!notification.readBy.includes(requester.email.toLowerCase())) {
                notification.readBy.push(requester.email.toLowerCase());
                await notification.save();
            }
        } else {
            notification.isRead = true;
            await notification.save();
        }

        // Return mapped version
        const mapped = notification.toObject();
        if (mapped.email === "all") mapped.isRead = true;

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

        const requester = req.user;
        const isPrivileged = requester.role === 'admin' || requester.role === 'moderator';
        if (!isPrivileged && notification.email !== "all" && notification.email !== requester.email.toLowerCase()) {
            return res.status(403).json({ success: false, message: "Forbidden: not your notification" });
        }

        if (notification.email === "all") {
            notification.readBy = notification.readBy.filter(e => e !== requester.email.toLowerCase());
            await notification.save();
        } else {
            notification.isRead = false;
            await notification.save();
        }

        // Return mapped version
        const mapped = notification.toObject();
        if (mapped.email === "all") mapped.isRead = false;

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

        const requester = req.user;
        const isPrivileged = requester.role === 'admin' || requester.role === 'moderator';
        
        // Only admins/mods can delete global notifications
        if (notification.email === "all" && !isPrivileged) {
            return res.status(403).json({ success: false, message: "Forbidden: cannot delete global notification" });
        }

        if (!isPrivileged && notification.email !== "all" && notification.email !== requester.email.toLowerCase()) {
            return res.status(403).json({ success: false, message: "Forbidden: not your notification" });
        }

        await notification.deleteOne();
        res.status(200).json({ success: true, data: {} });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
