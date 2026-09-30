const path = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const required = ['MONGO_URI', 'JWT_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5050,
  mongoUri: process.env.MONGO_URI,
  // IMPORTANT: without an explicit dbName, mongoose silently connects to a
  // database called "test" instead of the real one (Compass/FastAPI both
  // use DB_NAME, e.g. "business_agent"). This was previously unset, meaning
  // Node was reading/writing a different database than FastAPI/Compass.
  dbName: process.env.DB_NAME || 'business_agent',
  useMemoryDb: process.env.USE_MEMORY_DB === 'true',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  cookieExpiresDays: Number(process.env.COOKIE_EXPIRES_DAYS) || 7,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  fastApiUrl: process.env.FASTAPI_URL || 'http://localhost:8000',
  isProd: process.env.NODE_ENV === 'production',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5050/api/auth/google/callback',
  encryptionSecret: process.env.ENCRYPTION_SECRET || 'b63c7b399d8b4e4785db49bca0217ec561d368e718be75069f1437190d7c71e9',
};