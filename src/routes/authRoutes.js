const express = require("express");
const router = express.Router();
const multer = require("multer");

const upload = require("../middleware/uploadMiddleware");
const { uploadAvatar } = require("../middleware/uploadMiddleware");
const { protect, authorize } = require("../middleware/authMiddleware");
const {
  registerUser,
  createRoleUser,
  loginUser,
  getLoginLogs,
  forgotPassword,
  sendOtp,
  verifyOtp,
  resetPassword,
  sendSignupEmailOtp,
  confirmSignupEmail,
  logoutUser,
  refreshToken,
  getMe,
  updateMe,
} = require("../controllers/authController");

// Register
router.post("/register", upload.single("sliitIdPhoto"), registerUser);
router.post(
  "/create-user",
  protect,
  authorize("admin", "moderator"),
  upload.single("sliitIdPhoto"),
  createRoleUser
);

// Current user profile
router.get("/me", protect, getMe);
router.patch("/me", protect, uploadAvatar.single("avatar"), updateMe);

// Sign-up email verification
router.post("/verify-email/send", sendSignupEmailOtp);
router.post("/verify-email/confirm", confirmSignupEmail);

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

// ── Multer / file-upload error handler ──────────────────────────────────────
// Must be declared with 4 parameters so Express treats it as an error handler.
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err?.message?.toLowerCase().includes("file")) {
    return res.status(400).json({ message: err.message });
  }
  next(err);
});

module.exports = router;