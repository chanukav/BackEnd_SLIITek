const express = require("express");
const router = express.Router();

const upload = require("../middleware/uploadMiddleware");
const { protect } = require("../middleware/authMiddleware");
const {
  registerUser,
  loginUser,
  getLoginLogs,
  forgotPassword,
  sendOtp,
  verifyOtp,
  resetPassword,
  logoutUser,
  refreshToken,
} = require("../controllers/authController");

// Register
router.post("/register", upload.single("sliitIdPhoto"), registerUser);

// Login
router.post("/login", loginUser);

// Logout
router.post("/logout", logoutUser);

// Refresh Token
router.post("/refresh-token", refreshToken);

// Login Logs
router.get("/login-logs", protect, getLoginLogs);

// Forgot Password
router.post("/forgot-password", forgotPassword);

// Forgot Password OTP Flow
router.post("/forgot-password/send-otp", sendOtp);
router.post("/forgot-password/verify-otp", verifyOtp);
router.post("/forgot-password/reset-password", resetPassword);

module.exports = router;