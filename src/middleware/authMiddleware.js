const jwt = require("jsonwebtoken");
const User = require("../models/user");

/** Standard header-based JWT guard — used on all non-SSE routes */
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authorized",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password -refreshToken");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Token verification failed",
      error: error.message,
    });
  }
};

/**
 * SSE-specific JWT guard — reads token from ?token= query param
 * because the native EventSource API cannot set custom request headers.
 * The token is short-lived (same JWT as normal auth) so the risk is acceptable for this project.
 */
const protectSSE = async (req, res, next) => {
  try {
    const token = req.query.token;

    if (!token) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      return res.end("Unauthorized");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password -refreshToken");

    if (!user) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      return res.end("User not found");
    }

    req.user = user;
    return next();
  } catch (error) {
    res.writeHead(401, { "Content-Type": "text/plain" });
    return res.end("Token verification failed");
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: "Forbidden",
    });
  }

  return next();
};

module.exports = { protect, protectSSE, authorize };
