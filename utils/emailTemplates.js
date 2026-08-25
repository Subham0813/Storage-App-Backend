const appName = process.env.APP_NAME;
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@ownstorage.cloud";

export const otpEmailTemplate = (username, otp, purpose) => {
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

  return {
    subject: `Your code for ${config.title.toLowerCase()} - ${appName}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .otp-box { background: white; border: 2px solid #667eea; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0; }
            .otp-code { font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #667eea; font-family: monospace; }
            .expiry { color: #666; font-size: 14px; margin-top: 10px; }
            .footer { text-align: center; color: #999; font-size: 12px; margin-top: 20px; }
            .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 10px; margin: 15px 0; border-radius: 4px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${appName}</h1>
              <p>${config.title}</p>
            </div>
            <div class="content">
              <p>Hi ${username},</p>
              <p>${config.description}. Please enter the one-time password below:</p>
              <div class="otp-box">
                <div class="otp-code">${otp}</div>
                <div class="expiry">This code will expire in 5 minutes.</div>
              </div>
              <div class="warning">
                <strong>⚠️ Quick Safety Note:</strong> Please keep this code to yourself. Our team will never ask you for it.
              </div>
              <p>If you didn't request this, please don't worry—your account is safe. You can simply ignore and delete this email.</p>
              <p>Warmly,<br>The ${appName} Team</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `,
  };
};

export const passwordResetConfirmationTemplate = (username) => {
  return {
    subject: `Your password was successfully updated - ${appName}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .success-box { background: #d4edda; border: 2px solid #28a745; padding: 15px; border-radius: 8px; text-align: center; margin: 20px 0; }
            .success-icon { font-size: 40px; margin-bottom: 10px; }
            .footer { text-align: center; color: #999; font-size: 12px; margin-top: 20px; }
            .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 10px; margin: 15px 0; border-radius: 4px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${appName}</h1>
              <p>Password Update Complete</p>
            </div>
            <div class="content">
              <p>Hi ${username},</p>
              <div class="success-box">
                <div class="success-icon">✓</div>
                <p><strong>Your password has been successfully reset!</strong></p>
              </div>
              <p>You're all set to log back into your ${appName} account using your new password.</p>
              <div class="warning">
                <strong>⚠️ Quick Check:</strong> If you did not make this change, please contact our support team immediately so we can secure your account.
              </div>
              <p>Warmly,<br>The ${appName} Team</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `,
  };
};

export const sharingNotificationTemplate = (
  itemName,
  itemType,
  senderName,
  message,
) => {
  return {
    subject: `Great news! ${senderName} shared a ${itemType} with you - ${appName}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .item-box { background: white; border-left: 4px solid #667eea; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .item-name { font-size: 18px; font-weight: bold; color: #667eea; }
            .item-type { color: #666; font-size: 14px; text-transform: capitalize; }
            .message-box { background: #e8f4f8; padding: 15px; border-radius: 4px; margin: 15px 0; border-left: 4px solid #17a2b8; }
            .cta-button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 4px; margin: 20px 0; font-weight: bold; }
            .footer { text-align: center; color: #999; font-size: 12px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${appName}</h1>
              <p>You have a new shared item!</p>
            </div>
            <div class="content">
              <p>Hi there,</p>
              <p>We wanted to let you know that <strong>${senderName}</strong> has shared a ${itemType} with you:</p>
              <div class="item-box">
                <div class="item-name">📁 ${itemName}</div>
                <div class="item-type">${itemType}</div>
              </div>
              ${message ? `<div class="message-box"><strong>They also left a message for you:</strong><br><br><em>"${message}"</em></div>` : ""}
              <p>You can view and access it right now by logging into your account.</p>
              <div style="text-align: left;">
                <a href=${process.env.CLIENT_APP_URL} class="cta-button">View in ${appName}</a>
              </div>
              <p>Best,<br>The ${appName} Team</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `,
  };
};

export const accountBannedTemplate = (username) => {
  return {
    subject: `Important update regarding your account status - ${appName}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .warning-box { background: #f8d7da; border: 2px solid #f5c6cb; padding: 15px; border-radius: 8px; text-align: center; margin: 20px 0; }
            .warning-icon { font-size: 40px; margin-bottom: 10px; }
            .footer { text-align: center; color: #999; font-size: 12px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${appName}</h1>
              <p>Account Status Update</p>
            </div>
            <div class="content">
              <p>Hi ${username},</p>
              <div class="warning-box">
                <div class="warning-icon">⚠️</div>
                <p><strong>Your account has been temporarily suspended.</strong></p>
              </div>
              <p>We are writing to let you know that we've had to place a temporary suspension on your ${appName} account due to a violation of our terms of service.</p>
              <p>We completely understand this might be frustrating or confusing. If you believe this was a mistake, or if you'd like to discuss the situation with us, we are more than happy to review it.</p>
              <p>Please reach out to our team directly at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> and we'll look into it for you.</p>
              <p>Regards,<br>The ${appName} Trust & Safety Team</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `,
  };
};

export const accountRecoveredTemplate = (username) => {
  return {
    subject: `Welcome back! Your account has been restored - ${appName}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .success-box { background: #d4edda; border: 2px solid #28a745; padding: 15px; border-radius: 8px; text-align: center; margin: 20px 0; }
            .success-icon { font-size: 40px; margin-bottom: 10px; }
            .footer { text-align: center; color: #999; font-size: 12px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${appName}</h1>
              <p>Account Restored</p>
            </div>
            <div class="content">
              <p>Hi ${username},</p>
              <div class="success-box">
                <div class="success-icon">🎉</div>
                <p><strong>Your account is officially back up and running!</strong></p>
              </div>
              <p>We've fully restored your ${appName} account, and you are good to log back in. Thank you so much for your patience while we sorted this out.</p>
              <p>If you have any questions or need a hand getting back up to speed, just reply to this email.</p>
              <p>Warmly,<br>The ${appName} Team</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `,
  };
};

export const invoiceEmailTemplate = (username, planName, amount, invoiceUrl) => {
  return {
    subject: `Thank you for upgrading to ${planName}! (Receipt inside) - ${appName}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .btn { display: inline-block; padding: 12px 24px; background-color: #667eea; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 20px; }
            .details { background: white; padding: 15px; border-radius: 5px; margin: 20px 0; border: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${appName}</h1>
              <p>Welcome to Premium!</p>
            </div>
            <div class="content">
              <p>Hi ${username},</p>
              <p>A huge thank you from all of us for choosing the <strong>${planName}</strong> plan! We're absolutely thrilled to have you with us, and your payment was successfully processed.</p>
              <p>Your new storage limits and premium features are already active on your account.</p>
              <div class="details">
                <p><strong>Amount Paid:</strong> ₹${amount}</p>
                <p><strong>Plan:</strong> ${planName}</p>
              </div>
              <p>If you need a copy of your receipt for your records, you can download your official PDF invoice using the link below:</p>
              <div style="text-align: center;">
                <a href="${invoiceUrl}" class="btn" target="_blank">View My Invoice</a>
              </div>
              <p style="margin-top: 30px; font-size: 14px; color: #666;">If you ever need help getting the most out of your new features, please don't hesitate to reply to this email—we'd love to chat!</p>
              <p>Warmly,<br>The ${appName} Team</p>
            </div>
          </div>
        </body>
      </html>
    `
  };
};

export const abandonedCartEmailTemplate = (username, checkoutUrl) => {
  return {
    subject: `Did you run into any issues upgrading? - ${appName}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .btn { display: inline-block; padding: 12px 24px; background-color: #28a745; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${appName}</h1>
              <p>Can we help you with anything?</p>
            </div>
            <div class="content">
              <p>Hi ${username},</p>
              <p>We noticed you were taking a look at upgrading your storage plan earlier, but didn't quite get a chance to finish checking out.</p>
              <p>If you ran into any technical hiccups, or if you just have some questions about what the premium features can do for your workflow, please let us know! We're always here to help.</p>
              <p>If you're ready to unlock more storage and faster parallel uploads, we saved your spot. You can pick up right where you left off below:</p>
              <div style="text-align: center;">
                <a href="${checkoutUrl}" class="btn" target="_blank">Resume My Upgrade</a>
              </div>
              <p style="margin-top: 30px; font-size: 14px; color: #666;">If you changed your mind, feel free to ignore this email. We're just glad to have you using ${appName}!</p>
              <p>Cheers,<br>The ${appName} Team</p>
            </div>
          </div>
        </body>
      </html>
    `
  };
};

export const subscriptionActionTemplate = (username, action, stage, effectiveDate) => {
  const isCancel = action === "cancel";
  const isUpgrade = action === "upgrade";
  const isRequested = stage === "requested";

  let title = "";
  let subject = "";
  let description = "";
  let icon = isUpgrade ? "🎉" : isRequested ? "⏳" : "✅";
  let boxColor = isUpgrade ? "#d4edda" : isRequested ? "#e8f4f8" : "#d4edda";
  let boxBorder = isUpgrade ? "#28a745" : isRequested ? "#17a2b8" : "#28a745";

  if (isUpgrade) {
    title = "Plan Upgrade Successful";
    subject = `Your plan has been upgraded - ${appName}`;
    description = `Great news! Your plan has been successfully upgraded as of today. Your new premium limits are now active on your account. Your new billing cycle ends on <strong>${effectiveDate}</strong>.`;
  } else if (isRequested) {
    title = isCancel ? "Cancellation Request Received" : "Downgrade Request Received";
    subject = isCancel 
      ? `We've received your cancellation request - ${appName}`
      : `We've scheduled your plan downgrade - ${appName}`;

    description = isCancel
      ? `We're genuinely sorry to see you go, but we wanted to confirm that we've received your cancellation request. Please note that your premium features and storage limits will remain fully active until the end of your current billing cycle on <strong>${effectiveDate}</strong>.`
      : `We wanted to confirm that we've successfully scheduled your plan downgrade. Your current premium limits will remain fully active until the end of your billing cycle on <strong>${effectiveDate}</strong>.`;
  } else {
    title = isCancel ? "Subscription Officially Ended" : "Plan Downgrade Complete";
    subject = isCancel
      ? `Your subscription has now ended - ${appName}`
      : `Your plan downgrade is now active - ${appName}`;

    description = isCancel
      ? `This is just a quick note to confirm that your subscription has officially ended as of today, <strong>${effectiveDate}</strong>, and your account has been transitioned to our Free plan.<br><br><strong>Important:</strong> If you are over your free storage limit, please free up some space soon so you can continue backing up new files.`
      : `This is a quick note to let you know that your plan downgrade has been successfully processed as of today, <strong>${effectiveDate}</strong>. Your new storage limits are now active on your account.`;
  }

  return {
    subject: subject,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .info-box { background: ${boxColor}; border-left: 4px solid ${boxBorder}; padding: 15px; border-radius: 4px; margin: 20px 0; font-size: 16px; }
            .icon { font-size: 24px; margin-right: 10px; vertical-align: middle; }
            .footer { text-align: center; color: #999; font-size: 12px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${appName}</h1>
              <p>${title}</p>
            </div>
            <div class="content">
              <p>Hi ${username},</p>
              <div class="info-box">
                <p><span class="icon">${icon}</span>${description}</p>
              </div>
              
              ${isUpgrade ? `<p>Enjoy your new features! If you have any questions about your new plan, feel free to reach out to our support team.</p>` : ''}
              ${isRequested && isCancel ? `<p>If you change your mind before your cycle ends, you can easily resume your subscription from your billing dashboard. Otherwise, we want to say a huge thank you for giving our premium features a try—we really appreciate your past support.</p>` : ''}
              ${isRequested && !isCancel && !isUpgrade ? `<p>If you change your mind before your cycle ends, you can cancel this request from your billing dashboard. Thank you for continuing to use ${appName}!</p>` : ''}
              ${!isRequested && !isUpgrade ? `<p>You're always welcome to upgrade your plan again anytime from your billing dashboard. Thank you for being part of the ${appName} community!</p>` : ''}
              
              <p>Warmly,<br>The ${appName} Team</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `,
  };
};

export const feedbackUserConfirmationTemplate = (userName, category) => {
  const isBug = category === "bug";
  const title = isBug ? "We got your bug report!" : "Thanks for your feedback!";
  const description = isBug
    ? "Thank you so much for taking the time to report this issue. We know bugs can be frustrating, so we really appreciate you letting us know. Our team is taking a look at it right now."
    : "Thank you so much for sharing your thoughts with us! We read every single piece of feedback we get, and it directly helps us decide what to build next.";

  return {
    subject: `${title} - ${appName}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .info-box { background: #e8f4f8; border-left: 4px solid #17a2b8; padding: 15px; border-radius: 4px; margin: 20px 0; font-size: 16px; }
            .footer { text-align: center; color: #999; font-size: 12px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${appName}</h1>
              <p>${title}</p>
            </div>
            <div class="content">
              <p>Hi ${userName},</p>
              <div class="info-box">
                <p>${description}</p>
              </div>
              <p>If we need any more details from you, we'll reply directly to this thread.</p>
              <p>Warmly,<br>The ${appName} Team</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `,
  };
};

export const feedbackAdminAlertTemplate = (userEmail, category, title, description, screenshotUrl) => {
  return {
    subject: `🚨 New ${category.toUpperCase()}: ${title}`,
    html: `
      <h2>New Feedback Received</h2>
      <p><strong>From:</strong> ${userEmail}</p>
      <p><strong>Category:</strong> ${category}</p>
      <p><strong>Title:</strong> ${title}</p>
      <hr />
      <p><strong>Description:</strong><br/>${description}</p>
      <hr />
      ${screenshotUrl ? `<p><strong>Screenshot attached:</strong> <a href="${screenshotUrl}" target="_blank">View Screenshot</a></p>` : "<p><em>No screenshot provided.</em></p>"}
    `,
  };
};

export const feedbackReplyTemplate = (userName, feedbackTitle, message) => {
  return {
    subject: `Re: "${feedbackTitle}" - ${appName}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .info-box { background: #e8f4f8; border-left: 4px solid #17a2b8; padding: 15px; border-radius: 4px; margin: 20px 0; font-size: 15px; white-space: pre-wrap; }
            .footer { text-align: center; color: #999; font-size: 12px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${appName}</h1>
              <p>Re: ${feedbackTitle}</p>
            </div>
            <div class="content">
              <p>Hi ${userName},</p>
              <div class="info-box">${message}</div>
              <p>Thanks for helping us make ${appName} better!</p>
              <p>Warmly,<br>The ${appName} Team</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `,
  };
};

export const adminDirectEmailTemplate = (userName, message) => {
  return {
    subject: `Update from the ${appName} Team`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .info-box { background: #e8f4f8; border-left: 4px solid #17a2b8; padding: 15px; border-radius: 4px; margin: 20px 0; font-size: 15px; white-space: pre-wrap; }
            .footer { text-align: center; color: #999; font-size: 12px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${appName}</h1>
              <p>An update for your account</p>
            </div>
            <div class="content">
              <p>Hi ${userName},</p>
              <div class="info-box">${message}</div>
              <p>If you have any questions, feel free to reply to this email.</p>
              <p>Warmly,<br>The ${appName} Team</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `,
  };
};