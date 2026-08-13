import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const HEX_REGEX = /^[0-9a-f]+$/i;

const getKey = () => {
  const secret = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  return crypto.createHash("sha256").update(String(secret)).digest("base64").substring(0, 32);
};

export const encryptToken = (text) => {
  if (!text) return text;

  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    
    const authTag = cipher.getAuthTag().toString("hex");

    // We combine the IV, the encrypted text, and the Auth Tag into a single string 
    // formatted as: iv:encryptedData:authTag so it fits in a single MongoDB String field
    return `${iv.toString("hex")}:${encrypted}:${authTag}`;
  } catch (err) {
    console.error("Encryption failed:", err);
    return null;
  }
};

export const decryptToken = (text) => {
  if (!text || typeof text !== "string") return null;

  try {
    const parts = text.split(":");
    if (parts.length !== 3) return null;

    const [ivHex, encryptedText, authTagHex] = parts;

    // Validate all parts are non-empty hex strings before deserializing into Buffers
    // prevents CWE-502/1321: untrusted data being passed directly to Buffer.from
    if (
      !HEX_REGEX.test(ivHex) ||
      !HEX_REGEX.test(encryptedText) ||
      !HEX_REGEX.test(authTagHex) ||
      ivHex.length !== IV_LENGTH * 2 ||
      authTagHex.length !== 32 // 16-byte GCM auth tag = 32 hex chars
    ) return null;

    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");

    // Always return a plain primitive string — never an object
    return String(decrypted);
  } catch (err) {
    console.error("Decryption failed (Token may be tampered with or key changed):", err);
    return null;
  }
};
