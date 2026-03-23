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

// Get all notifications (Admin use case)
exports.getAllNotifications = async (req, res) => {
    try {
        const notifications = await Notification.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, count: notifications.length, data: notifications });
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

// Mark notification as read
exports.markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const notification = await Notification.findByIdAndUpdate(
            id,
            { isRead: true },
            { returnDocument: 'after', runValidators: true }
        );

        if (!notification) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }

        res.status(200).json({ success: true, data: notification });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Mark notification as unread
exports.markAsUnread = async (req, res) => {
    try {
        const { id } = req.params;
        const notification = await Notification.findByIdAndUpdate(
            id,
            { isRead: false },
            { returnDocument: 'after', runValidators: true }
        );

        if (!notification) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }

        res.status(200).json({ success: true, data: notification });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete a notification
exports.deleteNotification = async (req, res) => {
    try {
        const { id } = req.params;
        const notification = await Notification.findByIdAndDelete(id);

        if (!notification) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }

        res.status(200).json({ success: true, data: {} });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
