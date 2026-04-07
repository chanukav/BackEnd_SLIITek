const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");

// Load env variables from monolith root .env
dotenv.config();

const sendEmail = require("./utils/sendEmail");
if (sendEmail.isConfigured()) {
  console.log("[EMAIL] OTP mail is configured.");
} else {
  console.warn(
    "[EMAIL] OTP mail is NOT configured. Set EMAIL_USER (or EMAIL) and EMAIL_PASS (or PASS) in BackEnd_SLIITek/.env. If you use Gmail, you must use an App Password (not your normal password)."
  );
}

const { isTwilioVerifyConfigured, twilioVerifyStatusMessage } = require("./utils/twilioEnv");
if (!isTwilioVerifyConfigured()) {
  console.warn(
    "\n[TWILIO] Verify WhatsApp not configured — forgot-password uses an in-app generated code (see API devOtp / server log).\n       ",
    twilioVerifyStatusMessage(),
    "\n"
  );
}

const app = express();

// Allow local dev origins by default, but also honor env overrides.
// `CLIENT_URL` can be a single origin or a comma-separated list.
const defaultLocalOrigins = ["http://localhost:5173", "http://localhost:5174"];
const clientOriginsRaw = process.env.CLIENT_URLS || process.env.CLIENT_URL;
const allowedOrigins = [
  ...(clientOriginsRaw
    ? clientOriginsRaw.split(",").map((origin) => origin.trim()).filter(Boolean)
    : []),
  ...defaultLocalOrigins,
].filter(Boolean);

// Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests like Postman/curl that may have no Origin header.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

const notificationRoutes = require('./routes/notificationRoutes');
const sampleUserRoutes = require("./routes/sampleUserRoutes")
const reportRoutes = require('./routes/report.routes');
const authRoutes = require("./routes/authRoutes");
const questionRoutes = require("./routes/questionRoutes");
const answerRoutes = require("./routes/answerRoutes");
const userDashboardRoutes = require("./routes/userDashboardRoutes");

// Basic route
app.get('/', (req, res) => {
    res.send('API is running...');
});

// Mount Routes
app.use('/api/notifications', notificationRoutes);
app.use("/api/sample-users", sampleUserRoutes)
app.use('/api/reports', reportRoutes);
app.use("/api/user-dashboard", userDashboardRoutes);
// Static folder (uploads)
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));
app.use("/api/auth", authRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/answers", answerRoutes);


// MongoDB connect + server start
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB connected");

    // Initialize the background worker within the monolith
    require("./workers/notificationWorker");

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
  });