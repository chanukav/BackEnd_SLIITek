const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/user");
const {
  generateAccessToken,
  generateRefreshToken,
} = require("../utils/generateTokens");
const {
  sendWhatsAppOtp,
  checkWhatsAppOtp,
} = require("../utils/twilioVerify");

const getEmailCategory = (email) => {
  const normalizedEmail = email.toLowerCase().trim();
  const userEmailRegex = /^it\d+@my\.sliit\.lk$/;
  const standardEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (userEmailRegex.test(normalizedEmail)) {
    return { normalizedEmail, category: "user" };
  }

  if (standardEmailRegex.test(normalizedEmail)) {
    return { normalizedEmail, category: "staff" };
  }

  return { normalizedEmail, category: "invalid" };
};

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const canCreateRole = (creatorRole, requestedRole) => {
  if (creatorRole === "admin") {
    return ["user", "moderator", "admin"].includes(requestedRole);
  }

  if (creatorRole === "moderator") {
    return requestedRole === "user";
  }

  return false;
};

const buildUserPayload = (user) => ({
  id: user._id,
  name: user.fullName || `${user.firstName} ${user.lastName}`,
  email: user.email,
  role: user.role,
  faculty: user.faculty,
  academicYear: user.academicYear,
  phone: user.phone,
});

const normalizeLegacyRole = (role = "") => {
  const normalized = String(role).toLowerCase().trim();
  if (normalized === "manager") return "moderator";
  if (["admin", "moderator", "user"].includes(normalized)) return normalized;
  return "user";
};

// ================= REGISTER =================
const registerUser = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      academicYear,
      faculty,
      password,
      confirmPassword,
      phone,
    } = req.body;

    if (
      !firstName ||
      !lastName ||
      !email ||
      !academicYear ||
      !faculty ||
      !password ||
      !confirmPassword ||
      !phone
    ) {
      return res.status(400).json({
        success: false,
        message: "Please fill all required fields",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "SLIIT ID photo is required",
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    const { normalizedEmail, category } = getEmailCategory(email);
    if (category !== "user") {
      return res.status(400).json({
        success: false,
        message: "User registration only allows ITxxxx@my.sliit.lk emails",
      });
    }

    const existingUserByEmail = await User.findOne({ email: normalizedEmail });

    if (existingUserByEmail) {
      return res.status(409).json({
        success: false,
        message: "User already exists with this email",
      });
    }

    const existingUserByPhone = await User.findOne({ phone });

    if (existingUserByPhone) {
      return res.status(409).json({
        success: false,
        message: "User already exists with this phone number",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      firstName,
      lastName,
      email: normalizedEmail,
      academicYear,
      faculty,
      phone, // Should be stored like +94771234567
      password: hashedPassword,
      sliitIdPhoto: `/uploads/${req.file.filename}`,
      role: "user",
    });

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: {
        id: newUser._id,
        name: `${newUser.firstName} ${newUser.lastName}`,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        email: newUser.email,
        academicYear: newUser.academicYear,
        faculty: newUser.faculty,
        phone: newUser.phone,
        sliitIdPhoto: newUser.sliitIdPhoto,
        role: newUser.role,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// ================= LOGIN =================
const createRoleUser = async (req, res) => {
  try {
    const creatorRole = req.user.role;
    const {
      firstName,
      lastName,
      email,
      academicYear,
      faculty,
      password,
      confirmPassword,
      phone,
      role,
    } = req.body;

    if (!canCreateRole(creatorRole, role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to create this role",
      });
    }

    if (
      !firstName ||
      !lastName ||
      !email ||
      !academicYear ||
      !faculty ||
      !password ||
      !confirmPassword ||
      !phone ||
      !role
    ) {
      return res.status(400).json({
        success: false,
        message: "Please fill all required fields",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "SLIIT ID photo is required",
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    const { normalizedEmail, category } = getEmailCategory(email);
    if (role === "user" && category !== "user") {
      return res.status(400).json({
        success: false,
        message: "User email must be ITxxxx@my.sliit.lk",
      });
    }

    if (role !== "user" && category !== "staff") {
      return res.status(400).json({
        success: false,
        message: "Admin and moderator accounts require a valid standard email",
      });
    }

    const existingUserByEmail = await User.findOne({ email: normalizedEmail });
    if (existingUserByEmail) {
      return res.status(409).json({
        success: false,
        message: "User already exists with this email",
      });
    }

    const existingUserByPhone = await User.findOne({ phone });
    if (existingUserByPhone) {
      return res.status(409).json({
        success: false,
        message: "User already exists with this phone number",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      firstName,
      lastName,
      email: normalizedEmail,
      academicYear,
      faculty,
      phone,
      password: hashedPassword,
      sliitIdPhoto: `/uploads/${req.file.filename}`,
      role,
      // staff users are marked verified because they are created by privileged users
      isEmailVerified: role !== "user",
    });

    return res.status(201).json({
      success: true,
      message: `${role} account created successfully`,
      user: buildUserPayload(newUser),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const migratedRole = normalizeLegacyRole(user.role);
    if (migratedRole !== user.role) {
      user.role = migratedRole;
      await user.save();
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      user.loginLogs.push({
        ip: req.ip || "127.0.0.1",
        userAgent: req.headers["user-agent"] || "Unknown",
        status: "failed",
      });

      await user.save();

      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    if (
      (user.role === "admin" || user.role === "moderator") &&
      !user.isEmailVerified
    ) {
      return res.status(403).json({
        success: false,
        message: "Staff email must be verified before login",
      });
    }

    user.loginLogs.push({
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      status: "success",
    });

    await user.save();

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    user.refreshToken = refreshToken;
    await user.save();

    res.cookie("refreshToken", refreshToken, cookieOptions);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token: accessToken,
      user: buildUserPayload(user),
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// ================= LOGIN LOGS =================
const getLoginLogs = async (req, res) => {
  try {
    const requester = req.user;
    const requestedEmail = req.query.email?.toLowerCase().trim();
    const targetEmail = requester.role === "admin" && requestedEmail
      ? requestedEmail
      : requester.email;
    const user = await User.findOne({ email: targetEmail });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json(user.loginLogs || []);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// ================= FORGOT PASSWORD INFO =================
const forgotPassword = async (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Use the send-otp endpoint with phone number",
  });
};

// ================= SEND OTP TO WHATSAPP =================
const sendOtp = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    const user = await User.findOne({ phone });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found with this phone number",
      });
    }

    await sendWhatsAppOtp(phone);

    return res.status(200).json({
      success: true,
      message: "OTP sent to your WhatsApp successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to send OTP to WhatsApp",
      error: error.message,
    });
  }
};

// ================= VERIFY OTP =================
const verifyOtp = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        message: "Phone number and OTP are required",
      });
    }

    const verificationCheck = await checkWhatsAppOtp(phone, otp);

    if (verificationCheck.status !== "approved") {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "OTP verification failed",
      error: error.message,
    });
  }
};

// ================= RESET PASSWORD =================
const resetPassword = async (req, res) => {
  try {
    const { phone, otp, newPassword } = req.body;

    if (!phone || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Phone number, OTP, and new password are required",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    const verificationCheck = await checkWhatsAppOtp(phone, otp);

    if (verificationCheck.status !== "approved") {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    const user = await User.findOne({ phone });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found with this phone number",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password reset successful",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to reset password",
      error: error.message,
    });
  }
};

// ================= LOGOUT =================
const logoutUser = async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (refreshToken) {
      const user = await User.findOne({ refreshToken });
      if (user) {
        user.refreshToken = null;
        await user.save();
      }
    }

    res.clearCookie("refreshToken", cookieOptions);

    return res.status(200).json({
      success: true,
      message: "Logout successful",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// ================= REFRESH TOKEN =================
const refreshToken = async (req, res) => {
  try {
    const token = req.cookies.refreshToken || req.body.refreshToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Refresh token is required",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user || user.refreshToken !== token) {
      return res.status(403).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    const newAccessToken = generateAccessToken(user);

    return res.status(200).json({
      success: true,
      token: newAccessToken,
    });
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: "Refresh failed",
      error: error.message,
    });
  }
};

module.exports = {
  registerUser,
  createRoleUser,
  loginUser,
  getLoginLogs,
  forgotPassword,
  logoutUser,
  refreshToken,
  sendOtp,
  verifyOtp,
  resetPassword,
};