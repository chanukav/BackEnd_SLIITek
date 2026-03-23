const Notification = require('../models/Notification');
const mongoose = require('mongoose');

// Create a new notification
exports.createNotification = async (req, res) => {
    try {
        const { email, type, title, message, entityType, entityId } = req.body;
        const notification = new Notification({ 
            email, 
            type, 
            title,
            message,
            entityType: entityType || 'System',
            entityId: entityId || new mongoose.Types.ObjectId().toString()
        });
        await notification.save();
        res.status(201).json({ success: true, data: notification });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
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
        const notifications = await Notification.find({ email }).sort({ createdAt: -1 });
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
