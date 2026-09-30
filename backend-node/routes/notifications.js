const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const axios = require('axios');
const nodemailer = require('nodemailer');

const { getEmailNotifications } = require('../services/notification.service');
const { catchAsync, AppError } = require('../core/errors');
const { protect } = require('../middleware/auth.middleware');
const { decryptToken } = require('../core/crypto');

// All notification routes require authentication
router.use(protect);

// 1. GET /api/notifications
router.get(
  '/',
  catchAsync(async (req, res) => {
    const notifications = await getEmailNotifications(req.ownerId);
    res.status(200).json({ status: 'success', notifications });
  })
);

// Helper: Detects whether owner's custom reply indicates declining, cancelling, or rejecting the order
function isOwnerDeclineOrReject(prompt, structuredBody) {
  const text = `${prompt || ''} ${structuredBody || ''}`.toLowerCase();
  const patterns = [
    /\breject(?:ed|ing|ion)?\b/,
    /\bdecline(?:d|ing)?\b/,
    /\bcancel(?:led|ing|lation)?\b/,
    /\bno\s+need\b/,
    /\bnot\s+need(?:ed)?\b/,
    /\b(?:don'?t|do\s+not)\s+(?:place|order|proceed|buy|send)\b/,
    /\bwill\s+not\s+(?:proceed|order|place)\b/,
    /\bwon'?t\s+(?:proceed|order|place)\b/,
    /\bnot\s+proceeding\b/,
    /\bstop\s+(?:order|order(?:ing)?)\b/,
    /\bfind\s+(?:another|other|next)\b/,
    /\b(?:next|different|other)\s+supplier\b/,
    /\bno\s+longer\s+(?:need|require)\b/,
  ];
  return patterns.some((p) => p.test(text));
}

// 1b. POST /api/notifications/:id/structure-reply — Uses LLM to structure rough owner notes into professional procurement email
router.post(
  '/:id/structure-reply',
  catchAsync(async (req, res) => {
    const { id } = req.params;
    const { userPrompt } = req.body;

    if (!userPrompt || !userPrompt.trim()) {
      throw new AppError('Reply instructions are required', 400);
    }

    const db = mongoose.connection.db;
    const query = {
      owner_id: req.ownerId,
      $or: [
        { id: id },
        { notification_id: id },
        ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: new mongoose.Types.ObjectId(id) }] : []),
      ],
    };

    const notif = await db.collection('notifications').findOne(query);
    if (!notif) {
      throw new AppError('Notification not found', 404);
    }

    const supplierName = notif.supplier_name || 'Supplier';
    const itemName = notif.item_name || 'the requested item';
    const poTag = notif.po_tag || '';
    const supplierReply = notif.body || '';

    let structuredBody = '';
    const apiKey = (process.env.OPENAI_API_KEY || '').replace(/"/g, '').trim();

    if (apiKey) {
      try {
        const response = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content:
                  'You are an expert procurement assistant drafting an email response from the business owner to a supplier regarding a Purchase Order. Your email must be polite, formal, precise, and professional. Return ONLY the email body text without conversational prelude, greeting explanations, or extra commentary.',
              },
              {
                role: 'user',
                content: `Please draft a professional procurement email to ${supplierName}.

Purchase Order Tag: ${poTag}
Item: ${itemName}
Supplier's previous response:
"""
${supplierReply}
"""

Store Owner's response instructions:
"""
${userPrompt.trim()}
"""

Draft a well-structured, clear business email reflecting the owner's exact terms. If the owner's instructions indicate declining, rejecting, cancelling, or stating there is no need to place the order now, politely inform the supplier that we will not be proceeding with this purchase order. Otherwise, request confirmation and delivery details. Close professionally (e.g. "Best regards,\\nStore Operations Manager").`,
              },
            ],
            temperature: 0.2,
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          }
        );

        structuredBody = response.data?.choices?.[0]?.message?.content?.trim();
      } catch (err) {
        console.error('[OpenAI structuring error]', err.response?.data || err.message);
      }
    }

    if (!structuredBody) {
      // High quality heuristic fallback if LLM times out or key is unavailable
      const isDeclining = isOwnerDeclineOrReject(userPrompt);
      if (isDeclining) {
        structuredBody = `Dear ${supplierName},

Thank you for your response regarding Purchase Order [${poTag}] for ${itemName}.

Please be advised that we will not be proceeding with this purchase order at this time.

Thank you for your time and understanding.

Best regards,
Store Operations Manager`;
      } else {
        structuredBody = `Dear ${supplierName},

Thank you for your response regarding Purchase Order [${poTag}] for ${itemName}.

Regarding your message:
${userPrompt.trim()}

Please proceed with this arrangement and send us a confirmation with estimated delivery details at your earliest convenience.

Best regards,
Store Operations Manager`;
      }
    }

    res.status(200).json({
      status: 'success',
      structuredBody,
    });
  })
);

// 1c. POST /api/notifications/:id/send-custom-reply — Dispatches structured reply to supplier and updates status
router.post(
  '/:id/send-custom-reply',
  catchAsync(async (req, res) => {
    const { id } = req.params;
    const { structuredBody, userPrompt } = req.body;

    if (!structuredBody || !structuredBody.trim()) {
      throw new AppError('Email body is required', 400);
    }

    const db = mongoose.connection.db;
    const query = {
      owner_id: req.ownerId,
      $or: [
        { id: id },
        { notification_id: id },
        ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: new mongoose.Types.ObjectId(id) }] : []),
      ],
    };

    const notif = await db.collection('notifications').findOne(query);
    if (!notif) {
      throw new AppError('Notification not found', 404);
    }

    let supplierEmail = notif.email_from || notif.supplier_email || notif.to;
    if (!supplierEmail && notif.supplier_name) {
      const sup = await db.collection('suppliers').findOne({
        $or: [
          { supplier_name: notif.supplier_name },
          { name: notif.supplier_name },
        ],
      });
      if (sup) supplierEmail = sup.email;
    }

    if (!supplierEmail) {
      throw new AppError('Could not find supplier email address to dispatch reply', 400);
    }

    const subject = notif.po_tag
      ? `Re: [${notif.po_tag}] Order Update & Instructions`
      : `Re: Order Update & Instructions`;

    // Fetch owner details
    const ownerConditions = [{ owner_id: req.ownerId }];
    if (mongoose.Types.ObjectId.isValid(req.ownerId)) {
      ownerConditions.push({ _id: new mongoose.Types.ObjectId(req.ownerId) });
    }
    const owner = await db.collection('owners').findOne({ $or: ownerConditions });

    let sent = false;
    let dispatchMethod = 'none';
    let dispatchError = null;

    // 1. Try Google OAuth if connected
    if (owner?.googleOAuth?.connected && owner.googleOAuth.refreshTokenEncrypted) {
      try {
        const refreshToken = decryptToken(owner.googleOAuth.refreshTokenEncrypted);
        if (refreshToken && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
          const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
          });

          const accessToken = tokenRes.data?.access_token;
          const userEmail = owner.googleOAuth.email || owner.email || process.env.SMTP_USER;

          if (accessToken) {
            const rawMessage = [
              `From: ${userEmail}`,
              `To: ${supplierEmail}`,
              `Subject: ${subject}`,
              `Date: ${new Date().toUTCString()}`,
              'Content-Type: text/plain; charset=utf-8',
              '',
              structuredBody.trim(),
            ].join('\r\n');

            const encodedMessage = Buffer.from(rawMessage)
              .toString('base64')
              .replace(/\+/g, '-')
              .replace(/\//g, '_')
              .replace(/=+$/, '');

            await axios.post(
              'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
              { raw: encodedMessage },
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
                },
                timeout: 15000,
              }
            );
            sent = true;
            dispatchMethod = 'google_oauth';
          }
        }
      } catch (oauthErr) {
        console.warn('[Custom Reply OAuth error]', oauthErr.response?.data || oauthErr.message);
        dispatchError = oauthErr.message;
      }
    }

    // 2. Fallback to SMTP
    if (!sent) {
      try {
        let smtpUser = process.env.SMTP_USER || process.env.SMTP_FROM || '';
        let smtpPass = (process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '').replace(/\s+/g, '');
        let smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
        let smtpPort = Number(process.env.SMTP_PORT) || 587;

        if (owner?.emailConfig?.verified && owner.emailConfig.passwordEncrypted) {
          smtpUser = owner.emailConfig.email || owner.email || smtpUser;
          const dec = decryptToken(owner.emailConfig.passwordEncrypted);
          if (dec) smtpPass = dec.replace(/\s+/g, '');
          smtpHost = owner.emailConfig.host || smtpHost;
          smtpPort = Number(owner.emailConfig.port) || smtpPort;
        }

        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: { user: smtpUser, pass: smtpPass },
          tls: { rejectUnauthorized: false },
          connectionTimeout: 10000,
          socketTimeout: 15000,
        });

        await transporter.sendMail({
          from: smtpUser,
          to: supplierEmail,
          subject: subject,
          text: structuredBody.trim(),
        });
        sent = true;
        dispatchMethod = 'smtp';
      } catch (smtpErr) {
        console.error('[Custom Reply SMTP error]', smtpErr.message);
        dispatchError = smtpErr.message;
      }
    }

    // 3. Log outbound email notification in MongoDB
    const nowTs = Math.floor(Date.now() / 1000);
    const nowIso = new Date().toISOString();

    const outboundDoc = {
      owner_id: req.ownerId,
      kind: 'email',
      direction: 'outbound',
      status: sent ? 'sent' : 'failed',
      subject: subject,
      body: structuredBody.trim(),
      email_from: owner?.email || process.env.SMTP_FROM || 'owner@store.com',
      email_to: supplierEmail,
      supplier_name: notif.supplier_name,
      item_name: notif.item_name,
      item_id: notif.item_id,
      po_id: notif.po_id,
      po_tag: notif.po_tag,
      timestamp: nowTs,
      created_at: nowIso,
      delivery_method: dispatchMethod,
      delivery_error: sent ? null : dispatchError,
    };
    await db.collection('notifications').insertOne(outboundDoc);

    // 4. Mark the original ambiguous notification as replied
    await db.collection('notifications').updateOne(
      { _id: notif._id },
      {
        $set: {
          replied: true,
          owner_reply_prompt: userPrompt,
          owner_structured_reply: structuredBody.trim(),
          replied_at: nowIso,
        },
      }
    );

    // 5. Extract negotiated quantity and update both agentactions and agent_actions collections
    let negotiatedQty = null;
    const promptQtyMatch =
      userPrompt?.match(/(\d+(?:\.\d+)?)\s*(?:units?|pieces?|pcs?|adapters?|chargers?|items?)/i) ||
      userPrompt?.match(/(?:for|order|ship|take|send|accept)\s+(\d+(?:\.\d+)?)/i);
    if (promptQtyMatch) {
      negotiatedQty = parseFloat(promptQtyMatch[1]);
    } else {
      const bodyQtyMatch =
        notif.body?.match(/(\d+(?:\.\d+)?)\s*(?:units?|pieces?|pcs?)/i) ||
        notif.body?.match(/(?:only|have)\s+(\d+(?:\.\d+)?)/i);
      if (bodyQtyMatch) negotiatedQty = parseFloat(bodyQtyMatch[1]);
    }

    if (!negotiatedQty || isNaN(negotiatedQty) || negotiatedQty <= 0) {
      const poDoc = await db.collection('purchase_orders').findOne({
        $or: [{ po_tag: notif.po_tag }, { po_id: notif.po_id }],
      });
      negotiatedQty = poDoc?.items?.[0]?.qty || 10;
    }

    const isOwnerRejection = isOwnerDeclineOrReject(userPrompt, structuredBody);

    if (isOwnerRejection) {
      // 5a. Owner declined/rejected: update status to rejected across action collections
      if (notif.po_tag || notif.po_id) {
        for (const colName of ['agentactions', 'agent_actions']) {
          await db.collection(colName).updateMany(
            {
              owner_id: req.ownerId,
              $or: [
                { po_tag: notif.po_tag },
                { po_id: notif.po_id },
                { 'metadata.po_tag': notif.po_tag },
              ],
            },
            {
              $set: {
                status: 'rejected',
                decision: 'rejected',
                supplier_outcome: 'owner_rejected',
                outcome_text: `Order Disapproved: Declined by owner — Recommending next best supplier`,
                shipment_status: 'cancelled',
                rejection_reason: userPrompt || 'Declined by owner in custom reply',
                updated_at: nowIso,
              },
            }
          );
        }
      }

      // 6a. Trigger escalation via FastAPI to pick and display next supplier on screen
      const fastApiUrl = process.env.FASTAPI_URL || 'http://localhost:8000';
      axios
        .post(`${fastApiUrl}/agent/escalate`, {
          owner_id: req.ownerId,
          supplier_id: notif.supplier_id || '',
          supplier_name: notif.supplier_name || '',
          item_id: notif.item_id || '',
          item_name: notif.item_name || '',
          po_id: notif.po_id || '',
          po_tag: notif.po_tag || '',
          qty: negotiatedQty,
          reason: userPrompt || 'Declined by owner in custom reply',
        })
        .catch((err) => {
          console.warn('[FastAPI escalate notice]', err.message);
        });

      return res.status(200).json({
        status: 'success',
        message: 'Custom reply sent to supplier; order declined and finding next supplier',
        sent,
        dispatchMethod,
        declined: true,
      });
    }

    // 5b. Otherwise, standard negotiation / counter-offer — keep existing flow intact:
    if (notif.po_tag || notif.po_id) {
      for (const colName of ['agentactions', 'agent_actions']) {
        await db.collection(colName).updateMany(
          {
            owner_id: req.ownerId,
            $or: [
              { po_tag: notif.po_tag },
              { po_id: notif.po_id },
              { 'metadata.po_tag': notif.po_tag },
            ],
          },
          {
            $set: {
              status: 'po_sent',
              decision: 'approved',
              supplier_outcome: 'awaiting_reply',
              outcome_text: `Custom reply sent to ${notif.supplier_name} — awaiting reply`,
              quantity: negotiatedQty,
              order_quantity: negotiatedQty,
              updated_at: nowIso,
            },
          }
        );
      }
    }

    // 6b. Asynchronously trigger Python agent reply watcher to resume listening for next response
    const fastApiUrl = process.env.FASTAPI_URL || 'http://localhost:8000';
    axios
      .post(`${fastApiUrl}/agent/watch-reply`, {
        owner_id: req.ownerId,
        supplier_email: supplierEmail,
        supplier_name: notif.supplier_name || 'Supplier',
        supplier_id: notif.supplier_id || '',
        item_id: notif.item_id || '',
        item_name: notif.item_name || '',
        po_id: notif.po_id || '',
        po_tag: notif.po_tag || '',
        qty: negotiatedQty,
      })
      .catch((err) => {
        console.log('[FastAPI watch-reply notice]', err.message);
      });

    res.status(200).json({
      status: 'success',
      message: 'Custom reply successfully dispatched to supplier',
      sent,
      dispatchMethod,
    });
  })
);

// 2. DELETE /api/notifications/trim — Keep only the last N notifications (default 10), delete older ones
router.delete(
  '/trim',
  catchAsync(async (req, res) => {
    const keep = parseInt(req.query.keep || req.body?.keep || '10', 10);
    const db = mongoose.connection.db;

    const newestDocs = await db
      .collection('notifications')
      .find({ owner_id: req.ownerId })
      .sort({ timestamp: -1 })
      .limit(keep)
      .project({ _id: 1 })
      .toArray();

    const idsToKeep = newestDocs.map((d) => d._id);

    let deletedCount = 0;
    if (idsToKeep.length > 0) {
      const result = await db.collection('notifications').deleteMany({
        owner_id: req.ownerId,
        _id: { $nin: idsToKeep },
      });
      deletedCount = result.deletedCount || 0;
    }

    res.status(200).json({
      status: 'success',
      message: `Kept last ${idsToKeep.length} notifications, cleared ${deletedCount} older notifications`,
      kept_count: idsToKeep.length,
      deleted_count: deletedCount,
    });
  })
);

router.post(
  '/trim',
  catchAsync(async (req, res) => {
    const keep = parseInt(req.query.keep || req.body?.keep || '10', 10);
    const db = mongoose.connection.db;

    const newestDocs = await db
      .collection('notifications')
      .find({ owner_id: req.ownerId })
      .sort({ timestamp: -1 })
      .limit(keep)
      .project({ _id: 1 })
      .toArray();

    const idsToKeep = newestDocs.map((d) => d._id);

    let deletedCount = 0;
    if (idsToKeep.length > 0) {
      const result = await db.collection('notifications').deleteMany({
        owner_id: req.ownerId,
        _id: { $nin: idsToKeep },
      });
      deletedCount = result.deletedCount || 0;
    }

    res.status(200).json({
      status: 'success',
      message: `Kept last ${idsToKeep.length} notifications, cleared ${deletedCount} older notifications`,
      kept_count: idsToKeep.length,
      deleted_count: deletedCount,
    });
  })
);

// 3. DELETE /api/notifications/:id — Delete a single notification
router.delete(
  '/:id',
  catchAsync(async (req, res) => {
    const { id } = req.params;
    const db = mongoose.connection.db;

    if (id === 'trim') {
      const keep = parseInt(req.query.keep || req.body?.keep || '10', 10);
      const newestDocs = await db
        .collection('notifications')
        .find({ owner_id: req.ownerId })
        .sort({ timestamp: -1 })
        .limit(keep)
        .project({ _id: 1 })
        .toArray();

      const idsToKeep = newestDocs.map((d) => d._id);
      let deletedCount = 0;
      if (idsToKeep.length > 0) {
        const result = await db.collection('notifications').deleteMany({
          owner_id: req.ownerId,
          _id: { $nin: idsToKeep },
        });
        deletedCount = result.deletedCount || 0;
      }

      return res.status(200).json({
        status: 'success',
        message: `Kept last ${idsToKeep.length} notifications, cleared ${deletedCount} older notifications`,
        kept_count: idsToKeep.length,
        deleted_count: deletedCount,
      });
    }

    const query = {
      owner_id: req.ownerId,
      $or: [
        { id: id },
        { notification_id: id },
        ...(mongoose.Types.ObjectId.isValid(id)
          ? [{ _id: new mongoose.Types.ObjectId(id) }]
          : []),
      ],
    };

    const result = await db.collection('notifications').deleteOne(query);

    if (!result.deletedCount) {
      throw new AppError('Notification not found or already deleted', 404);
    }

    res.status(200).json({ status: 'success', message: 'Notification deleted' });
  })
);

// 3. DELETE /api/notifications — Clear all notifications for this owner
router.delete(
  '/',
  catchAsync(async (req, res) => {
    const db = mongoose.connection.db;
    const result = await db
      .collection('notifications')
      .deleteMany({ owner_id: req.ownerId });

    res.status(200).json({
      status: 'success',
      message: 'All notifications cleared',
      deleted_count: result.deletedCount,
    });
  })
);

module.exports = router;