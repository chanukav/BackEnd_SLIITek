require("dotenv").config();

const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 5000;

// In-memory store: email -> { otp, expiresAt }
const otpStore = new Map();

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes

app.use(cors());
app.use(express.json());

function createTransporter() {
  const user = process.env.EMAIL;
  const pass = process.env.PASS;

  if (!user || !pass) {
    console.error("[config] Missing EMAIL or PASS in environment.");
    throw new Error("Server email configuration is incomplete.");
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user,
      pass, // Must be a Gmail App Password, not your normal password
    },
  });
}

function generateSixDigitOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

app.post("/send-otp", async (req, res) => {
  try {
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim() : "";

    if (!email) {
      console.log("[send-otp] Rejected: missing email");
      return res.status(400).json({ ok: false, error: "Email is required" });
    }

    const otp = generateSixDigitOtp();
    const expiresAt = Date.now() + OTP_TTL_MS;

    otpStore.set(email.toLowerCase(), { otp, expiresAt });

    console.log(`[send-otp] OTP for ${email} (testing): ${otp}`);

    const transporter = createTransporter();

    await transporter.sendMail({
      from: `"OTP Service" <${process.env.EMAIL}>`,
      to: email,
      subject: "Your verification code",
      text: `Your OTP is ${otp}. It expires in 5 minutes.`,
      html: `<p>Your OTP is <strong>${otp}</strong>.</p><p>It expires in 5 minutes.</p>`,
    });

    console.log(`[send-otp] Email sent successfully to ${email}`);
    return res.json({
      ok: true,
      message: "OTP sent to your email",
    });
  } catch (err) {
    console.error("[send-otp] Error:", err.message);
    return res.status(500).json({
      ok: false,
      error: "Failed to send OTP. Check server logs and email configuration.",
    });
  }
});

app.post("/verify-otp", (req, res) => {
  try {
    const emailRaw =
      typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const otpRaw =
      typeof req.body?.otp === "string"
        ? req.body.otp.trim()
        : req.body?.otp != null
          ? String(req.body.otp).trim()
          : "";

    if (!emailRaw || !otpRaw) {
      console.log("[verify-otp] Rejected: missing email or otp");
      return res.status(400).json({
        ok: false,
        status: "invalid",
        message: "Email and OTP are required",
      });
    }

    const email = emailRaw.toLowerCase();
    const entry = otpStore.get(email);

    if (!entry) {
      console.log(`[verify-otp] No OTP found for ${emailRaw}`);
      return res.status(400).json({
        ok: false,
        status: "invalid",
        message: "No OTP found for this email. Request a new code.",
      });
    }

    if (Date.now() > entry.expiresAt) {
      otpStore.delete(email);
      console.log(`[verify-otp] Expired OTP for ${emailRaw}`);
      return res.status(400).json({
        ok: false,
        status: "expired",
        message: "OTP has expired. Request a new code.",
      });
    }

    if (entry.otp !== otpRaw) {
      console.log(`[verify-otp] Wrong OTP for ${emailRaw}`);
      return res.status(400).json({
        ok: false,
        status: "invalid",
        message: "Invalid OTP",
      });
    }

    otpStore.delete(email);
    console.log(`[verify-otp] Success for ${emailRaw}`);
    return res.json({
      ok: true,
      status: "success",
      message: "OTP verified successfully",
    });
  } catch (err) {
    console.error("[verify-otp] Error:", err.message);
    return res.status(500).json({
      ok: false,
      status: "invalid",
      message: "Server error during verification",
    });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`[server] Running on http://localhost:${PORT}`);
  console.log(`[server] POST /send-otp  — send OTP to email`);
  console.log(`[server] POST /verify-otp — verify OTP`);
});
