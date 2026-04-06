/** Sri Lanka mobile helpers: signup stores 10-digit local (0XXXXXXXXX). Twilio uses whatsapp:+94XXXXXXXXX. */

const digitsOnly = (s) => String(s || "").replace(/\D/g, "");

/**
 * @returns {string|null} nine-digit mobile without leading 0 or country code (e.g. 712345678)
 */
const toCanonical9 = (input) => {
  let d = digitsOnly(input);
  if (!d) return null;
  if (d.startsWith("94")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length === 9 && /^7\d{8}$/.test(d)) return d;
  return null;
};

const toE164LK = (input) => {
  const c = toCanonical9(input);
  return c ? `+94${c}` : null;
};

const toWhatsAppAddress = (input) => {
  const e = toE164LK(input);
  return e ? `whatsapp:${e}` : null;
};

/** Normalize phone for MongoDB storage (10-digit local with leading 0). */
const normalizePhoneForStorage = (input) => {
  const c = toCanonical9(input);
  if (!c) return null;
  return `0${c}`;
};

/** Values that might exist in DB for the same handset. */
const phoneLookupVariants = (input) => {
  const c = toCanonical9(input);
  if (!c) return [];
  const raw = digitsOnly(input);
  return Array.from(
    new Set([
      `0${c}`,
      c,
      `94${c}`,
      `+94${c}`,
      raw,
    ])
  );
};

const findUserByPhone = async (User, input) => {
  const variants = phoneLookupVariants(input);
  if (!variants.length) return null;
  return User.findOne({ phone: { $in: variants } });
};

module.exports = {
  digitsOnly,
  toCanonical9,
  toE164LK,
  toWhatsAppAddress,
  normalizePhoneForStorage,
  phoneLookupVariants,
  findUserByPhone,
};
