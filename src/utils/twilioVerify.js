const twilio = require("twilio");
const { toE164LK } = require("./phoneUtils");

/**
 * Twilio Verify expects `to` in E.164 (e.g. +94771234567).
 * Do NOT use the Messaging-style prefix `whatsapp:+...` here — that breaks Verification starts.
 * @see https://www.twilio.com/docs/verify/whatsapp
 */
const getVerifyService = () => {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!sid || !token || !serviceSid) {
    throw new Error(
      "Twilio Verify is not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID)"
    );
  }
  return twilio(sid, token).verify.v2.services(serviceSid);
};

const formatTwilioError = (err) => {
  const code = err?.code ?? err?.status;
  const msg = err?.message || String(err);
  if (code) return `${msg} (Twilio ${code})`;
  return msg;
};

/**
 * Sends a Verify OTP. Tries WhatsApp first; unless TWILIO_VERIFY_FALLBACK_SMS=false, falls back to SMS
 * (many accounts get SMS working before WhatsApp templates are approved).
 * @param {string} phone
 * @param {{ allowSmsFallback?: boolean }} [options] — set allowSmsFallback false for WhatsApp-only (e.g. password reset).
 * @returns {{ channel: "whatsapp" | "sms", raw: object }}
 */
const sendWhatsAppOtp = async (phone, options = {}) => {
  const to = toE164LK(phone);
  if (!to) {
    throw new Error("Enter a valid Sri Lanka mobile number (e.g. 07XXXXXXXX)");
  }

  const service = getVerifyService();
  const allowSmsFallback =
    options.allowSmsFallback !== undefined
      ? options.allowSmsFallback
      : process.env.TWILIO_VERIFY_FALLBACK_SMS !== "false";

  try {
    const raw = await service.verifications.create({
      to,
      channel: "whatsapp",
    });
    return { channel: "whatsapp", raw };
  } catch (whatsappErr) {
    console.error("[Twilio Verify] WhatsApp channel failed:", formatTwilioError(whatsappErr));

    if (!allowSmsFallback) {
      throw new Error(formatTwilioError(whatsappErr));
    }

    try {
      console.warn("[Twilio Verify] Retrying with SMS channel…");
      const raw = await service.verifications.create({
        to,
        channel: "sms",
      });
      return { channel: "sms", raw };
    } catch (smsErr) {
      console.error("[Twilio Verify] SMS fallback failed:", formatTwilioError(smsErr));
      throw new Error(formatTwilioError(smsErr));
    }
  }
};

const checkWhatsAppOtp = async (phone, code) => {
  const to = toE164LK(phone);
  if (!to) {
    throw new Error("Invalid phone number");
  }
  try {
    return await getVerifyService().verificationChecks.create({
      to,
      code,
    });
  } catch (err) {
    console.error("[Twilio Verify] Check failed:", formatTwilioError(err));
    throw new Error(formatTwilioError(err));
  }
};

module.exports = {
  sendWhatsAppOtp,
  checkWhatsAppOtp,
};