const { Queue } = require("bullmq");
const { redisConnection } = require("../config/redis");

const notificationQueue = new Queue("notifications", {
  connection: redisConnection,
});

module.exports = { notificationQueue };
