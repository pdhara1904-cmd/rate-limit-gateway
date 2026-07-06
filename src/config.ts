import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  backendUrl: process.env.BACKEND_URL || "http://localhost:4000",
  redisUrl: process.env.REDIS_URL, // if undefined, we fall back to in-memory store
  algorithm: (process.env.RATE_LIMIT_ALGORITHM || "token-bucket") as
    | "token-bucket"
    | "sliding-window",
  tokenBucket: {
    capacity: parseInt(process.env.BUCKET_CAPACITY || "20", 10),
    refillRatePerSecond: parseFloat(process.env.BUCKET_REFILL_RATE || "5"),
  },
  slidingWindow: {
    maxRequests: parseInt(process.env.WINDOW_MAX_REQUESTS || "100", 10),
    windowSeconds: parseInt(process.env.WINDOW_SECONDS || "60", 10),
  },
};
