const { Redis } = require("ioredis");

const redisOptions = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: process.env.REDIS_PORT || 6379,
};

const publisher = new Redis(redisOptions);
const subscriber = new Redis(redisOptions);

module.exports = { publisher, subscriber };
