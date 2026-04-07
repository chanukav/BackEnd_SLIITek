const { subscriber } = require("./pubsub");

/**
 * In-memory SSE client registry.
 * Maps normalised email → Set of active SSE response objects.
 *
 * Structure:
 *   Map<string, Set<import('express').Response>>
 *
 * This lives in a single module so both the SSE handler and the
 * createNotification controller can import and share the same Map instance.
 */
const sseClients = new Map();

// Listen for notifications published by any worker/server instance
subscriber.subscribe("notifications", (err) => {
  if (err) {
    console.error("❌ Failed to subscribe to notifications channel:", err);
  } else {
    console.log("📡 Subscribed to Redis 'notifications' channel for SSE");
  }
});

subscriber.on("message", (channel, message) => {
  if (channel === "notifications") {
    try {
      const notification = JSON.parse(message);
      if (notification.email === "all") {
        // Broadcast to all connected SSE clients
        const data = JSON.stringify(notification);
        for (const [email, set] of sseClients.entries()) {
          for (const res of set) {
            try {
              res.write(`data: ${data}\n\n`);
            } catch {
              set.delete(res);
            }
          }
        }
      } else {
        pushToClient(notification.email, notification);
      }
    } catch (err) {
      console.error("❌ Error parsing notification message:", err);
    }
  }
});

/**
 * Register an SSE response for a given email.
 * @param {string} email  Normalised (lowercase) email
 * @param {import('express').Response} res  The SSE response object
 */
function addClient(email, res) {
  if (!sseClients.has(email)) sseClients.set(email, new Set());
  sseClients.get(email).add(res);
}

/**
 * Remove an SSE response for a given email.
 * @param {string} email
 * @param {import('express').Response} res
 */
function removeClient(email, res) {
  const set = sseClients.get(email);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) sseClients.delete(email);
}

/**
 * Push a notification payload to all SSE clients subscribed to `email`.
 * @param {string} email
 * @param {object} notification  The Mongoose document or plain object to send
 */
function pushToClient(email, notification) {
  const set = sseClients.get(email);
  if (!set || set.size === 0) return;
  const data = JSON.stringify(notification);
  for (const res of set) {
    try {
      res.write(`data: ${data}\n\n`);
    } catch {
      // Client disconnected — clean up
      set.delete(res);
    }
  }
  if (set.size === 0) sseClients.delete(email);
}

module.exports = { addClient, removeClient, pushToClient };
