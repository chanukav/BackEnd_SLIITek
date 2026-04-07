const { Worker } = require("bullmq");
const { redisConnection } = require("../config/redis");
const Notification = require("../models/Notification");
const User = require("../models/user");
const { publisher } = require("../utils/pubsub");

const worker = new Worker(
  "notifications",
  async (job) => {
    const data = job.data;

    if (data.email === "all") {
      // Broadcast to all users
      const users = await User.find({}).select("email").lean();
      const notifications = users.map(user => ({
        ...data,
        email: user.email
      }));
      
      // Bulk insert for performance
      if (notifications.length > 0) {
        const createdNotifications = await Notification.insertMany(notifications);
        
        // Push each notification via Redis Pub/Sub
        for (const notification of createdNotifications) {
          await publisher.publish("notifications", JSON.stringify(notification.toObject()));
        }
      }
      return { broadcastCount: notifications.length };
    } else {
      // 1. Save single notification to DB
      const notification = await Notification.create(data);

      // 2. Push via Redis Pub/Sub instead of direct SSE
      await publisher.publish("notifications", JSON.stringify(notification.toObject()));

      return notification;
    }
  },
  { connection: redisConnection }
);

worker.on("completed", (job) => {
  console.log(`✅ Job completed: ${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Job failed: ${job.id}`, err);
  console.error("Failed job data:", job.data);
  
  // Optional: Save failed notification logic can go here
  // await FailedNotification.create(job.data);
});

console.log("👷 Notification worker is initialized within the monolith...");

module.exports = worker;
