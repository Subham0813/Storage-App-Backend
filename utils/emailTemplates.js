const appName = (process.env.APP_NAME || "OwnStorage").replace(
  /own\s*storage/gi,
  "OwnStorage",
);
const CLIENT_URL = process.env.CLIENT_URL || "";
// SaaS emails are always branded with the OwnStorage domain. Self-hosted
// installs keep their OWN links, because the same templates render the
// non-SaaS emails (OTP, password reset, sharing, ban, recovery) that must
// point back at the operator's own instance.
const IS_SAAS_MODE =
  String(process.env.APP_MODE || "saas").trim().toLowerCase() === "saas";
const APP_URL = IS_SAAS_MODE ? "https://ownstorage.space" : CLIENT_URL;
const LOGO_URL = APP_URL ? `${APP_URL}/favicon.png` : "";
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || SUPPORT_EMAIL;
const year = () => new Date().getFullYear();

/**
 * Shared brand tones for the email layout.
 * Every CTA / box color is derived from the tone so the whole template stays
 * consistent with the app palette (blue = default, green = success, red = danger).
 */
const TONES = {
  blue: { accent: "#2563eb", accentDark: "#1d4ed8", box: "#eff6ff", border: "#93c5fd", text: "#1e293b" },
  green: { accent: "#16a34a", accentDark: "#15803d", box: "#f0fdf4", border: "#86efac", text: "#14532d" },
  red: { accent: "#dc2626", accentDark: "#b91c1c", box: "#fef2f2", border: "#fca5a5", text: "#7f1d1d" },
  amber: { accent: "#d97706", accentDark: "#b45309", box: "#fffbeb", border: "#fcd34d", text: "#78350f" },
};

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));

/**
 * Inline-styled CTA button (no class dependency — survives client CSS stripping).
 */
const btn = (label, href, tone = "blue") => {
  const t = TONES[tone] || TONES.blue;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;">
        <tr>
          <td align="center">
            <a href="${href}" target="_blank" style="display:inline-block;background:${t.accent};padding:13px 32px;border-radius:10px;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.01em;">${label}</a>
          </td>
        </tr>
      </table>`;
};

/**
 * Content highlight box (success / info / warning). Fully inline-styled.
 */
const box = (html, tone = "blue") => {
  const t = TONES[tone] || TONES.blue;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
        <tr>
          <td style="background:${t.box};border:1px solid ${t.border};border-left:4px solid ${t.accent};border-radius:10px;padding:16px 20px;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.65;color:${t.text};">${html}</td>
        </tr>
      </table>`;
};

const sectionLabel = (label) =>
  `<p style="margin:22px 0 6px;font-family:'Segoe UI',Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;">${label}</p>`;

/**
 * Shared shell for every email: brand header (logo + wordmark), body, footer.
 * @param {Object} opts
 * @param {string} opts.title      - page subtitle shown under the brand (e.g. "Verify your account")
 * @param {string} opts.body       - template body HTML
 * @param {("blue"|"green"|"red"|"amber")} opts.tone
 * @param {string} opts.appealTo   - optional admin/escalation address (mailto line, e.g. ban disputes)
 * @param {string} opts.footer     - optional extra footer line (e.g. payment processor note)
 * @param {string} opts.subject    - subject (used in <title> and fallback)
 */
const renderLayout = ({ title, subject, body, tone = "blue", appealTo = null, footer = "" }) => {
  const word = `<strong><span style="color:#2563eb;">Own</span><span style="color:#1e293b;">Storage</span></strong>`;
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>${escapeHtml(subject || title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f1f5f9;word-spacing:normal;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr>
              <td style="padding:26px 32px 22px;border-bottom:1px solid #f1f5f9;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="vertical-align:middle;">
                      <table role="presentation" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="vertical-align:middle;padding-right:12px;">
                            ${LOGO_URL ? `<img src="${LOGO_URL}" width="44" height="44" alt="${escapeHtml(appName)}" style="display:block;width:44px;height:44px;border-radius:12px;">` : ""}
                          </td>
                          <td style="vertical-align:middle;">
                            <span style="font-family:'Segoe UI',Arial,sans-serif;font-size:20px;line-height:1.2;letter-spacing:-0.02em;">${word}</span>
                          </td>
                        </tr>
                      </table>
                    </td>
                    <td align="right" style="vertical-align:middle;">
                      <span style="font-family:'Segoe UI',Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;">${escapeHtml(title)}</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 32px 26px;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#334155;">
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:22px 32px;background:#f8fafc;border-top:1px solid #eef2f7;">
                ${appealTo ? `<p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:13px;line-height:1.6;color:#475569;text-align:center;">For account issues, reach us at <a href="mailto:${appealTo}" style="color:${TONES[tone]?.accent || TONES.blue.accent};text-decoration:none;font-weight:600;">${appealTo}</a></p>` : ""}
                ${SUPPORT_EMAIL ? `<p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;color:#64748b;text-align:center;">Need help? <a href="mailto:${SUPPORT_EMAIL}" style="color:${TONES[tone]?.accent || TONES.blue.accent};text-decoration:none;font-weight:600;">${SUPPORT_EMAIL}</a></p>` : ""}
                ${footer ? `<p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;color:#94a3b8;text-align:center;">${footer}</p>` : ""}
                <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;line-height:1.6;color:#94a3b8;text-align:center;">&copy; ${year()} <strong>${escapeHtml(appName)}</strong>. All rights reserved. <a href="${APP_URL}" style="color:#94a3b8;text-decoration:underline;">Visit us</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

const signOff = `<p style="margin:22px 0 0;">Warmly,<br><strong>${escapeHtml(appName)} Team</strong></p>`;

/* ───────────────────────────── 1. OTP ───────────────────────────── */

export const otpEmailTemplate = (username, email, otp, purpose) => {
  const purposeConfig = {
    login: {
      title: "Login Verification",
      description: "Here is the code you need to access your account",
    },
    register: {
      title: "Account Verification",
      description: "Welcome! Here is the code to verify your new account",
    },
    "forgot-password": {
      title: "Password Reset",
      description: "Here is the code you requested to reset your password",
    },
  };

  const config = purposeConfig[purpose] || purposeConfig.login;
  const resetLink =
    purpose === "forgot-password"
      ? `${CLIENT_URL}/verify-otp?email=${encodeURIComponent(email)}&purpose=forgot-password`
      : null;

  const body = `
    <p style="margin:0 0 6px;">Hi ${escapeHtml(username)},</p>
    <p style="margin:0 0 6px;">${escapeHtml(config.description)}. Please enter the one-time password below:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;">
      <tr>
        <td align="center" style="background:#f8fafc;border:2px solid #bfdbfe;border-radius:12px;padding:22px;">
          <span style="font-family:Consolas,Menlo,monospace;font-size:34px;font-weight:700;letter-spacing:8px;color:#2563eb;">${escapeHtml(otp)}</span>
          <p style="margin:10px 0 0;font-family:Arial,sans-serif;font-size:13px;color:#64748b;">This code will expire in 5 minutes.</p>
          <p style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:11px;color:#94a3b8;">If it expires, simply request a new one.</p>
        </td>
      </tr>
    </table>
    ${resetLink ? btn("Continue to reset your password", resetLink) : ""}
    ${resetLink ? `<p style="margin:10px 0 0;font-family:Arial,sans-serif;font-size:13px;text-align:center;"><a href="${resetLink}" style="color:#2563eb;text-decoration:none;">Or open the reset page directly</a></p>` : ""}
    ${box(`<strong>&#9888;&#65039; Quick safety note:</strong> Please keep this code to yourself. Our team will never ask you for it.`, "amber")}
    <p style="margin:14px 0 0;">If you didn&rsquo;t request this, please don&rsquo;t worry &mdash; your account is safe. You can simply ignore and delete this email.</p>
    ${signOff}
  `;

  return {
    subject: `Your code for ${config.title.toLowerCase()} - ${appName}`,
    html: renderLayout({ title: config.title, subject: `Your code for ${config.title.toLowerCase()} - ${appName}`, body, tone: "blue" }),
  };
};

/* ───────────────────── 2. Password reset confirmation ───────────────────── */

export const passwordResetConfirmationTemplate = (username) => {
  const body = `
    <p style="margin:0 0 6px;">Hi ${escapeHtml(username)},</p>
    ${box(`<strong>&#10004;&#65039; Your password has been successfully reset!</strong>`, "green")}
    <p style="margin:0 0 6px;">You&rsquo;re all set to log back into your <strong>${escapeHtml(appName)}</strong> account using your new password.</p>
    ${box(`<strong>&#9888;&#65039; Quick check:</strong> If you did not make this change, please contact our support team immediately so we can secure your account.`, "red")}
    ${signOff}
  `;

  return {
    subject: `Your password was successfully updated - ${appName}`,
    html: renderLayout({
      title: "Password Update Complete",
      subject: `Your password was successfully updated - ${appName}`,
      body,
      tone: "green",
    }),
  };
};

/* ───────────────────── 3. Sharing notification ───────────────────── */

export const sharingNotificationTemplate = (
  itemName,
  itemType,
  senderName,
  message,
) => {
  const body = `
    ${box(`<p style="margin:0 0 4px;"><strong>${escapeHtml(senderName)}</strong> has shared a ${escapeHtml(itemType)} with you:</p>
    <p style="margin:0;font-size:18px;font-weight:700;">${escapeHtml(itemName)}</p>
    <p style="margin:4px 0 0;font-size:12px;color:#64748b;text-transform:capitalize;">${escapeHtml(itemType)}</p>`, "blue")}
    ${message ? box(`<strong>They also left a message for you:</strong><br><br><em>&ldquo;${escapeHtml(message)}&rdquo;</em>`, "blue") : ""}
    <p style="margin:0 0 6px;">You can view and access it right now by logging into your account.</p>
    ${btn("View in " + escapeHtml(appName), APP_URL)}
  `;

  return {
    subject: `Great news! ${senderName} shared a ${itemType} with you - ${appName}`,
    html: renderLayout({
      title: "You have a new shared item!",
      subject: `Great news! ${senderName} shared a ${itemType} with you - ${appName}`,
      body,
      tone: "blue",
    }),
  };
};

/* ───────────────────── 4. Access revoked ───────────────────── */

export const accessRevokedEmailTemplate = (
  itemName,
  itemType,
  senderName,
  message,
) => {
  const body = `
    ${box(`<p style="margin:0 0 4px;"><strong>${escapeHtml(senderName)}</strong> has removed your access to the following ${escapeHtml(itemType)}:</p>
    <p style="margin:0;font-size:18px;font-weight:700;">${escapeHtml(itemName)}</p>
    <p style="margin:4px 0 0;font-size:12px;color:#64748b;text-transform:capitalize;">${escapeHtml(itemType)}</p>`, "red")}
    ${message ? box(`<strong>They also left a message for you:</strong><br><br><em>&ldquo;${escapeHtml(message)}&rdquo;</em>`, "blue") : ""}
    <p style="margin:0 0 6px;">You can no longer view, download or access this item. If you think this was a mistake, you can reply to this email or contact the person who shared it with you.</p>
  `;

  return {
    subject: `Access removed: ${itemName} - ${appName}`,
    html: renderLayout({
      title: "Access to a shared item was removed",
      subject: `Access removed: ${itemName} - ${appName}`,
      body,
      tone: "red",
    }),
  };
};

/* ───────────────────── 5. Account banned ───────────────────── */

export const accountBannedTemplate = (username) => {
  const body = `
    <p style="margin:0 0 6px;">Hi ${escapeHtml(username)},</p>
    ${box(`<strong>&#9888;&#65039; Your account has been temporarily suspended.</strong>`, "red")}
    <p style="margin:0 0 6px;">We are writing to let you know that we&rsquo;ve had to place a temporary suspension on your <strong>${escapeHtml(appName)}</strong> account due to a violation of our terms of service.</p>
    <p style="margin:0 0 6px;">We completely understand this might be frustrating or confusing. If you believe this was a mistake, or if you&rsquo;d like to discuss the situation with us, we are more than happy to review it.</p>
    ${ADMIN_EMAIL ? `<p style="margin:0 0 6px;">Please reach out to our team directly at <a href="mailto:${ADMIN_EMAIL}" style="color:#2563eb;text-decoration:none;font-weight:600;">${ADMIN_EMAIL}</a> and we&rsquo;ll look into it for you.</p>` : ""}
    <p style="margin:18px 0 0;">Regards,<br><strong>${escapeHtml(appName)} Trust &amp; Safety Team</strong></p>
  `;

  return {
    subject: `Important update regarding your account status - ${appName}`,
    html: renderLayout({
      title: "Account Status Update",
      subject: `Important update regarding your account status - ${appName}`,
      body,
      tone: "red",
      appealTo: ADMIN_EMAIL,
    }),
  };
};

/* ───────────────────── 6. Account recovered ───────────────────── */

export const accountRecoveredTemplate = (username) => {
  const body = `
    <p style="margin:0 0 6px;">Hi ${escapeHtml(username)},</p>
    ${box(`<strong>&#127881; Your account is officially back up and running!</strong>`, "green")}
    <p style="margin:0 0 6px;">We&rsquo;ve fully restored your <strong>${escapeHtml(appName)}</strong> account, and you are good to log back in. Thank you so much for your patience while we sorted this out.</p>
    <p style="margin:0 0 6px;">If you have any questions or need a hand getting back up to speed, just reply to this email.</p>
    ${btn("Log back in", APP_URL, "green")}
    ${signOff}
  `;

  return {
    subject: `Welcome back! Your account has been restored - ${appName}`,
    html: renderLayout({
      title: "Account Restored",
      subject: `Welcome back! Your account has been restored - ${appName}`,
      body,
      tone: "green",
    }),
  };
};

/* ───────────────────── 7. Invoice ───────────────────── */

export const invoiceEmailTemplate = (
  username,
  planName,
  amount,
  invoiceUrl,
) => {
  const body = `
    <p style="margin:0 0 6px;">Hi ${escapeHtml(username)},</p>
    <p style="margin:0 0 6px;">A huge thank you from all of us for choosing the <strong>${escapeHtml(planName)}</strong> plan! We&rsquo;re absolutely thrilled to have you with us, and your payment was successfully processed.</p>
    <p style="margin:0 0 6px;">Your new storage limits and premium features are already active on your account.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
      <tr>
        <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:18px 22px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#334155;">
            <tr>
              <td style="padding:5px 0;width:50%;color:#64748b;">Issued by</td>
              <td style="padding:5px 0;font-weight:600;text-align:right;">Subham Bachar (Proprietor, trading as OwnStorage)</td>
            </tr>
            <tr>
              <td style="padding:5px 0;width:50%;color:#64748b;">Amount Paid</td>
              <td style="padding:5px 0;font-weight:700;text-align:right;">&#8377;${escapeHtml(amount)}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;width:50%;color:#64748b;">Plan</td>
              <td style="padding:5px 0;font-weight:600;text-align:right;">${escapeHtml(planName)}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 6px;">If you need a copy of your receipt for your records, you can download your official PDF receipt using the link below:</p>
    ${btn("View My Receipt", invoiceUrl)}
  `;

  return {
    subject: `Thank you for upgrading to ${planName}! (Receipt inside) - ${appName}`,
    html: renderLayout({
      title: "Welcome to Premium!",
      subject: `Thank you for upgrading to ${planName}! (Receipt inside) - ${appName}`,
      body,
      tone: "blue",
      footer: `Payment processed by <strong>Subham Bachar</strong>, sole proprietor of <strong>OwnStorage</strong>. No GST is charged on this transaction. For refunds, cancellations, or receipt queries, reply to this email.`,
    }),
  };
};

/* ───────────────────── 8. Abandoned cart ───────────────────── */

export const abandonedCartEmailTemplate = (username, checkoutUrl) => {
  const body = `
    <p style="margin:0 0 6px;">Hi ${escapeHtml(username)},</p>
    <p style="margin:0 0 6px;">We noticed you were taking a look at upgrading your storage plan earlier, but didn&rsquo;t quite get a chance to finish checking out.</p>
    <p style="margin:0 0 6px;">If you ran into any technical hiccups, or if you just have some questions about what the premium features can do for your workflow, please let us know! We&rsquo;re always here to help.</p>
    <p style="margin:0 0 6px;">If you&rsquo;re ready to unlock more storage and faster parallel uploads, we saved your spot. You can pick up right where you left off below:</p>
    ${btn("Resume My Upgrade", checkoutUrl, "green")}
    <p style="margin:16px 0 0;font-size:13px;color:#64748b;">If you changed your mind, feel free to ignore this email. We&rsquo;re just glad to have you using <strong>${escapeHtml(appName)}</strong>!</p>
  `;

  return {
    subject: `Did you run into any issues upgrading? - ${appName}`,
    html: renderLayout({
      title: "Can we help you with anything?",
      subject: `Did you run into any issues upgrading? - ${appName}`,
      body,
      tone: "green",
    }),
  };
};

/* ───────────────────── 9. Subscription action ───────────────────── */

export const subscriptionActionTemplate = (
  username,
  action,
  effectiveDate,
) => {
  const isCancel = action === "cancel";
  const isUpgrade = action === "upgrade";
  const isActivation = action === "activation";

  let title = "";
  let subject = "";
  let description = "";
  let tone = isUpgrade || isActivation ? "green" : "amber";

  if (isActivation) {
    title = "Subscription Activated";
    subject = `Your subscription is now active - ${appName}`;
    description = `Welcome aboard! Your <strong>${escapeHtml(appName)}</strong> subscription is active and your new storage limits and premium features are available on your account right away. Your current billing cycle ends on <strong>${escapeHtml(effectiveDate)}</strong>.`;
  } else if (isUpgrade) {
    title = "Plan Upgrade Successful";
    subject = `Your plan has been upgraded - ${appName}`;
    description = `Great news! Your plan has been successfully upgraded as of today. Your new premium limits are now active on your account. Your new billing cycle ends on <strong>${escapeHtml(effectiveDate)}</strong>.`;
  } else {
    tone = "red";
    title = isCancel
      ? "Subscription Officially Ended"
      : "Plan Downgrade Complete";
    subject = isCancel
      ? `Your subscription has now ended - ${appName}`
      : `Your plan downgrade is now active - ${appName}`;

    description = isCancel
      ? `This is just a quick note to confirm that your subscription has officially ended as of today, <strong>${escapeHtml(effectiveDate)}</strong>, and your account has been transitioned to our Free plan.<br><br><strong>Important:</strong> If you are over your free storage limit, please free up some space soon so you can continue backing up new files.`
      : `This is a quick note to let you know that your plan downgrade has been successfully processed as of today, <strong>${escapeHtml(effectiveDate)}</strong>. Your new storage limits are now active on your account.`;
  }

  const body = `
    <p style="margin:0 0 6px;">Hi ${escapeHtml(username)},</p>
    ${box(`<p style="margin:0;">${description}</p>`, tone)}
    ${isUpgrade || isActivation ? `<p style="margin:0 0 6px;">Enjoy your new features! If you have any questions about your new plan, feel free to reach out to our support team.</p>` : ""}
    ${!isUpgrade && !isActivation ? `<p style="margin:0 0 6px;">You're always welcome to upgrade your plan again anytime from your billing dashboard. Thank you for being part of the <strong>${escapeHtml(appName)}</strong> community!</p>` : ""}
    ${signOff}
  `;

  return {
    subject,
    html: renderLayout({
      title,
      subject,
      body,
      tone,
      footer: `Payments processed by Subham Bachar (trading as <strong>OwnStorage</strong>).`,
    }),
  };
};

/* ───────────────────── 10. Feedback user confirmation ───────────────────── */

const PROBLEM_CATEGORIES = [
  "upload",
  "preview",
  "sharing",
  "billing",
  "performance",
  "other",
];

export const feedbackUserConfirmationTemplate = (userName, category) => {
  const isProblem = PROBLEM_CATEGORIES.includes(category);
  const title = isProblem ? "We got your report!" : "Thanks for your feedback!";
  const description = isProblem
    ? `Thank you so much for taking the time to report this issue with ${escapeHtml(category)}. We know problems like this can be frustrating, so we really appreciate you letting us know. Our team is looking into it right now.`
    : `Thank you so much for sharing your thoughts with us! We read every single piece of feedback we get, and it directly helps us decide what to build next.`;

  const body = `
    <p style="margin:0 0 6px;">Hi ${escapeHtml(userName)},</p>
    ${box(escapeHtml(description), isProblem ? "amber" : "blue")}
    <p style="margin:0 0 6px;">If we need any more details from you, we&rsquo;ll reply directly to this thread.</p>
    ${signOff}
  `;

  return {
    subject: `${title} - ${appName}`,
    html: renderLayout({
      title,
      subject: `${title} - ${appName}`,
      body,
      tone: isProblem ? "amber" : "blue",
    }),
  };
};

/* ───────────────────── 11. Feedback admin alert ───────────────────── */

export const feedbackAdminAlertTemplate = (
  userEmail,
  category,
  title,
  description,
  screenshotUrl,
) => {
  const body = `
    ${sectionLabel("New feedback received")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#334155;">
      <tr>
        <td style="padding:4px 0;width:30%;color:#64748b;">From</td>
        <td style="padding:4px 0;font-weight:600;">${escapeHtml(userEmail)}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;width:30%;color:#64748b;">Category</td>
        <td style="padding:4px 0;font-weight:600;text-transform:capitalize;">${escapeHtml(category)}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;width:30%;color:#64748b;">Title</td>
        <td style="padding:4px 0;font-weight:600;">${escapeHtml(title)}</td>
      </tr>
    </table>
    ${box(escapeHtml(description), "amber")}
    ${screenshotUrl
      ? `<p style="margin:14px 0 0;font-family:Arial,sans-serif;font-size:13px;"><strong>Screenshot:</strong> <a href="${escapeHtml(screenshotUrl)}" target="_blank" style="color:#2563eb;text-decoration:none;">View Screenshot</a></p>`
      : `<p style="margin:14px 0 0;font-family:Arial,sans-serif;font-size:13px;color:#64748b;"><em>No screenshot provided.</em></p>`}
  `;

  return {
    subject: `🚨 New ${category.toUpperCase()}: ${title}`,
    html: renderLayout({
      title: "New Feedback Received",
      subject: `New ${category.toUpperCase()}: ${title}`,
      body,
      tone: "amber",
      footer: `Sent to admin inbox: ${escapeHtml(ADMIN_EMAIL)}`,
    }),
  };
};

/* ───────────────────── 12. Feedback reply ───────────────────── */

export const feedbackReplyTemplate = (userName, feedbackTitle, message) => {
  const body = `
    <p style="margin:0 0 6px;">Hi ${escapeHtml(userName)},</p>
    ${box(message.replace(/\n/g, "<br>"), "blue")}
    <p style="margin:0 0 6px;">Thanks for helping us make <strong>${escapeHtml(appName)}</strong> better!</p>
    ${signOff}
  `;

  return {
    subject: `Re: "${feedbackTitle}" - ${appName}`,
    html: renderLayout({
      title: "Response to your feedback",
      subject: `Re: "${feedbackTitle}" - ${appName}`,
      body,
      tone: "blue",
    }),
  };
};

/* ───────────────────── 13. Admin direct email ───────────────────── */

export const adminDirectEmailTemplate = (userName, message, subject) => {
  const emailSubject = subject?.trim() || `Update from the ${appName} Team`;

  const body = `
    <p style="margin:0 0 6px;">Hi ${escapeHtml(userName)},</p>
    ${box(message.replace(/\n/g, "<br>"), "blue")}
    <p style="margin:0 0 6px;">If you have any questions, feel free to reply to this email.</p>
    ${signOff}
  `;

  return {
    subject: emailSubject,
    html: renderLayout({
      title: emailSubject,
      subject: emailSubject,
      body,
      tone: "blue",
    }),
  };
};