"""
gmail_auth.py — Per-user Google OAuth2 & Gmail API client
===========================================================
Handles:
  1. Cross-language AES-256-GCM token decryption (compatible with Node.js crypto.js)
  2. Automatic access token refresh via Google's OAuth2 endpoint
  3. Dispatching purchase order emails directly through the user's Gmail account (users.messages.send)
  4. Querying the user's Gmail inbox for supplier replies matching a PO tag (users.messages.list)
"""

from __future__ import annotations

import base64
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import html
import time
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from dotenv import load_dotenv
import httpx

from bson import ObjectId
from ..common import COL_OWNERS, get_db

load_dotenv(Path(__file__).resolve().parent.parent.parent.parent / ".env")

logger = logging.getLogger("mcp_service.suppliers.gmail_auth")

DEFAULT_SECRET = "b63c7b399d8b4e4785db49bca0217ec561d368e718be75069f1437190d7c71e9"


def decrypt_token(cipher_text: str, secret: str | None = None) -> str | None:
    """
    Decrypts an AES-256-GCM ciphertext formatted as:
    <iv_hex>:<auth_tag_hex>:<ciphertext_hex>
    Derives 32-byte key via SHA-256 of the secret string.
    """
    if not cipher_text or ":" not in cipher_text:
        return None

    parts = cipher_text.split(":")
    if len(parts) != 3:
        return None

    iv_hex, auth_tag_hex, encrypted_hex = parts
    sec = secret or os.getenv("ENCRYPTION_SECRET") or DEFAULT_SECRET
    key = hashlib.sha256(sec.encode("utf-8")).digest()

    try:
        iv = bytes.fromhex(iv_hex)
        auth_tag = bytes.fromhex(auth_tag_hex)
        ciphertext = bytes.fromhex(encrypted_hex)

        aesgcm = AESGCM(key)
        # AESGCM in cryptography expects ciphertext + tag appended together
        decrypted_bytes = aesgcm.decrypt(iv, ciphertext + auth_tag, None)
        return decrypted_bytes.decode("utf-8")
    except Exception as exc:
        logger.warning("Failed to decrypt OAuth refresh token: %s", exc)
        return None


from bson import ObjectId

# In-memory access token cache: owner_id -> (access_token, expiry_timestamp_seconds)
# Access tokens are sensitive live credentials: keeping them strictly in memory
# avoids persisting plaintext tokens in MongoDB and eliminates write race conditions.
_memory_token_cache: dict[str, tuple[str, float]] = {}


async def get_owner_gmail_credentials(owner_id: str | None) -> tuple[str, str] | None:
    """
    Retrieves (access_token, user_email) for the specified owner_id.
    Supports owner_id as an entity code (e.g. 'OWNER001') OR as a MongoDB ObjectId string.
    Automatically refreshes expired access tokens in-memory against Google OAuth.
    Returns None if the owner has not connected Google OAuth.
    """
    if not owner_id:
        return None

    db = await get_db()

    # Robust query: prevents silent lookup failure whether owner_id is an ObjectId or custom string
    clean_id = str(owner_id).strip()
    query_conditions = []
    if ObjectId.is_valid(clean_id):
        query_conditions.append({"_id": ObjectId(clean_id)})
    query_conditions.append({"owner_id": clean_id})
    query_conditions.append({"id": clean_id})
    query_conditions.append({"email": clean_id.lower()})

    owner = await db[COL_OWNERS].find_one({"$or": query_conditions})
    if not owner:
        return None

    oauth = owner.get("googleOAuth") or {}
    if not oauth.get("connected"):
        return None

    user_email = oauth.get("email") or owner.get("email")
    canonical_id = owner.get("owner_id") or str(owner.get("_id"))

    # 1. Check in-memory access token cache (with 2-minute safety window)
    cached = _memory_token_cache.get(canonical_id)
    if cached:
        cached_token, expiry_sec = cached
        if time.time() < (expiry_sec - 120):
            return cached_token, user_email

    # 2. Token expired or missing from memory — derive fresh one from encrypted refresh token
    encrypted_refresh = oauth.get("refreshTokenEncrypted")
    if not encrypted_refresh:
        logger.warning("Owner %s has connected=True but no refresh token.", canonical_id)
        return None

    refresh_token = decrypt_token(encrypted_refresh)
    if not refresh_token:
        logger.warning("Could not decrypt refresh token for owner %s", canonical_id)
        return None

    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        logger.warning("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not configured in .env")
        return None

    # Request new access token from Google
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
            )

        if res.status_code != 200:
            logger.error("Failed to refresh Google token for owner %s: %s", canonical_id, res.text)
            return None

        token_data = res.json()
        new_access_token = token_data.get("access_token")
        expires_in = float(token_data.get("expires_in", 3600))

        # Cache in memory only — never persist plaintext access token to database
        _memory_token_cache[canonical_id] = (new_access_token, time.time() + expires_in)

        logger.info("Successfully refreshed Google OAuth token in-memory for owner %s", canonical_id)
        return new_access_token, user_email

    except Exception as exc:
        logger.error("Exception refreshing Google OAuth token for owner %s: %s", canonical_id, exc)
        return None


async def get_owner_email_credentials(owner_id: str | None) -> tuple[str, str] | None:
    """
    Looks up Owner document in MongoDB using ObjectId or string owner_id.
    Returns (email, decrypted_password) if emailConfig.verified is True,
    enabling zero-config per-user automated SMTP/IMAP dispatch.
    """
    if not owner_id:
        return None

    db = await get_db()
    clean_id = str(owner_id).strip()
    query_conditions = []
    if ObjectId.is_valid(clean_id):
        query_conditions.append({"_id": ObjectId(clean_id)})
    query_conditions.append({"owner_id": clean_id})
    query_conditions.append({"id": clean_id})
    query_conditions.append({"email": clean_id.lower()})

    owner = await db[COL_OWNERS].find_one({"$or": query_conditions})
    if not owner:
        return None

    ec = owner.get("emailConfig") or {}
    if not ec.get("verified") or not ec.get("passwordEncrypted"):
        return None

    try:
        user_email = ec.get("email") or owner.get("email")
        decrypted_password = decrypt_token(ec["passwordEncrypted"])
        if not decrypted_password or not user_email:
            return None
        return user_email, decrypted_password
    except Exception as exc:
        logger.error("Exception decrypting email credentials for owner %s: %s", clean_id, exc)
        return None


async def send_gmail_api_email(
    access_token: str,
    from_email: str,
    to_email: str,
    subject: str,
    body_text: str,
) -> dict[str, Any]:
    """
    Sends an email via the Gmail REST API (users.messages.send) using the user's OAuth access token.
    """
    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = from_email
        msg["To"] = to_email
        msg["Subject"] = subject
        msg["Date"] = formatdate(localtime=True)
        msg["Message-ID"] = make_msgid()
        msg.attach(MIMEText(body_text, "plain", "utf-8"))

        raw_bytes = msg.as_bytes()
        raw_b64 = base64.urlsafe_b64encode(raw_bytes).decode("utf-8")

        async with httpx.AsyncClient(timeout=25.0) as client:
            res = await client.post(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                },
                json={"raw": raw_b64},
            )

        if res.status_code in (200, 201):
            data = res.json()
            msg_id = data.get("id")
            logger.info("Gmail API dispatch succeeded: id=%s from=%s to=%s", msg_id, from_email, to_email)
            print(f"\n[GMAIL API SUCCESS] Email successfully sent from {from_email} to {to_email} (MsgID: {msg_id})!\n")
            return {
                "sent": True,
                "to": to_email,
                "from": from_email,
                "message_id": msg_id,
                "method": "gmail_api",
            }
        else:
            err_text = res.text
            logger.error("Gmail API dispatch failed (%s): %s", res.status_code, err_text)
            return {
                "sent": False,
                "error": f"Gmail API returned {res.status_code}: {err_text}",
                "method": "gmail_api",
            }

    except Exception as exc:
        logger.error("Exception in send_gmail_api_email: %s", exc)
        return {"sent": False, "error": str(exc), "method": "gmail_api"}


def extract_clean_reply_text(email_body: str) -> str:
    """
    Strips quoted original email content so template text like
    'Please reply directly with CONFIRMED or OUT OF STOCK' does not fool
    the intent classifier.
    Handles plain text, HTML emails, and client-specific quote headers.
    """
    if not email_body:
        return ""
    raw = str(email_body)
    if "<" in raw and ">" in raw:
        raw = re.sub(r"<blockquote[^>]*>[\s\S]*?</blockquote>", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"<div[^>]*class=[\"'][^\"']*quote[^\"']*[\"'][^>]*>[\s\S]*?</div>", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"<(br|p|div|tr)[^>]*>", "\n", raw, flags=re.IGNORECASE)
        raw = re.sub(r"<[^>]+>", " ", raw)
        raw = html.unescape(raw)

    stripped = raw.strip()

    # If it is strictly the outbound PO email, return empty
    if ("we would like to place an urgent purchase order" in stripped.lower() and 
        "store operations manager" in stripped.lower()):
        dear_idx = stripped.lower().find("dear ")
        if dear_idx <= 0:
            return ""
        stripped = stripped[:dear_idx].strip()

    lines = []
    for line in stripped.splitlines():
        trimmed = line.strip()
        if not trimmed:
            continue
        if trimmed.startswith(">"):
            continue
        if re.match(r"^on\s+.*wrote:?$", trimmed, re.IGNORECASE):
            break
        if "-----original message-----" in trimmed.lower():
            break
        if re.match(r"^from:\s+.*", trimmed, re.IGNORECASE) and "store operations manager" in stripped.lower():
            break
        if "we would like to place an urgent purchase order" in trimmed.lower():
            break
        if "please reply directly to this email with" in trimmed.lower():
            break
        if "order grand total:" in trimmed.lower():
            break
        lines.append(trimmed)
    return "\n".join(lines).strip()



async def check_gmail_api_for_reply(
    access_token: str,
    supplier_email: str,
    po_tag: str,
    sent_after_timestamp: float,
) -> str | None:
    """
    Queries the user's Gmail inbox via the Gmail REST API for incoming replies
    matching po_tag from the supplier after sent_after_timestamp.
    """
    try:
        # Search query: supplier email and PO tag
        query = f'from:{supplier_email} "{po_tag}"'
        async with httpx.AsyncClient(timeout=15.0) as client:
            list_res = await client.get(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"q": query, "maxResults": 5},
            )

            if list_res.status_code != 200:
                logger.warning("Gmail API message search failed: %s", list_res.text)
                return None

            messages = list_res.json().get("messages", [])
            if not messages:
                # Also try fallback query with just the po_tag
                fallback_res = await client.get(
                    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"q": po_tag, "maxResults": 5},
                )
                if fallback_res.status_code == 200:
                    messages = fallback_res.json().get("messages", [])

            for m in messages:
                msg_id = m.get("id")
                if not msg_id:
                    continue

                msg_res = await client.get(
                    f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"format": "full"},
                )
                if msg_res.status_code != 200:
                    continue

                msg_data = msg_res.json()
                labels = msg_data.get("labelIds", [])
                # If message is strictly in SENT and not in INBOX, it's an outbound message, skip
                if "SENT" in labels and "INBOX" not in labels:
                    continue

                internal_date_ms = float(msg_data.get("internalDate", 0))
                # Ignore emails received prior to order dispatch (with 15s leeway)
                if internal_date_ms < ((sent_after_timestamp - 15) * 1000):
                    continue

                body_text = _extract_gmail_body(msg_data.get("payload", {}))
                headers = {
                    h.get("name", "").lower(): h.get("value", "")
                    for h in msg_data.get("payload", {}).get("headers", [])
                }
                subject = headers.get("subject", "")

                if po_tag.lower() in subject.lower() or po_tag.lower() in body_text.lower():
                    clean_reply = extract_clean_reply_text(body_text)
                    if not clean_reply:
                        # Echo of the outbound PO request, not a supplier response
                        continue
                    logger.info("Found supplier reply via Gmail API for %s: %s", po_tag, clean_reply[:100])
                    return clean_reply

        return None

    except Exception as exc:
        logger.warning("Error checking Gmail API for reply: %s", exc)
        return None


def _extract_gmail_body(payload: dict[str, Any]) -> str:
    """Recursively extracts plain text body from a Gmail API message payload."""
    mime_type = payload.get("mimeType", "")
    body_data = payload.get("body", {}).get("data")

    if mime_type == "text/plain" and body_data:
        try:
            return base64.urlsafe_b64decode(body_data).decode("utf-8", errors="ignore")
        except Exception:
            pass

    parts = payload.get("parts", [])
    for part in parts:
        part_text = _extract_gmail_body(part)
        if part_text:
            return part_text

    if body_data:
        try:
            return base64.urlsafe_b64decode(body_data).decode("utf-8", errors="ignore")
        except Exception:
            pass

    return ""
