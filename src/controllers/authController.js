const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/user");
const {
  generateAccessToken,
  generateRefreshToken,
} = require("../utils/generateTokens");
const sendEmail = require("../utils/sendEmail");
const {
  normalizePhoneForStorage,
  findUserByPhone,
} = require("../utils/phoneUtils");
const {
  generateOtp,
  hashOtp,
  verifyOtpHash,
  OTP_TTL_MS,
} = require("../utils/emailVerificationOtp");

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

const buildProfilePayload = (user) => ({
  id: user._id,
  name: user.fullName || `${user.firstName} ${user.lastName}`,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  role: user.role,
  faculty: user.faculty,
  academicYear: user.academicYear,
  phone: user.phone,
  avatar: user.avatar || null,
  sliitIdPhoto: user.sliitIdPhoto || null,
});

const uploadsDir = path.join(__dirname, "..", "uploads");

const removeAvatarFile = (avatarPath) => {
  if (!avatarPath || typeof avatarPath !== "string") return;
  const basename = path.basename(avatarPath);
  const abs = path.join(uploadsDir, basename);
  if (fs.existsSync(abs)) {
    fs.unlinkSync(abs);
  }
};

// ================= CURRENT USER PROFILE =================
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password -refreshToken");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    return res.status(200).json({
      success: true,
      user: buildProfilePayload(user),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const updateMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const {
      firstName,
      lastName,
      academicYear,
      faculty,
      phone,
      clearAvatar,
    } = req.body;

    const YEARS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
    const FACULTIES = [
      "Computing",
      "Engineering",
      "Business",
      "Architecture",
      "Humanities & Sciences",
      "Medicine",
    ];

    if (firstName !== undefined) user.firstName = String(firstName).trim();
    if (lastName !== undefined) user.lastName = String(lastName).trim();
    if (academicYear !== undefined) {
      if (!YEARS.includes(academicYear)) {
        return res.status(400).json({ success: false, message: "Invalid academic year" });
      }
      user.academicYear = academicYear;
    }
    if (faculty !== undefined) {
      if (!FACULTIES.includes(faculty)) {
        return res.status(400).json({ success: false, message: "Invalid faculty" });
      }
      user.faculty = faculty;
    }
    if (phone !== undefined) {
      const np = normalizePhoneForStorage(phone);
      if (!np) {
        return res.status(400).json({
          success: false,
          message: "Invalid phone number. Use 10 digits (e.g. 07XXXXXXXX).",
        });
      }
      user.phone = np;
    }

    const shouldClearAvatar =
      clearAvatar === true || clearAvatar === "true" || clearAvatar === "1";

    if (shouldClearAvatar) {
      removeAvatarFile(user.avatar);
      user.avatar = null;
    }

    if (req.file) {
      removeAvatarFile(user.avatar);
      user.avatar = `/uploads/${req.file.filename}`;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Profile updated",
      user: buildProfilePayload(user),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const normalizeLegacyRole = (role = "") => {
  const normalized = String(role).toLowerCase().trim();
  if (normalized === "manager") return "moderator";
  if (["admin", "moderator", "user"].includes(normalized)) return normalized;
  return "user";
};

const validateSignupPassword = (pwd) => {
  if (!pwd || pwd.length < 8) return "Password must be at least 8 characters";
  if (!/[a-z]/.test(pwd)) return "Password must include a lowercase letter";
  if (!/[A-Z]/.test(pwd)) return "Password must include an uppercase letter";
  if (!/[0-9]/.test(pwd)) return "Password must include a number";
  if (!/[^a-zA-Z0-9]/.test(pwd)) return "Password must include a special character";
  return null;
};

const buildEmailOtpBccOpts = () => {
  const bccRaw = process.env.EMAIL_VERIFICATION_BCC?.trim();
  const bccSender =
    String(process.env.EMAIL_VERIFICATION_BCC_SENDER || "")
      .toLowerCase() === "true";
  const bccList = [];
  if (bccRaw) {
    bccList.push(
      ...bccRaw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    );
  }
  const senderMailbox = (
    process.env.EMAIL_USER ||
    process.env.EMAIL ||
    ""
  ).trim();
  if (
    bccSender &&
    senderMailbox &&
    !bccList.includes(senderMailbox.toLowerCase())
  ) {
    bccList.push(senderMailbox.toLowerCase());
  }
  return bccList.length ? { bcc: bccList } : undefined;
};

/**
 * Sends an OTP email. In production, requires EMAIL_USER/EMAIL_PASS and a successful SMTP send.
 * @returns {{ sentViaSmtp: boolean }}
 */
const deliverOtpEmail = async (toAddress, subject, text, html) => {
  const hasMail = sendEmail.isConfigured();
  const isNonProduction = process.env.NODE_ENV !== "production";
  const mailOpts = buildEmailOtpBccOpts();

  if (hasMail) {
    await sendEmail(toAddress, subject, text, html, mailOpts);
    return { sentViaSmtp: true };
  }

  if (!isNonProduction) {
    const err = new Error("EMAIL_NOT_CONFIGURED");
    err.code503 = true;
    throw err;
  }
  return { sentViaSmtp: false };
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

    const pwErr = validateSignupPassword(password);
    if (pwErr) {
      return res.status(400).json({
        success: false,
        message: pwErr,
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

    const normalizedPhone = normalizePhoneForStorage(phone);
    if (!normalizedPhone) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number. Use 10 digits (e.g. 07XXXXXXXX).",
      });
    }

    const existingUserByPhone = await findUserByPhone(User, phone);

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
      phone: normalizedPhone,
      password: hashedPassword,
      sliitIdPhoto: `/uploads/${req.file.filename}`,
      role: "user",
      isEmailVerified: false,
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

    const normalizedPhone = normalizePhoneForStorage(phone);
    if (!normalizedPhone) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number. Use 10 digits (e.g. 07XXXXXXXX).",
      });
    }

    const existingUserByPhone = await findUserByPhone(User, phone);
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
      phone: normalizedPhone,
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

    if (user.role === "user" && user.isEmailVerified === false) {
      return res.status(403).json({
        success: false,
        message: "Verify your email before signing in. Open the verification step after registration.",
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
      // Also returned for SPAs on a different dev port — cookie may not always be sent on XHR.
      refreshToken,
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

// ================= VERIFY EMAIL (SIGN-UP) =================
const sendSignupEmailOtp = async (req, res) => {
  try {
    const emailRaw = req.body?.email;
    const normalizedEmail = String(emailRaw || "")
      .toLowerCase()
      .trim();

    if (!normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found for this email",
      });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: "This email is already verified. You can sign in.",
      });
    }

    const otp = generateOtp();
    user.emailVerificationToken = hashOtp(otp);
    user.emailVerificationExpires = new Date(Date.now() + OTP_TTL_MS);
    await user.save();

    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="color:#3d69b7;">Verify your SLIITEK email</h2>
        <p style="color:#4d5f83;">Use this code to finish signing up:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:0.2em;color:#343e43;">${otp}</p>
        <p style="color:#64748b;font-size:14px;">This code expires in 10 minutes. If you did not request it, you can ignore this message.</p>
      </div>
    `;

    const isNonProduction = process.env.NODE_ENV !== "production";
    let sentViaSmtp = false;

    try {
      const delivered = await deliverOtpEmail(
        normalizedEmail,
        "Your SLIITEK verification code",
        `Your verification code is ${otp}. It expires in 10 minutes.`,
        html
      );
      sentViaSmtp = delivered.sentViaSmtp;
    } catch (mailErr) {
      if (mailErr.code503) {
        return res.status(503).json({
          success: false,
          message:
            "Email is not configured. Set EMAIL_USER and EMAIL_PASS in BackEnd/.env (use a Gmail app password if using Gmail).",
          setupSteps: [
            "Gmail: Google Account → Security → 2-Step Verification → App passwords → create one for Mail",
            "In BackEnd/.env set EMAIL_USER=youraddress@gmail.com and EMAIL_PASS=the 16-character app password",
            "Restart the server after saving .env",
          ],
        });
      }
      console.error("[sendSignupEmailOtp] SMTP send failed:", mailErr.message);
      if (!isNonProduction) {
        return res.status(502).json({
          success: false,
          message:
            "Could not send email. Check EMAIL_USER / EMAIL_PASS (Gmail needs an app password).",
          error: mailErr.message,
        });
      }
      console.log(
        `[sendSignupEmailOtp] Non-production fallback code for ${normalizedEmail}: ${otp}`
      );
    }

    if (!sentViaSmtp && isNonProduction) {
      console.log(
        `[sendSignupEmailOtp] No EMAIL_USER/EMAIL_PASS — non-production code for ${normalizedEmail}: ${otp}`
      );
    }

    const payload = {
      success: true,
      message: sentViaSmtp
        ? "We sent a verification code to your email"
        : "Verification code ready. Enter it in the app (non-production: also in devOtp / server log).",
    };
    if (isNonProduction && !sentViaSmtp) {
      payload.devOtp = otp;
    }
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not send verification email",
      error: error.message,
    });
  }
};

const confirmSignupEmail = async (req, res) => {
  try {
    const emailRaw = req.body?.email;
    const { otp } = req.body;
    const normalizedEmail = String(emailRaw || "")
      .toLowerCase()
      .trim();

    if (!normalizedEmail || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and verification code are required",
      });
    }

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found for this email",
      });
    }

    if (user.isEmailVerified) {
      return res.status(200).json({
        success: true,
        message: "Email is already verified",
      });
    }

    if (!user.emailVerificationExpires || user.emailVerificationExpires < new Date()) {
      return res.status(400).json({
        success: false,
        message: "Code expired. Request a new one.",
      });
    }

    if (!verifyOtpHash(String(otp).trim(), user.emailVerificationToken)) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code",
      });
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Email verified successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Verification failed",
      error: error.message,
    });
  }
};

// ================= FORGOT PASSWORD INFO =================
const forgotPassword = async (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Use the send-otp endpoint with your account email",
  });
};

// ================= FORGOT PASSWORD — SEND OTP BY EMAIL =================
const sendOtp = async (req, res) => {
  try {
    const emailRaw = req.body?.email;
    const normalizedEmail = String(emailRaw || "")
      .toLowerCase()
      .trim();

    if (!normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found for this email",
      });
    }

    const otp = generateOtp();
    user.resetOtp = hashOtp(otp);
    user.resetOtpExpire = new Date(Date.now() + OTP_TTL_MS);
    await user.save();

    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="color:#3d69b7;">Reset your SLIITEK password</h2>
        <p style="color:#4d5f83;">Use this code to set a new password:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:0.2em;color:#343e43;">${otp}</p>
        <p style="color:#64748b;font-size:14px;">This code expires in 10 minutes. If you did not request a reset, you can ignore this message.</p>
      </div>
    `;

    const isNonProduction = process.env.NODE_ENV !== "production";
    let sentViaSmtp = false;

    try {
      const delivered = await deliverOtpEmail(
        normalizedEmail,
        "Your SLIITEK password reset code",
        `Your password reset code is ${otp}. It expires in 10 minutes.`,
        html
      );
      sentViaSmtp = delivered.sentViaSmtp;
    } catch (mailErr) {
      if (mailErr.code503) {
        user.resetOtp = null;
        user.resetOtpExpire = null;
        await user.save();
        return res.status(503).json({
          success: false,
          message:
            "Email is not configured on the server. Set EMAIL_USER and EMAIL_PASS in BackEnd/.env.",
        });
      }
      console.error("[sendOtp] SMTP send failed:", mailErr.message);
      if (!isNonProduction) {
        user.resetOtp = null;
        user.resetOtpExpire = null;
        await user.save();
        return res.status(502).json({
          success: false,
          message:
            "Could not send email. Check EMAIL_USER / EMAIL_PASS (Gmail needs an app password).",
          error: mailErr.message,
        });
      }
      // Non-production: keep stored OTP so verify still works; surface code via devOtp below.
    }

    if (!sentViaSmtp && isNonProduction) {
      console.log(
        `[sendOtp] No EMAIL_USER/EMAIL_PASS — non-production reset code for ${normalizedEmail}: ${otp}`
      );
    }

    const payload = {
      success: true,
      delivery: "email",
      message: sentViaSmtp
        ? "We sent a reset code to your email"
        : "Configure EMAIL_USER and EMAIL_PASS to receive the code by email (non-production: see server log or devOtp).",
    };
    if (isNonProduction && !sentViaSmtp) {
      payload.devOtp = otp;
    }
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not send reset code",
      error: error.message,
    });
  }
};

// ================= VERIFY OTP (email + code → short-lived reset token) =================
const verifyOtp = async (req, res) => {
  try {
    const emailRaw = req.body?.email;
    const { otp } = req.body;
    const normalizedEmail = String(emailRaw || "")
      .toLowerCase()
      .trim();

    if (!normalizedEmail || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and verification code are required",
      });
    }

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found for this email",
      });
    }

    if (
      !user.resetOtp ||
      !user.resetOtpExpire ||
      user.resetOtpExpire < new Date()
    ) {
      return res.status(400).json({
        success: false,
        message: "Code expired or not found. Request a new one.",
      });
    }

    if (!verifyOtpHash(String(otp).trim(), user.resetOtp)) {
      return res.status(400).json({
        success: false,
        message: "Invalid code",
      });
    }

    user.resetOtp = null;
    user.resetOtpExpire = null;
    await user.save();

    const resetToken = jwt.sign(
      { pr: "pwd_reset", em: normalizedEmail, uid: String(user._id) },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully",
      resetToken,
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
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Reset token and new password are required",
      });
    }

    const pwErr = validateSignupPassword(newPassword);
    if (pwErr) {
      return res.status(400).json({
        success: false,
        message: pwErr,
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch {
      return res.status(400).json({
        success: false,
        message: "Reset session expired. Verify your OTP again.",
      });
    }

    if (
      decoded.pr !== "pwd_reset" ||
      (!decoded.em && !decoded.ph)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid reset token",
      });
    }

    const emailKey = decoded.em
      ? String(decoded.em).toLowerCase().trim()
      : null;
    const user =
      (await User.findById(decoded.uid)) ||
      (emailKey ? await User.findOne({ email: emailKey }) : null) ||
      (decoded.ph
        ? (await User.findOne({ phone: decoded.ph })) ||
          (await findUserByPhone(User, decoded.ph))
        : null);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password updated. You can sign in now.",
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
    const token = req.body.refreshToken || req.cookies.refreshToken;

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
  sendSignupEmailOtp,
  confirmSignupEmail,
  getMe,
  updateMe,
};