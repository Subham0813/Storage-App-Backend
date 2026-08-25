import nodemailer from "nodemailer";
import { Resend } from "resend";
import { EMAIL_PROVIDER } from "../misc/constants.js";

/**
 * Unified transactional mail transport.
 *
 * EMAIL_PROVIDER selects the transport:
 *   - "resend" (default): uses the Resend REST/SDK API        -> RESEND_API_KEY
 *   - "smtp":              uses NodeMailer over any SMTP relay -> SMTP_HOST/PORT/USER/PASS
 *
 * Both transports share the same sendMail({ to, subject, html }) surface so the
 * callers (emailService templates) never need to know which provider is active —
 * the same BYO philosophy as the S3-compatible storage layer.
 */

const FROM_EMAIL = process.env.FROM_EMAIL;

let resendClient = null;
let smtpTransport = null;

const getResendClient = () => {
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
};

const getSmtpTransport = () => {
  if (!smtpTransport) {
    smtpTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure:
        process.env.SMTP_SECURE === "true" ||
        Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD,
      },
    });
  }
  return smtpTransport;
};

/**
 * Send a transactional email through the configured provider.
 * @param {Object} opts
 * @param {string} opts.to - Recipient email address
 * @param {string} opts.subject - Email subject line
 * @param {string} opts.html - HTML body (templates already render to HTML)
 */
export const sendMail = async ({ to, subject, html }) => {
  if (EMAIL_PROVIDER === "smtp") {
    return getSmtpTransport().sendMail({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });
  }

  // Resend (default)
  return getResendClient().emails.send({
    from: FROM_EMAIL,
    to,
    subject,
    html,
  });
};