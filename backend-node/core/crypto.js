const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const DEFAULT_SECRET = 'b63c7b399d8b4e4785db49bca0217ec561d368e718be75069f1437190d7c71e9';

function getKey(secret) {
  const s = secret || process.env.ENCRYPTION_SECRET || DEFAULT_SECRET;
  return crypto.createHash('sha256').update(s).digest();
}

/**
 * Encrypts sensitive text (e.g. OAuth refresh token) using AES-256-GCM.
 * Output format: <iv_hex>:<auth_tag_hex>:<ciphertext_hex>
 */
function encryptToken(text, secret) {
  if (!text) return null;
  const key = getKey(secret);
  const iv = crypto.randomBytes(12); // 12-byte IV standard for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a string produced by encryptToken.
 */
function decryptToken(cipherText, secret) {
  if (!cipherText || !cipherText.includes(':')) return null;
  const parts = cipherText.split(':');
  if (parts.length !== 3) return null;

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getKey(secret);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = {
  encryptToken,
  decryptToken,
};
