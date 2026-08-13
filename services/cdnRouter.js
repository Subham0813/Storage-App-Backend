import crypto from "crypto";
import { getSignedUrl as getS3SignedUrl } from "@aws-sdk/s3-request-presigner";
import { getSignedUrl as getCloudFrontSignedUrl } from "@aws-sdk/cloudfront-signer";
import { IS_SAAS_MODE } from "../misc/constants.js";

/**
 * Dynamically routes and signs download/preview URLs based on the active CDN provider.
 *
 * @param {Object} s3Client - The initialized S3 SDK client instance
 * @param {Object} command - The GetObjectCommand instance for the file
 * @param {Object} file - The file document from MongoDB
 * @param {String|ObjectId} userId - The ID of the user requesting the file
 * @param {String} type - "download" (attachment) or "preview" (inline)
 * @returns {Promise<String>} The final secure URL for the client
 */
export const generateSecureDownloadUrl = async (
  s3Client,
  command,
  file,
  userId,
  type = "download",
) => {
  const provider = process.env.CDN_PROVIDER;
  const cdnDomain = process.env.CDN_DOMAIN;

  // 1. CLOUDFLARE WORKER ROUTE (HMAC Proxy) — SaaS only; self-hosted instances
  //    fall through to CloudFront or native S3 pre-signed URLs and track
  //    bandwidth server-side.
  if (process.env.CDN_PROVIDER === "cloudflare" && cdnDomain && IS_SAAS_MODE) {
    // Generate the underlying S3 URL for the worker to fetch from securely
    const s3Url = await getS3SignedUrl(s3Client, command, { expiresIn: 300 });

    const rawPayload = JSON.stringify({
      u: userId.toString(),
      url: s3Url,
    });

    // Sign the payload using the secret shared with the Cloudflare Worker
    const signature = crypto
      .createHmac("sha256", process.env.CLOUDFLARE_WEBHOOK_SECRET)
      .update(rawPayload)
      .digest("hex");

    const token = Buffer.from(`${rawPayload}|${signature}`).toString("base64");
    const route = type === "preview" ? "stream" : "download";

    return `${cdnDomain}/${route}?token=${encodeURIComponent(token)}`;
  }

  // 2. AWS CLOUDFRONT ROUTE
  if (provider === "cloudfront" && cdnDomain) {
    const url = `${cdnDomain}/${file.key}`;
    const responseDisposition = `attachment; filename="${encodeURIComponent(file.name)}"`;

    // CloudFront allows appending response-content-disposition directly to the URL before signing
    const finalUrl =
      type === "download"
        ? `${url}?response-content-disposition=${encodeURIComponent(responseDisposition)}`
        : url;

    // Ensure private key newlines are parsed correctly from the .env file
    const privateKey = process.env.CLOUDFRONT_PRIVATE_KEY.replace(/\\n/g, "\n");

    return getCloudFrontSignedUrl({
      url: finalUrl,
      keyPairId: process.env.CLOUDFRONT_PUBLIC_KEY_ID,
      privateKey: privateKey,
      dateLessThan: new Date(Date.now() + 1000 * 60 * 5), // Valid for 5 minutes
    });
  }

  // 3. FALLBACK: NATIVE S3 PRE-SIGNED URL
  return await getS3SignedUrl(s3Client, command, { expiresIn: 300 });
};
