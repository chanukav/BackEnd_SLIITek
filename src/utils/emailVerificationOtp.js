const crypto = require("crypto");

const OTP_LEN = 6;
const OTP_TTL_MS = 10 * 60 * 1000;

const generateOtp = () => {
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(OTP_LEN, "0");
};

const hashOtp = (otp) => {
  const secret = process.env.JWT_SECRET || "dev-insecure-secret";
  return crypto.createHmac("sha256", secret).update(otp).digest("hex");
};

const verifyOtpHash = (otp, storedHash) => {
  if (!otp || !storedHash || typeof storedHash !== "string") return false;
  const a = Buffer.from(hashOtp(otp), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

module.exports = {
  OTP_LEN,
  OTP_TTL_MS,
  generateOtp,
  hashOtp,
  verifyOtpHash,
};
