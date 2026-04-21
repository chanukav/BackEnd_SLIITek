const express = require('express');
const {
    sseStream,
    createNotification,
    getAllNotifications,
    getUserNotifications,
    markAllAsRead,
    markAsRead,
    markAsUnread,
    deleteNotification,
    updateSentNotification,
} = require('../controllers/notificationController');
const { protect, protectSSE, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

// ── SSE stream — authenticated via ?token= query param ──────────────────────
// Must be declared BEFORE router.use(protect) so it uses protectSSE instead
router.get('/stream', protectSSE, sseStream);

// All remaining routes require a standard Bearer JWT
router.use(protect);

// Admin / moderator — get all notifications (paginated + filtered) or broadcast
router.route('/')
    .get(authorize('admin', 'moderator'), getAllNotifications)
    .post(authorize('admin', 'moderator'), createNotification);

// Self aliases to avoid client/user-email mismatches
router.get('/user/me', getUserNotifications);
router.put('/user/me/read-all', markAllAsRead);

// Any authenticated user — fetch their own; admin/mod can fetch any
router.route('/user/:email')
    .get(getUserNotifications);

// Bulk mark-all-read for a user's inbox (ownership enforced in controller)
router.route('/user/:email/read-all')
    .put(markAllAsRead);

// Single notification — update sent copy (staff, sender only); mark read / delete
router.patch('/:id', authorize('admin', 'moderator'), updateSentNotification);
router.route('/:id')
    .put(markAsRead)
    .delete(deleteNotification);

// Single notification — mark unread (ownership enforced in controller)
router.route('/:id/unread')
    .put(markAsUnread);

module.exports = router;
