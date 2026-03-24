const bcrypt = require("bcryptjs");
const User = require("../models/User");
const {
  sendWhatsAppOtp,
  checkWhatsAppOtp,
} = require("../utils/twilioVerify");

// Email pattern examples:
// USER    -> IT12345@my.sliit.lk
// ADMIN   -> admin.it@sliit.lk
// MANAGER -> manager.biz@sliit.lk

const getRoleAndFacultyFromEmail = (email) => {
  const normalizedEmail = email.toLowerCase().trim();

  // ================= USER EMAIL FORMAT =================
  // Example: IT12345@my.sliit.lk
  const userEmailRegex = /^it\d{5}@my\.sliit\.lk$/;

  if (userEmailRegex.test(normalizedEmail)) {
    return {
      valid: true,
      role: "user",
      facultyFromEmail: null,
      normalizedEmail,
    };
  }

  // ================= ADMIN / MANAGER EMAIL FORMAT =================
  // Examples:
  // admin.it@sliit.lk
  // manager.biz@sliit.lk
  const staffEmailRegex = /^(admin|manager)\.([a-z]+)@([a-z0-9-]+\.)?sliit\.lk$/;

  if (!staffEmailRegex.test(normalizedEmail)) {
    return {
      valid: false,
      message:
        "Invalid email format. Users must use ITxxxxx@my.sliit.lk. Admin/Manager must use role.faculty@sliit.lk",
    };
  }

  const localPart = normalizedEmail.split("@")[0];
  const parts = localPart.split(".");

  const rolePart = parts[0];
  const facultyPart = parts[1];

  const facultyMap = {
    it: "Computing",
    eng: "Engineering",
    biz: "Business",
    arch: "Architecture",
    hs: "Humanities & Sciences",
    med: "Medicine",
  };

  if (!facultyMap[facultyPart]) {
    return {
      valid: false,
      message: "Invalid faculty code in email",
    };
  }

  return {
    valid: true,
    role: rolePart,
    facultyFromEmail: facultyMap[facultyPart],
    normalizedEmail,
  };
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

    const emailCheck = getRoleAndFacultyFromEmail(email);

    if (!emailCheck.valid) {
      return res.status(400).json({
        success: false,
        message: emailCheck.message,
      });
    }

    const { normalizedEmail, role, facultyFromEmail } = emailCheck;

    // Only admin/manager emails must match faculty from email
    if (facultyFromEmail && faculty !== facultyFromEmail) {
      return res.status(400).json({
        success: false,
        message: `Selected faculty does not match email faculty. Expected: ${facultyFromEmail}`,
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
      role,
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

    user.loginLogs.push({
      ip: req.ip || "127.0.0.1",
      userAgent: req.headers["user-agent"] || "Unknown",
      status: "success",
    });

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token: "sample-token",
      user: {
        id: user._id,
        name: user.fullName || `${user.firstName} ${user.lastName}`,
        email: user.email,
        role: user.role,
        faculty: user.faculty,
        academicYear: user.academicYear,
        phone: user.phone,
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

// ================= LOGIN LOGS =================
const getLoginLogs = async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });

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
  return res.status(200).json({
    success: true,
    message: "Logout successful",
  });
};

// ================= REFRESH TOKEN =================
const refreshToken = async (req, res) => {
  return res.status(200).json({
    success: true,
    token: "new-sample-token",
  });
};

module.exports = {
  registerUser,
  loginUser,
  getLoginLogs,
  forgotPassword,
  logoutUser,
  refreshToken,
  sendOtp,
  verifyOtp,
  resetPassword,
};