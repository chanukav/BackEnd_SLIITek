const nodemailer = require("nodemailer");

/**
 * Gmail app passwords are often pasted with spaces; SMTP expects 16 chars without spaces.
 * Supports EMAIL_USER/EMAIL_PASS (main .env) or EMAIL/PASS (otp-gmail-backend/.env style).
 */
const getSmtpCredentials = () => {
  const user = (process.env.EMAIL_USER || process.env.EMAIL || "").trim();
  const passRaw = (process.env.EMAIL_PASS || process.env.PASS || "").trim();
  const pass = passRaw.replace(/\s/g, "");
  return { user, pass };
};

const buildTransport = () => {
  const { user, pass } = getSmtpCredentials();
  const host = process.env.EMAIL_SMTP_HOST?.trim();
  const portRaw = process.env.EMAIL_SMTP_PORT?.trim();
  const port = portRaw ? Number(portRaw) : null;

  if (host && port) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });
  }

  if (!user || !pass) {
    throw new Error(
      "Set EMAIL_USER and EMAIL_PASS (or EMAIL and PASS) to send mail"
    );
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
};

/**
 * @param {string} to
 * @param {string} subject
 * @param {string} text
 * @param {string} html
 * @param {{ bcc?: string | string[], cc?: string | string[] }} [opts]
 */
const sendEmail = async (to, subject, text, html, opts = {}) => {
  const { user } = getSmtpCredentials();
  const fromAddress =
    process.env.EMAIL_FROM?.trim() || process.env.EMAIL_USER?.trim() || user;
  if (!fromAddress) {
    throw new Error(
      "EMAIL_USER, EMAIL, or EMAIL_FROM must be set for the From address"
    );
  }

  const transporter = buildTransport();

  const mailOptions = {
    from: `"SLIITEK" <${fromAddress}>`,
    to,
    subject,
    text,
    html,
  };

  if (opts.bcc) {
    mailOptions.bcc = opts.bcc;
  }
  if (opts.cc) {
    mailOptions.cc = opts.cc;
  }

  return transporter.sendMail(mailOptions);
};

sendEmail.isConfigured = () => {
  const { user, pass } = getSmtpCredentials();
  return Boolean(user && pass);
};

module.exports = sendEmail;
