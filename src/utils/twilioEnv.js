/**
 * Shared Twilio Verify env checks (forgot-password WhatsApp OTP).
 */

const isLikelyTwilioPlaceholder = (val) => {
  const s = String(val || "").trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  if (lower.includes("xxxx")) return true;
  if (lower.includes("your_")) return true;
  if (lower.includes("placeholder")) return true;
  if (lower.includes("changeme")) return true;
  return false;
};

const isTwilioVerifyConfigured = () => {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const svc = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
  if (!sid || !token || !svc) return false;
  if (isLikelyTwilioPlaceholder(sid)) return false;
  if (isLikelyTwilioPlaceholder(token)) return false;
  if (isLikelyTwilioPlaceholder(svc)) return false;
  return true;
};

const twilioVerifyStatusMessage = () => {
  if (isTwilioVerifyConfigured()) return null;
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim() || "";
  if (sid && isLikelyTwilioPlaceholder(sid)) {
    return 'TWILIO_* values in .env look like demo text (e.g. "xxxx"). Replace them with real values from https://console.twilio.com/';
  }
  return "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID in BackEnd/.env from https://console.twilio.com/ (Verify → Services).";
};

module.exports = {
  isLikelyTwilioPlaceholder,
  isTwilioVerifyConfigured,
  twilioVerifyStatusMessage,
};
