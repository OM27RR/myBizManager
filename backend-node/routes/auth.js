const express = require('express');
const router = express.Router();

const {
  registerOwner,
  loginOwner,
  getOwnerById,
  updateEmailCredentials,
  getEmailCredentialsStatus,
  disconnectEmailCredentials,
  getGoogleAuthUrl,
  handleGoogleCallback,
  getGoogleAuthStatus,
  disconnectGoogleAuth,
} = require('../services/auth.service');
const { catchAsync } = require('../core/errors');
const { protect } = require('../middleware/auth.middleware');
const config = require('../core/config');

function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProd,
    sameSite: config.isProd ? 'none' : 'lax',
    maxAge: config.cookieExpiresDays * 24 * 60 * 60 * 1000,
  };
}

// Matches the Sign Up form: business_name, email, password, optional email_password
router.post(
  '/signup',
  catchAsync(async (req, res) => {
    const { owner_name, business_name, email, password, email_password } = req.body;
    const { token, owner } = await registerOwner({ owner_name, business_name, email, password, email_password });

    res.cookie('token', token, cookieOptions());
    res.status(201).json({ status: 'success', token, owner });
  })
);

// Matches the Log In form: email, password, optional email_password
router.post(
  '/login',
  catchAsync(async (req, res) => {
    const { email, password, email_password } = req.body;
    const { token, owner } = await loginOwner({ email, password, email_password });

    res.cookie('token', token, cookieOptions());
    res.status(200).json({ status: 'success', token, owner });
  })
);

router.post('/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: config.isProd,
    sameSite: config.isProd ? 'none' : 'lax',
  });
  res.status(200).json({ status: 'success', message: 'Logged out' });
});

// Called on app load to check "is anyone logged in" — drives whether
// Home.jsx redirects to /login or /dashboard
router.get(
  '/me',
  protect,
  catchAsync(async (req, res) => {
    const owner = await getOwnerById(req.ownerId);
    res.status(200).json({ status: 'success', owner });
  })
);

// --- Google Cloud OAuth 2.0 (Gmail API) ---

// 1. Get Google authorization URL to initiate consent screen
router.get(
  '/google/url',
  protect,
  catchAsync(async (req, res) => {
    const url = await getGoogleAuthUrl(req.ownerId);
    res.status(200).json({ status: 'success', url });
  })
);

// 2. Google OAuth callback: exchanges code for tokens, saves encrypted refresh token
router.get(
  '/google/callback',
  catchAsync(async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      console.error('[GOOGLE OAUTH ERROR]', error);
      return res.redirect(`${config.clientUrl}/app/dashboard?google_error=${encodeURIComponent(error)}`);
    }

    try {
      await handleGoogleCallback(code, state);
      res.redirect(`${config.clientUrl}/app/dashboard?google_connected=true`);
    } catch (err) {
      console.error('[GOOGLE OAUTH CALLBACK EXCEPTION]', err.message);
      res.redirect(`${config.clientUrl}/app/dashboard?google_error=${encodeURIComponent(err.message)}`);
    }
  })
);

// 3. Status check for currently logged in owner's Google connection
router.get(
  '/google/status',
  protect,
  catchAsync(async (req, res) => {
    const status = await getGoogleAuthStatus(req.ownerId);
    res.status(200).json({ status: 'success', ...status });
  })
);

// 4. Disconnect Google account
router.post(
  '/google/disconnect',
  protect,
  catchAsync(async (req, res) => {
    const result = await disconnectGoogleAuth(req.ownerId);
    res.status(200).json({ status: 'success', ...result });
  })
);

// --- Direct Per-User Gmail Credentials (Zero-Config SMTP / IMAP) ---

// 1. Get current email dispatch status for the logged-in owner
router.get(
  '/email-credentials',
  protect,
  catchAsync(async (req, res) => {
    const status = await getEmailCredentialsStatus(req.ownerId);
    res.status(200).json({ status: 'success', ...status });
  })
);

// 2. Set or update email credentials (verifies against Google SMTP in real time)
router.post(
  '/email-credentials',
  protect,
  catchAsync(async (req, res) => {
    const result = await updateEmailCredentials(req.ownerId, req.body);
    res.status(200).json({ status: 'success', ...result });
  })
);

// 3. Disconnect email credentials (reverts to system fallback)
router.post(
  '/email-credentials/disconnect',
  protect,
  catchAsync(async (req, res) => {
    const result = await disconnectEmailCredentials(req.ownerId);
    res.status(200).json({ status: 'success', ...result });
  })
);

module.exports = router;