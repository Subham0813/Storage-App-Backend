import { IS_SAAS_MODE } from "../misc/constants.js";
import { sendMail } from "./mailProvider.js";
import {
  otpEmailTemplate,
  passwordResetConfirmationTemplate,
  sharingNotificationTemplate,
  accessRevokedEmailTemplate,
  accountBannedTemplate,
  accountRecoveredTemplate,
  invoiceEmailTemplate,
  abandonedCartEmailTemplate,
  subscriptionActionTemplate,
  feedbackUserConfirmationTemplate,
  feedbackAdminAlertTemplate,
  feedbackReplyTemplate,
  adminDirectEmailTemplate,
} from "../utils/emailTemplates.js";

const FROM_EMAIL = process.env.FROM_EMAIL;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || FROM_EMAIL;

/**
 * Send OTP email for login, registration, or password reset
 * @param {string} email - Recipient email address
 * @param {string} otp - 6-digit OTP code
 * @param {string} purpose - "login" | "register" | "forgot-password"
 */
export const sendOtpEmail = async (username, email, otp, purpose) => {
  try {
    const template = otpEmailTemplate(username, otp, purpose);

    const response = await sendMail({
      to: email,
      subject: template.subject,
      html: template.html,
    });

    if (response?.error) {
      throw new Error(`Mail provider error: ${response.error.message}`);
    }

    // console.log(`OTP email sent to ${email} (Purpose: ${purpose})`);
    return response;
  } catch (error) {
    console.error(`Failed to send OTP email to ${email}:`, error.message);
    // Don't throw - allow operation to continue even if email fails
    return null;
  }
};

/**
 * Send password reset confirmation email
 * @param {string} email - Recipient email address
 */
export const sendPasswordResetConfirmation = async (username, email) => {
  try {
    const template = passwordResetConfirmationTemplate(username);

    const response = await sendMail({
      to: email,
      subject: template.subject,
      html: template.html,
    });

    if (response?.error) {
      throw new Error(`Mail provider error: ${response.error.message}`);
    }

    // console.log(`Password reset confirmation sent to ${email}`);
    return response;
  } catch (error) {
    console.error(
      `Failed to send password reset confirmation to ${email}:`,
      error.message,
    );
    return null;
  }
};

/**
 * Send sharing notification email
 * @param {string} email - Recipient email address
 * @param {string} itemName - Name of shared file/directory
 * @param {string} itemType - "file" | "directory"
 * @param {string} senderName - Name of user who shared
 * @param {string} message - Optional custom message from sender
 */
export const sendSharingNotificationEmail = async (
  email,
  itemName,
  itemType,
  senderName,
  message = "",
) => {
  try {
    const template = sharingNotificationTemplate(
      itemName,
      itemType,
      senderName,
      message,
    );

    const response = await sendMail({
      to: email,
      subject: template.subject,
      html: template.html,
    });

    if (response?.error) {
      throw new Error(`Mail provider error: ${response.error.message}`);
    }

    // console.log(
    //   `Sharing notification sent to ${email} for ${itemType}: ${itemName}`
    // );
    return response;
  } catch (error) {
    console.error(
      `Failed to send sharing notification to ${email}:`,
      error.message,
    );
    return null;
  }
};

/**
 * Send account banned notification email
 * @param {string} email - Recipient email address
 */
export const sendAccountBannedEmail = async (username, email) => {
  try {
    const template = accountBannedTemplate(username);

    const response = await sendMail({
      to: email,
      subject: template.subject,
      html: template.html,
    });

    if (response?.error) {
      throw new Error(`Mail provider error: ${response.error.message}`);
    }

    // console.log(`Account banned notification sent to ${email}`);
    return response;
  } catch (error) {
    console.error(
      `Failed to send account banned notification to ${email}:`,
      error.message,
    );
    return null;
  }
};

/**
 * Send account recovered notification email
 * @param {string} email - Recipient email address
 */
export const sendAccountRecoveredEmail = async (username, email) => {
  try {
    const template = accountRecoveredTemplate(username);

    const response = await sendMail({
      to: email,
      subject: template.subject,
      html: template.html,
    });

    if (response?.error) {
      throw new Error(`Mail provider error: ${response.error.message}`);
    }

    // console.log(`Account recovered notification sent to ${email}`);
    return response;
  } catch (error) {
    console.error(
      `Failed to send account recovered notification to ${email}:`,
      error.message,
    );
    return null;
  }
};

/**
 * Send bulk sharing notification emails
 * @param {Array} emails - Array of email strings
 * @param {string} itemName - Name of shared item
 * @param {string} itemType - "file" | "directory"
 * @param {string} senderName - Name of sender
 * @param {string} message - Optional message
 */
export const sendBulkShareEmails = async (
  emails,
  itemName,
  itemType,
  senderName,
  message = "",
) => {
  return sendBulkEmails(
    emails,
    (email) => sharingNotificationTemplate(itemName, itemType, senderName, message),
  );
};

/**
 * Send bulk access-revoked notification emails
 * @param {Array} emails - Array of email strings
 * @param {string} itemName - Name of item access was revoked from
 * @param {string} itemType - "file" | "directory"
 * @param {string} senderName - Name of owner who revoked access
 * @param {string} message - Optional message
 */
export const sendBulkRevokedEmails = async (
  emails,
  itemName,
  itemType,
  senderName,
  message = "",
) => {
  return sendBulkEmails(
    emails,
    (email) => accessRevokedEmailTemplate(itemName, itemType, senderName, message),
  );
};

const sendBulkEmails = async (emails, buildTemplate) => {
  try {
    const promises = emails.map((email) => {
      const template = buildTemplate(email);
      return sendMail({
        to: email,
        subject: template.subject,
        html: template.html,
      });
    });

    const results = await Promise.allSettled(promises);
    const successful = results.filter((r) => r.status === "fulfilled").length;

    console.log(`Sent ${successful}/${emails.length} notification emails`);
    return results;
  } catch (error) {
    console.error(`Failed to send bulk notification emails:`, error.message);
    return [];
  }
};

/**
 * Send official invoice PDF link after successful payment
 * @param {string} email - Recipient email address
 * @param {string} planName - Name of the subscribed plan
 * @param {number} amount - Amount paid in INR
 * @param {string} invoiceUrl - Razorpay short_url to the PDF
 */
export const sendInvoiceEmail = async (
  username,
  email,
  planName,
  amount,
  invoiceUrl,
) => {
  if (!IS_SAAS_MODE) return null;

  try {
    const template = invoiceEmailTemplate(
      username,
      planName,
      amount,
      invoiceUrl,
    );

    const response = await sendMail({
      to: email,
      subject: template.subject,
      html: template.html,
    });

    if (response?.error) {
      throw new Error(`Mail provider error: ${response.error.message}`);
    }

    return response;
  } catch (error) {
    console.error(`Failed to send invoice email to ${email}:`, error.message);
    return null;
  }
};

/**
 * Send abandoned cart reminder after 30 minutes of inactivity
 * @param {string} email - Recipient email address
 * @param {string} checkoutUrl - Link to resume checkout
 */
export const sendAbandonedCartEmail = async (username, email, checkoutUrl) => {
  if (!IS_SAAS_MODE) return null;

  try {
    const template = abandonedCartEmailTemplate(username, checkoutUrl);

    const response = await sendMail({
      to: email,
      subject: template.subject,
      html: template.html,
    });

    if (response?.error) {
      throw new Error(`Mail provider error: ${response.error.message}`);
    }

    return response;
  } catch (error) {
    console.error(
      `Failed to send abandoned cart email to ${email}:`,
      error.message,
    );
    return null;
  }
};

/**
 * Send email for subscription changes (Requested or Executed)
 * @param {string} email - Recipient email address
 * @param {string} action - "cancel" | "downgrade"
 * @param {string} stage - "requested" | "executed"
 * @param {string} effectiveDate - Formatted date string
 */
export const sendSubscriptionActionEmail = async (
  username,
  email,
  action,
  stage,
  effectiveDate,
) => {
  if (!IS_SAAS_MODE) return null;

  try {
    const template = subscriptionActionTemplate(
      username,
      action,
      stage,
      effectiveDate,
    );

    const response = await sendMail({
      to: email,
      subject: template.subject,
      html: template.html,
    });

    if (response?.error) {
      throw new Error(`Mail provider error: ${response.error.message}`);
    }

    return response;
  } catch (error) {
    console.error(
      `Failed to send ${stage} ${action} email to ${email}:`,
      error.message,
    );
    return null;
  }
};

export const processFeedbackEmails = async (
  user,
  category,
  title,
  description,
  screenshotUrl,
) => {
  if (!IS_SAAS_MODE) return null;

  try {
    const userTemplate = feedbackUserConfirmationTemplate(
      user.name || "there",
      category,
    );
    const adminTemplate = feedbackAdminAlertTemplate(
      user.email,
      category,
      title,
      description,
      screenshotUrl,
    );

    const response = await Promise.allSettled([
      // 1. Send confirmation to the user
      sendMail({
        to: user.email,
        subject: userTemplate.subject,
        html: userTemplate.html,
      }),
      // 2. Send alert to the app owner's inbox
      sendMail({
        to: ADMIN_EMAIL,
        subject: adminTemplate.subject,
        html: adminTemplate.html,
      }),
    ]);
    return response;
  } catch (error) {
    console.error(
      `Failed to process feedback emails for ${user.email}:`,
      error.message,
    );
    return null;
  }
};

/**
 * Send an admin reply to a user's feedback submission
 * @param {Object} user - { name, email }
 * @param {Object} feedback - feedback document ({ title })
 * @param {string} message - custom reply message from the admin
 */
export const sendFeedbackReplyEmail = async (user, feedback, message) => {
  if (!IS_SAAS_MODE) return null;

  try {
    const template = feedbackReplyTemplate(user.name || "there", feedback.title, message);

    const response = await sendMail({
      to: user.email,
      subject: template.subject,
      html: template.html,
    });

    if (response?.error) {
      throw new Error(`Mail provider error: ${response.error.message}`);
    }
    return response;
  } catch (error) {
    console.error(`Failed to send feedback reply to ${user.email}:`, error.message);
    throw error;
  }
};

/**
 * Send a direct email to a user from the admin console
 * @param {Object} user - { name, email }
 * @param {string} subject
 * @param {string} message
 */
export const sendAdminDirectEmail = async (user, subject, message) => {
  if (!IS_SAAS_MODE) return null;

  try {
    const template = adminDirectEmailTemplate(user.name || "there", message);

    const response = await sendMail({
      to: user.email,
      subject,
      html: template.html,
    });

    if (response?.error) {
      throw new Error(`Mail provider error: ${response.error.message}`);
    }
    return response;
  } catch (error) {
    console.error(`Failed to send admin email to ${user.email}:`, error.message);
    throw error;
  }
};