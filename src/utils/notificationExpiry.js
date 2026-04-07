const MS_DAY = 24 * 60 * 60 * 1000;

/** Activity notifications (answers, comments, …) — queued without senderEmail */
const USER_NOTIFICATION_TTL_MS = 14 * MS_DAY;

/** Admin/mod notifications created from the dashboard — payload includes senderEmail */
const ADMIN_NOTIFICATION_TTL_MS = 30 * MS_DAY;

function hasAdminSender(data) {
  const s = data?.senderEmail;
  return typeof s === "string" && s.trim().length > 0;
}

function computeExpiresAtFromJobData(jobData) {
  const ms = hasAdminSender(jobData) ? ADMIN_NOTIFICATION_TTL_MS : USER_NOTIFICATION_TTL_MS;
  return new Date(Date.now() + ms);
}

/**
 * Mongo filter: notification is still within its retention window.
 * Supports legacy documents that predate `expiresAt`.
 */
function notExpiredWhere() {
  const now = Date.now();
  const cutoffUser = new Date(now - USER_NOTIFICATION_TTL_MS);
  const cutoffAdmin = new Date(now - ADMIN_NOTIFICATION_TTL_MS);

  return {
    $or: [
      { expiresAt: { $gt: new Date(now) } },
      {
        expiresAt: { $exists: false },
        $or: [
          {
            $or: [
              { senderEmail: { $exists: false } },
              { senderEmail: null },
              { senderEmail: "" },
            ],
            createdAt: { $gt: cutoffUser },
          },
          {
            senderEmail: { $gt: "" },
            createdAt: { $gt: cutoffAdmin },
          },
        ],
      },
    ],
  };
}

/** For single-document checks (mark read / delete, etc.) */
function isNotificationActive(doc) {
  if (!doc) return false;
  const now = Date.now();
  if (doc.expiresAt instanceof Date) {
    return doc.expiresAt.getTime() > now;
  }
  const ttl = hasAdminSender(doc) ? ADMIN_NOTIFICATION_TTL_MS : USER_NOTIFICATION_TTL_MS;
  const created = doc.createdAt instanceof Date ? doc.createdAt.getTime() : 0;
  return created + ttl > now;
}

module.exports = {
  USER_NOTIFICATION_TTL_MS,
  ADMIN_NOTIFICATION_TTL_MS,
  computeExpiresAtFromJobData,
  notExpiredWhere,
  isNotificationActive,
};
