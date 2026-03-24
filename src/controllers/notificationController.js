const Notification = require('../models/Notification');
const mongoose = require('mongoose');

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const escapeRegExp = (value) =>
    String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Create a new notification
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

        if (!normalizedEmail || !emailRegex.test(normalizedEmail)) {
            return res.status(400).json({ success: false, message: "Valid email is required" })
        }
        if (!normalizedTitle || String(normalizedTitle).length < 3) {
            return res.status(400).json({ success: false, message: "Title is required (min 3 characters)" })
        }
        if (!normalizedMessage || String(normalizedMessage).length < 5) {
            return res.status(400).json({ success: false, message: "Message is required (min 5 characters)" })
        }

        const notification = new Notification({ 
            email: normalizedEmail, 
            type, 
            title: normalizedTitle,
            message: normalizedMessage,
            entityType: normalizedEntityType || 'System',
            entityId: normalizedEntityId || new mongoose.Types.ObjectId().toString()
        });
        await notification.save();
        res.status(201).json({ success: true, data: notification });
    } catch (error) {
        const status = error?.name === "ValidationError" ? 400 : 500
        res.status(status).json({ success: false, message: error.message });
    }
};

// Get all notifications (Admin use case) — supports pagination + filtering
exports.getAllNotifications = async (req, res) => {
    try {
        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const skip  = (page - 1) * limit;

        // Build filter
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
            filter.email = { $regex: `^${safe}`, $options: 'i' }; // prefix search
        }

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

// Get notifications for a specific user
exports.getUserNotifications = async (req, res) => {
    try {
        const { email } = req.params;
        const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : email

        if (!normalizedEmail) {
            return res.status(400).json({ success: false, message: "Email parameter is required" })
        }

        // Regular users can only fetch their own notifications
        const requester = req.user;
        const isPrivileged = requester.role === 'admin' || requester.role === 'moderator';
        if (!isPrivileged && requester.email.toLowerCase() !== normalizedEmail) {
            return res.status(403).json({ success: false, message: "Forbidden: you can only view your own notifications" });
        }

        // Case-insensitive exact match for emails.
        const safe = escapeRegExp(normalizedEmail)
        const notifications = await Notification.find({
            email: { $regex: `^${safe}$`, $options: "i" }
        }).sort({ createdAt: -1 });
        res.status(200).json({ success: true, count: notifications.length, data: notifications });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Mark all notifications as read for a given user email
exports.markAllAsRead = async (req, res) => {
    try {
        const { email } = req.params;
        const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : email;

        if (!normalizedEmail) {
            return res.status(400).json({ success: false, message: "Email parameter is required" });
        }

        // Ownership check — users can only mark their own
        const requester = req.user;
        const isPrivileged = requester.role === 'admin' || requester.role === 'moderator';
        if (!isPrivileged && requester.email.toLowerCase() !== normalizedEmail) {
            return res.status(403).json({ success: false, message: "Forbidden: you can only update your own notifications" });
        }

        const safe = escapeRegExp(normalizedEmail);
        const result = await Notification.updateMany(
            { email: { $regex: `^${safe}$`, $options: 'i' }, isRead: false },
            { $set: { isRead: true } }
        );

        res.status(200).json({ success: true, updated: result.modifiedCount });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Mark notification as read
exports.markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const notification = await Notification.findById(id);

        if (!notification) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }

        // Ownership check
        const requester = req.user;
        const isPrivileged = requester.role === 'admin' || requester.role === 'moderator';
        if (!isPrivileged && notification.email !== requester.email.toLowerCase()) {
            return res.status(403).json({ success: false, message: "Forbidden: not your notification" });
        }

        notification.isRead = true;
        await notification.save();
        res.status(200).json({ success: true, data: notification });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Mark notification as unread
exports.markAsUnread = async (req, res) => {
    try {
        const { id } = req.params;
        const notification = await Notification.findById(id);

        if (!notification) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }

        // Ownership check
        const requester = req.user;
        const isPrivileged = requester.role === 'admin' || requester.role === 'moderator';
        if (!isPrivileged && notification.email !== requester.email.toLowerCase()) {
            return res.status(403).json({ success: false, message: "Forbidden: not your notification" });
        }

        notification.isRead = false;
        await notification.save();
        res.status(200).json({ success: true, data: notification });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete a notification
exports.deleteNotification = async (req, res) => {
    try {
        const { id } = req.params;
        const notification = await Notification.findById(id);

        if (!notification) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }

        // Ownership check — only admin/moderator or the owner can delete
        const requester = req.user;
        const isPrivileged = requester.role === 'admin' || requester.role === 'moderator';
        if (!isPrivileged && notification.email !== requester.email.toLowerCase()) {
            return res.status(403).json({ success: false, message: "Forbidden: not your notification" });
        }

        await notification.deleteOne();
        res.status(200).json({ success: true, data: {} });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
