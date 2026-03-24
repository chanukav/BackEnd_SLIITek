const User = require("../models/User");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const speakeasy = require("speakeasy");
const sendEmail = require("../utils/sendEmail");
const {
  generateAccessToken,
  generateRefreshToken
} = require("../utils/generateTokens");

const createRandomToken = () => crypto.randomBytes(32).toString("hex");

const addLoginLog = async (user, req, status) => {
  user.loginLogs.unshift({
    ip: req.ip,
    userAgent: req.headers["user-agent"] || "unknown",
    status
  });

  if (user.loginLogs.length > 20) {
    user.loginLogs = user.loginLogs.slice(0, 20);
  }

  await user.save();
};

exports.register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const emailToken = createRandomToken();
    const otpSecret = speakeasy.generateSecret({ name: `SmartAccess(${email})` });

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role: role || "user",
      emailVerificationToken: emailToken,
      emailVerificationExpires: Date.now() + 1000 * 60 * 60 * 24,
      otpSecret: otpSecret.base32
    });

    const verifyLink = `${process.env.CLIENT_URL}/verify-email/${emailToken}`;

    await sendEmail({
      to: email,
      subject: "Verify your email",
      html: `
        <h2>Email Verification</h2>
        <p>Click below to verify your account:</p>
        <a href="${verifyLink}">${verifyLink}</a>
      `
    });

    res.status(201).json({
      message: "Registered successfully. Please verify your email."
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;

    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    res.json({ message: "Email verified successfully" });
  } catch (error) {
    res.status(500).json({ message: "Verification failed" });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password, otp } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (user.lockUntil && user.lockUntil > Date.now()) {
      return res.status(423).json({
        message: "Account locked. Try again later."
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      user.failedLoginAttempts += 1;

      if (user.failedLoginAttempts >= 5) {
        user.lockUntil = Date.now() + 15 * 60 * 1000;
      }

      await addLoginLog(user, req, "failed");

      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (!user.isEmailVerified) {
      return res.status(401).json({
        message: "Please verify your email first"
      });
    }

    if (user.otpEnabled) {
      if (!otp) {
        return res.status(206).json({
          message: "OTP required",
          otpRequired: true
        });
      }

      const otpValid = speakeasy.totp.verify({
        secret: user.otpSecret,
        encoding: "base32",
        token: otp,
        window: 1
      });

      if (!otpValid) {
        return res.status(400).json({ message: "Invalid OTP" });
      }
    }

    user.failedLoginAttempts = 0;
    user.lockUntil = undefined;

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    user.refreshToken = refreshToken;
    await addLoginLog(user, req, "success");

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.status(200).json({
      message: "Login successful",
      token: accessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.refreshAccessToken = async (req, res) => {
  try {
    const token = req.cookies.refreshToken;

    if (!token) {
      return res.status(401).json({ message: "No refresh token" });
    }

    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id);

    if (!user || user.refreshToken !== token) {
      return res.status(403).json({ message: "Invalid refresh token" });
    }

    const newAccessToken = generateAccessToken(user);

    res.json({ token: newAccessToken });
  } catch (error) {
    res.status(403).json({ message: "Refresh failed" });
  }
};

exports.logout = async (req, res) => {
  try {
    const token = req.cookies.refreshToken;

    if (token) {
      const decoded = jwt.decode(token);
      if (decoded?.id) {
        const user = await User.findById(decoded.id);
        if (user) {
          user.refreshToken = undefined;
          await user.save();
        }
      }
    }

    res.clearCookie("refreshToken");
    res.json({ message: "Logged out successfully" });
  } catch (error) {
    res.status(500).json({ message: "Logout failed" });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.json({ message: "If the email exists, a reset link was sent." });
    }

    const resetToken = createRandomToken();

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 1000 * 60 * 30;
    await user.save();

    const resetLink = `${process.env.CLIENT_URL}/reset-password/${resetToken}`;

    await sendEmail({
      to: user.email,
      subject: "Reset your password",
      html: `
        <h2>Password Reset</h2>
        <p>Click this link to reset your password:</p>
        <a href="${resetLink}">${resetLink}</a>
      `
    });

    res.json({ message: "If the email exists, a reset link was sent." });
  } catch (error) {
    res.status(500).json({ message: "Forgot password failed" });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired reset token" });
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: "Password reset successful" });
  } catch (error) {
    res.status(500).json({ message: "Reset password failed" });
  }
};

exports.getLoginLogs = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("loginLogs");
    res.json(user.loginLogs);
  } catch (error) {
    res.status(500).json({ message: "Could not fetch login logs" });
  }
};