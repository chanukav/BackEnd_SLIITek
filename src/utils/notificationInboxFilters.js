/**
 * Inbox visibility: recipient removed an admin-sent directed message from their list
 * without deleting the row (admin "Sent by me" still shows it).
 */
function notHiddenForRecipient(normalizedEmail) {
  return {
    $expr: {
      $not: {
        $in: [normalizedEmail, { $ifNull: ["$hiddenFor", []] }],
      },
    },
  };
}

/** True when normalizedEmail is not listed in readBy (per-recipient read for staff/broadcast). */
function recipientNotInReadBy(normalizedEmail) {
  return {
    $expr: {
      $not: {
        $in: [normalizedEmail, { $ifNull: ["$readBy", []] }],
      },
    },
  };
}

module.exports = { notHiddenForRecipient, recipientNotInReadBy };
