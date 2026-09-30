const Owner = require('../models/Owner');
const { comparePassword, generateToken } = require('../core/security');
const { AppError } = require('../core/errors');
const { generateEntityCode } = require('../core/format');
const nodemailer = require('nodemailer');
const { encryptToken } = require('../core/crypto');
const config = require('../core/config');

async function verifySmtpCredentials({ email, password, host = 'smtp.gmail.com', port = 587 }) {
  if (!email || !password) {
    throw new AppError('Email and password are required for verification', 400);
  }

  const cleanPass = String(password).replace(/\s+/g, '').trim();
  const cleanEmail = String(email).trim().toLowerCase();

  const transporter = nodemailer.createTransport({
    host: host || 'smtp.gmail.com',
    port: Number(port) || 587,
    secure: Number(port) === 465,
    auth: {
      user: cleanEmail,
      pass: cleanPass,
    },
    tls: {
      rejectUnauthorized: false,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  try {
    await transporter.verify();
    return { success: true, email: cleanEmail, cleanPass };
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('535') || msg.includes('BadCredentials') || msg.includes('Username and Password not accepted')) {
      throw new AppError(
        'Google rejected these credentials. If your Google account has 2-Step Verification enabled, please use your 16-character Google App Password (create one in Google Account > Security > 2-Step Verification > App Passwords).',
        400
      );
    }
    throw new AppError(`Email verification failed: ${msg}`, 400);
  }
}

async function registerOwner({ owner_name, business_name, email, password, email_password }) {
  if (!owner_name || !business_name || !email || !password) {
    throw new AppError('All fields are required', 400);
  }
  if (password.length < 8) {
    throw new AppError('Password must be at least 8 characters', 400);
  }

  const existing = await Owner.findOne({ email: email.toLowerCase() });
  if (existing) {
    throw new AppError('An account with this email already exists', 409);
  }

  const owner_id = await generateEntityCode(Owner, null, 'OWNER');

  let emailConfig = {
    verified: false,
    email: null,
    passwordEncrypted: null,
    provider: 'gmail',
    verifiedAt: null,
    lastError: null,
  };

  const appPasswordToTest = email_password || (email.toLowerCase().includes('@gmail.com') ? password : null);
  if (appPasswordToTest) {
    try {
      const verified = await verifySmtpCredentials({ email, password: appPasswordToTest });
      emailConfig = {
        verified: true,
        email: verified.email,
        passwordEncrypted: encryptToken(verified.cleanPass, config.encryptionSecret),
        provider: 'gmail',
        verifiedAt: new Date(),
        lastError: null,
      };
    } catch (verr) {
      if (email_password) {
        throw verr;
      }
      emailConfig.lastError = verr.message;
    }
  }

  const owner = await Owner.create({
    owner_id,
    owner_name: owner_name.trim(),
    business_name: business_name.trim(),
    email: email.toLowerCase(),
    password,
    emailConfig,
  });

  const token = generateToken({ id: owner.owner_id });

  return {
    token,
    owner: {
      owner_id: owner.owner_id,
      owner_name: owner.owner_name,
      business_name: owner.business_name,
      email: owner.email,
      emailConfig: {
        verified: !!owner.emailConfig?.verified,
        email: owner.emailConfig?.email || null,
        provider: owner.emailConfig?.provider || 'gmail',
        verifiedAt: owner.emailConfig?.verifiedAt || null,
      },
    },
  };
}

async function loginOwner({ email, password, email_password }) {
  if (!email || !password) {
    throw new AppError('Email and password are required', 400);
  }

  const owner = await Owner.findOne({ email: email.toLowerCase() }).select('+password');
  if (!owner) {
    throw new AppError('Invalid email or password', 401);
  }

  const isMatch = await comparePassword(password, owner.password);
  if (!isMatch) {
    throw new AppError('Invalid email or password', 401);
  }

  if (email_password) {
    try {
      const verified = await verifySmtpCredentials({ email, password: email_password });
      owner.emailConfig = {
        verified: true,
        email: verified.email,
        passwordEncrypted: encryptToken(verified.cleanPass, config.encryptionSecret),
        provider: 'gmail',
        verifiedAt: new Date(),
        lastError: null,
      };
      await owner.save();
    } catch (verr) {
      throw verr;
    }
  }

  const token = generateToken({ id: owner.owner_id });

  return {
    token,
    owner: {
      owner_id: owner.owner_id,
      owner_name: owner.owner_name,
      business_name: owner.business_name,
      email: owner.email,
      emailConfig: {
        verified: !!owner.emailConfig?.verified,
        email: owner.emailConfig?.email || null,
        provider: owner.emailConfig?.provider || 'gmail',
        verifiedAt: owner.emailConfig?.verifiedAt || null,
      },
    },
  };
}

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

function buildOwnerQuery(ownerId) {
  const idStr = String(ownerId || '').trim();
  const conditions = [
    { owner_id: idStr },
    { id: idStr },
  ];
  if (mongoose.Types.ObjectId.isValid(idStr)) {
    conditions.push({ _id: new mongoose.Types.ObjectId(idStr) });
  }
  return { $or: conditions };
}

async function getOwnerById(ownerId) {
  const owner = await Owner.findOne(buildOwnerQuery(ownerId));
  if (!owner) {
    throw new AppError('Owner not found', 404);
  }
  return {
    owner_id: owner.owner_id,
    owner_name: owner.owner_name,
    business_name: owner.business_name,
    email: owner.email,
    emailConfig: {
      verified: !!owner.emailConfig?.verified,
      email: owner.emailConfig?.email || null,
      provider: owner.emailConfig?.provider || 'gmail',
      verifiedAt: owner.emailConfig?.verifiedAt || null,
    },
    googleOAuth: {
      connected: !!owner.googleOAuth?.connected,
      email: owner.googleOAuth?.email || null,
      connectedAt: owner.googleOAuth?.connectedAt || null,
    },
  };
}

async function getGoogleAuthUrl(ownerId) {
  const config = require('../core/config');
  if (!config.googleClientId) {
    throw new AppError(
      'Google OAuth is not yet configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file.',
      400
    );
  }

  // Cryptographically sign the state param using JWT with a random nonce and 10-minute expiry
  // to completely prevent CSRF account-linking attacks
  const stateToken = jwt.sign(
    {
      ownerId: String(ownerId || 'OWNER001'),
      nonce: crypto.randomBytes(16).toString('hex'),
      purpose: 'google_oauth_state',
    },
    config.jwtSecret,
    { expiresIn: '10m' }
  );

  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: config.googleRedirectUri,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'openid',
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: stateToken,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function handleGoogleCallback(code, stateToken) {
  const axios = require('axios');
  const config = require('../core/config');
  const { encryptToken } = require('../core/crypto');

  if (!code) {
    throw new AppError('Authorization code missing from Google callback', 400);
  }
  if (!stateToken) {
    throw new AppError('OAuth state token missing (CSRF protection failed)', 403);
  }
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new AppError('Google OAuth is not configured on this server', 500);
  }

  // 1. Verify CSRF state signature and expiration
  let verifiedOwnerId;
  try {
    const decoded = jwt.verify(stateToken, config.jwtSecret);
    if (decoded.purpose !== 'google_oauth_state' || !decoded.ownerId) {
      throw new Error('Invalid state token purpose');
    }
    verifiedOwnerId = decoded.ownerId;
  } catch (err) {
    throw new AppError('OAuth state verification failed or expired (CSRF protection)', 403);
  }

  // 2. Exchange authorization code for tokens
  const tokenRes = await axios.post(
    'https://oauth2.googleapis.com/token',
    new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: config.googleRedirectUri,
      grant_type: 'authorization_code',
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );

  const { access_token, refresh_token, scope } = tokenRes.data;

  // 3. Fetch authenticated user's Google email address
  let googleEmail = null;
  try {
    const userinfoRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    googleEmail = userinfoRes.data?.email;
  } catch (err) {
    console.warn('Could not fetch userinfo from Google:', err.message);
  }

  // 4. Find owner safely using robust query (handles both ObjectId and custom owner_id string)
  const owner = await Owner.findOne(buildOwnerQuery(verifiedOwnerId));
  if (!owner) {
    throw new AppError(`Owner '${verifiedOwnerId}' not found`, 404);
  }

  // 5. Encrypt refresh token with AES-256-GCM.
  // Note: We deliberately DO NOT store plaintext access tokens in MongoDB.
  // Access tokens are short-lived, sensitive live credentials derived on-demand in-memory by Python.
  const refreshTokenEncrypted = refresh_token
    ? encryptToken(refresh_token, config.encryptionSecret)
    : owner.googleOAuth?.refreshTokenEncrypted;

  owner.googleOAuth = {
    connected: true,
    email: googleEmail || owner.email,
    refreshTokenEncrypted: refreshTokenEncrypted || null,
    scope: scope || '',
    connectedAt: new Date(),
  };

  await owner.save();

  return {
    connected: true,
    email: owner.googleOAuth.email,
    connectedAt: owner.googleOAuth.connectedAt,
  };
}

async function getGoogleAuthStatus(ownerId) {
  const owner = await Owner.findOne(buildOwnerQuery(ownerId));
  if (!owner) {
    throw new AppError('Owner not found', 404);
  }

  const oauth = owner.googleOAuth || {};
  return {
    connected: !!oauth.connected,
    email: oauth.email || null,
    connectedAt: oauth.connectedAt || null,
  };
}

async function disconnectGoogleAuth(ownerId) {
  const owner = await Owner.findOne(buildOwnerQuery(ownerId));
  if (!owner) {
    throw new AppError('Owner not found', 404);
  }

  owner.googleOAuth = {
    connected: false,
    email: null,
    refreshTokenEncrypted: null,
    scope: null,
    connectedAt: null,
  };

  await owner.save();
  return { success: true, message: 'Google account disconnected successfully' };
}

async function updateEmailCredentials(ownerId, { email, password, host = 'smtp.gmail.com', port = 587 }) {
  const verified = await verifySmtpCredentials({ email, password, host, port });

  const owner = await Owner.findOne(buildOwnerQuery(ownerId));
  if (!owner) {
    throw new AppError('Owner not found', 404);
  }

  owner.emailConfig = {
    verified: true,
    email: verified.email,
    passwordEncrypted: encryptToken(verified.cleanPass, config.encryptionSecret),
    provider: 'gmail',
    verifiedAt: new Date(),
    lastError: null,
  };

  await owner.save();

  return {
    verified: true,
    email: verified.email,
    verifiedAt: owner.emailConfig.verifiedAt,
    message: 'Gmail credentials verified and active! All purchase orders will automatically be sent from this email.',
  };
}

async function getEmailCredentialsStatus(ownerId) {
  const owner = await Owner.findOne(buildOwnerQuery(ownerId));
  if (!owner) {
    throw new AppError('Owner not found', 404);
  }

  const ec = owner.emailConfig || {};
  return {
    verified: !!ec.verified,
    email: ec.email || null,
    provider: ec.provider || 'gmail',
    verifiedAt: ec.verifiedAt || null,
  };
}

async function disconnectEmailCredentials(ownerId) {
  const owner = await Owner.findOne(buildOwnerQuery(ownerId));
  if (!owner) {
    throw new AppError('Owner not found', 404);
  }

  owner.emailConfig = {
    verified: false,
    email: null,
    passwordEncrypted: null,
    provider: 'gmail',
    verifiedAt: null,
    lastError: null,
  };

  await owner.save();

  return {
    verified: false,
    message: 'Email credentials disconnected. System fallback mailbox will be used.',
  };
}

module.exports = {
  registerOwner,
  loginOwner,
  getOwnerById,
  verifySmtpCredentials,
  updateEmailCredentials,
  getEmailCredentialsStatus,
  disconnectEmailCredentials,
  getGoogleAuthUrl,
  handleGoogleCallback,
  getGoogleAuthStatus,
  disconnectGoogleAuth,
};

