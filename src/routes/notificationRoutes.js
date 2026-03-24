const express = require('express');
const {
    createNotification,
    getAllNotifications,
    getUserNotifications,
    markAllAsRead,
    markAsRead,
    markAsUnread,
    deleteNotification
} = require('../controllers/notificationController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

// All routes require a valid JWT
router.use(protect);

// Admin / moderator — get all notifications (paginated + filtered) or broadcast a new one
router.route('/')
    .get(authorize('admin', 'moderator'), getAllNotifications)
    .post(authorize('admin', 'moderator'), createNotification);

// Any authenticated user — get their own notifications
// Admins/moderators can also look up any email
router.route('/user/:email')
    .get(getUserNotifications);

// Mark ALL as read for a user email (ownership enforced in controller)
router.route('/user/:email/read-all')
    .put(markAllAsRead);

// Mark single notification read / delete (ownership enforced in controller)
router.route('/:id')
    .put(markAsRead)
    .delete(deleteNotification);

// Mark single notification unread (ownership enforced in controller)
router.route('/:id/unread')
    .put(markAsUnread);

module.exports = router;
