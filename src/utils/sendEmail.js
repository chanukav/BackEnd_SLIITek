const nodemailer = require("nodemailer");

const buildTransport = () => {
  const user = process.env.EMAIL_USER?.trim();
  const pass = process.env.EMAIL_PASS?.trim();
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
    throw new Error("EMAIL_USER and EMAIL_PASS are required to send mail");
  }

  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
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
  const fromAddress = process.env.EMAIL_FROM?.trim() || process.env.EMAIL_USER?.trim();
  if (!fromAddress) {
    throw new Error("EMAIL_USER or EMAIL_FROM must be set for the From address");
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

module.exports = sendEmail;