const express = require('express');
const {
    createNotification,
    getAllNotifications,
    getUserNotifications,
    markAsRead,
    markAsUnread,
    deleteNotification
} = require('../controllers/notificationController');

const router = express.Router();

// Admin / general routes
router.route('/')
    .get(getAllNotifications)
    .post(createNotification);

// Specific user notifications
router.route('/user/:email')
    .get(getUserNotifications);

// Specific notification operations
router.route('/:id')
    .put(markAsRead)
    .delete(deleteNotification);

// Unmark read status
router.route('/:id/unread')
    .put(markAsUnread);

module.exports = router;
