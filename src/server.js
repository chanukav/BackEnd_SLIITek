const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");

// Load env variables from monolith root .env
dotenv.config({ path: path.join(__dirname, "..", ".env") });

if (!process.env.MONGO_URI) {
  console.error("FATAL ERROR: MONGO_URI is not defined in environment variables.");
  process.exit(1);
}

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === "production") {
    console.error("FATAL ERROR: JWT_SECRET is not defined.");
    process.exit(1);
  } else {
    console.warn("WARNING: JWT_SECRET is not defined. Using development fallback secret.");
    process.env.JWT_SECRET = "dev-fallback-secret-key-12345";
  }
}

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
const adminUserRoutes = require("./routes/adminUserRoutes");

// Health check route
app.get('/api/health', (req, res) => {
    const dbStatus = mongoose.connection.readyState === 1 ? 'UP' : 'DOWN';
    if (dbStatus === 'DOWN') {
        return res.status(500).json({ status: 'DOWN', database: dbStatus });
    }
    res.status(200).json({ status: 'UP', database: dbStatus, timestamp: new Date() });
});

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
app.use("/api/admin/users", adminUserRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/answers", answerRoutes);


// MongoDB connect + server start
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB connected");

    // Initialize the background worker within the monolith
    require("./workers/notificationWorker");
    require("./workers/reportWorker");

    const PORT = process.env.PORT || 5000;
    const http = require("http");
    const server = http.createServer(app);
    
    // Initialize Socket.io
    const io = require("./utils/socket").init(server);
    io.on("connection", (socket) => {
      console.log("Admin connected to real-time moderation socket.");
    });

    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  });