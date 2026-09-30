"""
mcp_service/suppliers/tools.py
==============================
Autonomous Supplier Tools:
- Look up suppliers matching items across schemas (case-insensitive)
- Price history and percentage change analysis
- Robust SMTP email dispatch with explicit TLS/SSL auto-negotiation and detailed debugging
- IMAP inbox listener with timestamp and PO tag matching
- Autonomous LLM email sentiment parser
- Real-time MongoDB stock increments on confirmation with proper last_updated timestamps
- Purchase order dispatch including unit price, line totals, and grand total calculations
"""

from __future__ import annotations

from datetime import datetime, timezone
import email
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid
import imaplib
import os
from pathlib import Path
import re
import html
import smtplib
import time
from typing import Any
import uuid
from bson import ObjectId

from dotenv import find_dotenv, load_dotenv

from ..common import (
    COL_INVENTORY,
    COL_PURCHASE_ORDERS,
    COL_SUPPLIERS,
    get_db,
    log_agent_action,
    tool_error,
)

from .gmail_auth import (
    get_owner_gmail_credentials,
    get_owner_email_credentials,
    send_gmail_api_email,
    check_gmail_api_for_reply,
)

# Search current directory, parent directories, and workspace root for .env
load_dotenv(find_dotenv(usecwd=True))
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")
load_dotenv(Path(__file__).resolve().parent.parent.parent.parent / ".env")


def send_smtp_email(
    to_email: str,
    subject: str,
    body_text: str,
    custom_user: str | None = None,
    custom_pass: str | None = None,
) -> dict[str, Any]:
    """Sends an email via SMTP with flexible env variable support, space-stripping, and auto SSL/STARTTLS."""
    smtp_host = (
        os.getenv("SMTP_HOST")
        or os.getenv("SMTP_SERVER")
        or "smtp.gmail.com"
    ).strip()

    smtp_port_raw = os.getenv("SMTP_PORT", "587").strip()
    smtp_port = int(smtp_port_raw) if smtp_port_raw.isdigit() else 587

    smtp_user = (
        custom_user
        or os.getenv("SMTP_USER")
        or os.getenv("EMAIL_USER")
        or os.getenv("OWNER_EMAIL")
        or os.getenv("SENDER_EMAIL")
        or ""
    ).strip()

    # Strip any spaces inside Google App Passwords
    smtp_pass = (
        custom_pass
        or os.getenv("SMTP_PASS")
        or os.getenv("SMTP_PASSWORD")
        or os.getenv("EMAIL_PASS")
        or os.getenv("EMAIL_PASSWORD")
        or ""
    ).replace(" ", "").strip()

    smtp_from = (custom_user or os.getenv("SMTP_FROM") or smtp_user).strip()

    print("\n" + "=" * 60)
    print("[SMTP DISPATCH INITIATED]")
    print(f"   From:      {smtp_from}")
    print(f"   To:        {to_email}")
    print(f"   Host:      {smtp_host}:{smtp_port}")
    print(f"   User:      {smtp_user}")
    print(f"   Pass Set:  {'YES (' + str(len(smtp_pass)) + ' chars)' if smtp_pass else 'NO (MISSING!)'}")
    print("=" * 60)

    if not smtp_user or not smtp_pass:
        err = "SMTP_USER or SMTP_PASS/SMTP_PASSWORD is missing in your .env file."
        print(f"[SMTP ERROR] {err}\n")
        return {"sent": False, "error": err}

    if not to_email or "@" not in str(to_email):
        err = f"Target supplier email is empty or invalid: '{to_email}'"
        print(f"[SMTP ERROR] {err}\n")
        return {"sent": False, "error": err}

    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = smtp_from
        msg["To"] = to_email
        msg["Subject"] = subject
        msg["Date"] = formatdate(localtime=True)
        msg["Message-ID"] = make_msgid()
        msg.attach(MIMEText(body_text, "plain", "utf-8"))

        # Port 465 requires SMTP_SSL directly; Port 587 uses standard SMTP + STARTTLS
        if smtp_port == 465:
            server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=25)
            server.ehlo()
        else:
            server = smtplib.SMTP(smtp_host, smtp_port, timeout=25)
            server.ehlo()
            server.starttls()
            server.ehlo()

        server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_from, [to_email], msg.as_string())
        server.quit()

        print(f"[SMTP SUCCESS] Email successfully delivered to {to_email}!\n")
        return {"sent": True, "to": to_email}

    except smtplib.SMTPAuthenticationError as auth_err:
        err_msg = (
            f"SMTP Authentication Error: {auth_err}. "
            "If using Gmail, generate a 16-character 'Google App Password' (Security -> 2-Step Verification -> App passwords) and place it in SMTP_PASS."
        )
        print(f"[SMTP AUTH ERROR] {err_msg}\n")
        return {"sent": False, "error": err_msg}

    except Exception as exc:
        print(f"[SMTP ERROR] Failed to send email to {to_email}: {exc}\n")
        return {"sent": False, "error": str(exc)}


def check_inbox_for_reply(
    supplier_email: str,
    po_tag: str,
    sent_after_timestamp: float,
    custom_user: str | None = None,
    custom_pass: str | None = None,
) -> str | None:
    """
    Connects to IMAP inbox and checks for incoming replies matching the po_tag
    that arrived after sent_after_timestamp.
    Supports custom_user and custom_pass for per-user authenticated IMAP checking.
    """
    imap_host = (os.getenv("IMAP_HOST") or os.getenv("IMAP_SERVER") or "imap.gmail.com").strip()
    imap_user = (custom_user or os.getenv("IMAP_USER") or os.getenv("SMTP_USER") or os.getenv("EMAIL_USER") or "").strip()
    imap_pass = (custom_pass or os.getenv("IMAP_PASS") or os.getenv("SMTP_PASS") or os.getenv("SMTP_PASSWORD") or "").replace(" ", "").strip()

    if not imap_user or not imap_pass:
        return None

    try:
        mail = imaplib.IMAP4_SSL(imap_host, port=int(os.getenv("IMAP_PORT", 993)), timeout=25)
        mail.login(imap_user, imap_pass)
        mail.select("INBOX")

        status, messages = mail.search(None, "ALL")
        if status != "OK" or not messages[0]:
            mail.logout()
            return None

        email_ids = messages[0].split()
        for eid in reversed(email_ids[-15:]):
            res, msg_data = mail.fetch(eid, "(RFC822)")
            for response_part in msg_data:
                if isinstance(response_part, tuple):
                    msg = email.message_from_bytes(response_part[1])
                    subject = str(msg.get("Subject", ""))

                    date_tuple = email.utils.parsedate_tz(msg.get("Date"))
                    msg_time = email.utils.mktime_tz(date_tuple) if date_tuple else time.time()

                    # Ignore emails received prior to order dispatch
                    if msg_time < (sent_after_timestamp - 15):
                        continue

                    # Extract plain text body
                    body = ""
                    if msg.is_multipart():
                        for part in msg.walk():
                            if part.get_content_type() == "text/plain":
                                body = part.get_payload(decode=True).decode(errors="ignore")
                                break
                    else:
                        body = msg.get_payload(decode=True).decode(errors="ignore")

                    # Match PO tracking tag
                    if po_tag.lower() in subject.lower() or po_tag.lower() in body.lower():
                        clean_reply = extract_clean_reply_text(body)
                        if not clean_reply:
                            continue
                        mail.logout()
                        return clean_reply

        mail.logout()
        return None
    except Exception as exc:
        print(f"\n[IMAP ERROR] Failed to check inbox for po_tag='{po_tag}': {exc}")
        return None


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


def _classify_supplier_reply_heuristic(email_body: str, order_qty: float | None = None) -> str:
    clean = extract_clean_reply_text(email_body)
    if not clean:
        return "NO_REPLY"
    lower = clean.lower()

    # 1. Check partial fulfillment against target order quantity FIRST
    if order_qty is not None and order_qty > 0:
        found_nums: list[float] = []
        for m in re.finditer(r"\b(?:have|got|stock|send|ship|available|only|do|supply|offer)\s*(?:only|just)?\s*(\d+(?:\.\d+)?)\b", lower):
            try:
                found_nums.append(float(m.group(1)))
            except ValueError:
                pass
        for m in re.finditer(r"\b(\d+(?:\.\d+)?)\s*(?:units?|pcs?|pieces?|adapters?|chargers?|items?)\b", lower):
            try:
                found_nums.append(float(m.group(1)))
            except ValueError:
                pass

        # If supplier specifies any quantity less than the requested order quantity, it's an unagreed counter-offer!
        for num in found_nums:
            if num < order_qty:
                return "AMBIGUOUS"

    # 2. Check general ambiguous indicators, counter-offers, or questions
    ambiguous_indicators = [
        "only have", "only got", "only stock", "partial", "how many",
        "would you like", "do you want", "can offer", "can supply only",
        "can provide only", "what about", "is that ok", "is this ok",
        "at the moment we have", "we currently have only", "limited to",
        "price has changed", "new rate", "rate is", "minimum order",
        "can ship partially", "split shipment", "can we send",
        "we only have", "i only have", "we got only", "can do only",
        "om shanti om"
    ]
    if any(p in lower for p in ambiguous_indicators) or ("?" in clean and not ("confirm" in lower and len(clean.split()) < 4)):
        return "AMBIGUOUS"

    # 3. Check out of stock phrases
    out_of_stock = [
        "not available", "unavailable", "out of stock", "out-of-stock",
        "no stock", "not in stock", "shortage", "sold out", "depleted",
        "currently out", "stock unavailable", "zero stock", "insufficient stock",
        "lack of stock", "no units"
    ]
    if any(p in lower for p in out_of_stock):
        return "OUT_OF_STOCK"

    # 4. Check confirmation phrases & regex (including delivery promises) FIRST before solitary apologies
    confirmation = [
        "will be delivered", "order will be delivered", "will deliver",
        "will be shipped", "order will be shipped", "will ship",
        "will be sent", "will send", "will fulfill",
        "confirm", "confirmed", "order confirmed", "acceptance", "accept", "accepted",
        "placed", "order placed", "dispatch", "dispatched", "processed", "processing",
        "ready to ship", "shipped", "yes", "sure", "ok", "okay", "approved", "order approved",
        "available", "is available", "stock available", "have stock", "in stock",
        "can fulfill", "can supply", "we have", "i have"
    ]
    is_confirmed = any(p in lower for p in confirmation) or re.search(r"\b(ok|okay|yes|sure|conf+i*r*m[a-z]*|cnfm)\b", lower)

    # 5. Check rejection phrases
    rejection = [
        "not confirm", "cannot confirm", "can't confirm", "won't confirm",
        "will not confirm", "unconfirmed", "never confirm",
        "not accept", "cannot accept", "can't accept", "won't accept",
        "will not accept", "unacceptable",
        "not approve", "cannot approve", "can't approve", "disapprove", "disapproved",
        "cannot fulfill", "can't fulfill", "won't fulfill", "will not fulfill", "unable to fulfill",
        "cannot supply", "can't supply", "won't supply", "unable to supply",
        "cannot deliver", "can't deliver", "won't deliver", "unable to deliver",
        "cannot process", "can't process",
        "reject", "rejected", "rejection", "decline", "declined",
        "cancel", "cancelled", "cancellation",
        "regret", "not possible", "impossible",
        "order disapproved", "order rejected", "order declined", "order cancelled",
        "do not proceed", "don't proceed",
    ]
    if any(p in lower for p in rejection):
        return "REJECTED"

    # If supplier said "sorry", but did NOT provide a confirmation or delivery promise, it's rejection
    if not is_confirmed and "sorry" in lower:
        return "REJECTED"

    if not ("no problem" in lower or "no worries" in lower) and re.search(r"\b(no|nope|nah)\b", lower):
        return "REJECTED"

    if is_confirmed:
        return "ACCEPTED"

    # Fallback to AMBIGUOUS so unclear text (like non-standard language or queries) triggers custom reply
    return "AMBIGUOUS"


async def classify_supplier_reply(
    email_body: str,
    order_qty: float | None = None,
    item_name: str | None = None,
) -> str:
    """
    Uses OpenAI (or fallback heuristics) to evaluate a supplier's email reply
    to a Purchase Order. Returns one of five states:
      - 'ACCEPTED': Supplier confirms they can fulfill the entire order or confirms availability.
      - 'OUT_OF_STOCK': Supplier indicates item is completely unavailable right now.
      - 'REJECTED': Supplier declines or cancels the order.
      - 'AMBIGUOUS': Supplier offers partial quantity (less than requested), asks a question, makes a counter-offer, or reply is unclear.
      - 'NO_REPLY': If body only contains outbound PO template.
    """
    clean_text = extract_clean_reply_text(email_body)
    if not clean_text:
        return "NO_REPLY"

    from openai import AsyncOpenAI

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return _classify_supplier_reply_heuristic(clean_text, order_qty=order_qty)

    order_context_str = ""
    if order_qty is not None and order_qty > 0:
        item_str = f" of {item_name}" if item_name else ""
        order_context_str = f"\nPurchase Order Context:\n- Requested Quantity: {order_qty} units{item_str}\n"

    try:
        client = AsyncOpenAI(api_key=api_key)
        prompt = f"""
Analyze the following supplier email response regarding a Purchase Order.
Classify the supplier's intent into EXACTLY ONE of the following 4 categories:
{order_context_str}
Categories:
- 'ACCEPTED': The supplier agrees to fulfill, deliver, accept, or ship the requested order (e.g. "your order will be delivered", "order will be delivered", "will be delivered", "will deliver", "will ship", "we will deliver", "confirm", "confirmed", "conffirm", "cnfm", "yes", "sure", "available", "we have {order_qty or 'all'} units", "i have {order_qty or 'all'} units", "order confirmed"). Even if there is an apology for past confusion (such as "Sorry sorry for that, your order will be delivered"), if they state the order will be delivered, shipped, or fulfilled, it MUST be classified as ACCEPTED. Common confirmation words and slight typos (such as "conffirm", "confrm", "cnfm") must be classified as ACCEPTED as long as they are agreeing without reducing the order quantity.
- 'OUT_OF_STOCK': The supplier states the item is out of stock / completely unavailable right now.
- 'REJECTED': The supplier declines, cancels, or refuses the order (e.g. "sorry cannot fulfill", "we decline", "not possible", "order rejected").
- 'AMBIGUOUS':
   * The supplier mentions or offers a quantity strictly LESS than the requested {order_qty or 'all'} units (e.g. "we have 10 units", "only 10 units", "can send 8"). Any counter-offer or partial quantity is AMBIGUOUS.
   * The supplier asks an unresolved question, makes an unagreed counter-offer, or gives nonsense/arbitrary text (e.g. "om shanti om").

CRITICAL RULES:
1. Phrases indicating the order will be delivered, shipped, or fulfilled (e.g. "your order will be delivered", "will deliver", "will be sent", "confirm", "conffirm", "confirmed", "accepted", "approved", "available", "yes", "sure") mean ACCEPTED as long as they do not state a reduced quantity.
2. If the supplier specifies a quantity strictly LESS than {order_qty or 'all'} units, reply ONLY with AMBIGUOUS.

Reply with ONLY ONE word: ACCEPTED, OUT_OF_STOCK, REJECTED, or AMBIGUOUS.

Supplier Email Response:
\"\"\"{clean_text}\"\"\"
"""
        res = await client.chat.completions.create(
            model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            timeout=4.5,
        )
        verdict = res.choices[0].message.content.strip().upper()
        if "OUT_OF_STOCK" in verdict or "OUT OF STOCK" in verdict or "NOT AVAILABLE" in verdict:
            return "OUT_OF_STOCK"
        if "AMBIGUOUS" in verdict or "CLARIF" in verdict or "PARTIAL" in verdict or "QUESTION" in verdict:
            return "AMBIGUOUS"
        if "REJECT" in verdict or "DECLIN" in verdict or "CANCEL" in verdict:
            return "REJECTED"
        if "ACCEPT" in verdict:
            return "ACCEPTED"
        return "AMBIGUOUS"
    except Exception:
        return _classify_supplier_reply_heuristic(clean_text, order_qty=order_qty)


async def get_suppliers_for_item(item_id: str, owner_id: str | None = None) -> dict[str, Any]:
    """Finds all suppliers stocking the given item across schemas case-insensitively, strictly scoped to owner_id."""
    db = await get_db()
    inv_query: Dict[str, Any] = {"$or": [{"item_id": item_id}, {"item_name": item_id}]}
    if owner_id:
        inv_query = {"$and": [{"owner_id": owner_id}, inv_query]}

    inv_item = await db[COL_INVENTORY].find_one(inv_query, {"_id": 0})
    item_name = (inv_item or {}).get("item_name") or (inv_item or {}).get("name") or item_id
    escaped_name = re.escape(item_name.strip())
    escaped_id = re.escape(item_id.strip())

    # Case-insensitive query using regex across all fields
    item_matching = [
        {"items_sold": {"$regex": f"^{escaped_name}$", "$options": "i"}},
        {"items_sold": {"$regex": f"^{escaped_id}$", "$options": "i"}},
        {"catalog.item_name": {"$regex": f"^{escaped_name}$", "$options": "i"}},
        {"catalog.item_id": {"$regex": f"^{escaped_id}$", "$options": "i"}},
        {"item_catalog.item_name": {"$regex": f"^{escaped_name}$", "$options": "i"}},
        {"item_catalog.item_id": {"$regex": f"^{escaped_id}$", "$options": "i"}},
    ]

    query: Dict[str, Any]
    if owner_id:
        query = {"$and": [{"owner_id": owner_id}, {"$or": item_matching}]}
    else:
        query = {"$or": item_matching}

    cursor = db[COL_SUPPLIERS].find(query)
    suppliers = await cursor.to_list(length=None)

    target_name_lower = item_name.strip().lower()
    target_id_lower = item_id.strip().lower()

    # Fallback search if query missed due to internal whitespace or structuring
    if not suppliers:
        all_query = {"owner_id": owner_id} if owner_id else {}
        all_suppliers = await db[COL_SUPPLIERS].find(all_query).to_list(length=None)
        for s in all_suppliers:
            cat = s.get("catalog") or s.get("item_catalog") or []
            sold = [str(x).strip().lower() for x in (s.get("items_sold") or [])]
            if any(
                str(e.get("item_id", "")).strip().lower() == target_id_lower
                or str(e.get("item_name", "")).strip().lower() == target_name_lower
                for e in cat
            ) or (target_id_lower in sold or target_name_lower in sold):
                suppliers.append(s)

    if not suppliers:
        return {
            "suppliers": [],
            "count": 0,
            "has_suppliers": False,
            "message": f"No suppliers found stocking item_id='{item_id}'",
        }

    results = []
    for s in suppliers:
        s_name = (s.get("supplier_name") or s.get("name") or "Unknown").strip()
        mongo_id = str(s.get("_id"))
        sid = str(s.get("supplier_id")) if s.get("supplier_id") else mongo_id

        catalog = s.get("catalog") or s.get("item_catalog") or []

        # Case-insensitive price lookup matching name or id
        price = next(
            (
                e.get("price") or e.get("current_price") or e.get("unit_price")
                for e in catalog
                if str(e.get("item_id", "")).strip().lower() == target_id_lower
                or str(e.get("item_name", "")).strip().lower() == target_name_lower
            ),
            500.0,
        )

        try:
            price = float(price)
        except (ValueError, TypeError):
            price = 500.0

        results.append({
            "supplier_id": sid,
            "name": s_name,
            "email": s.get("email"),
            "phone": s.get("phone"),
            "current_price": price,
            "unit_price": price,
            "lead_time_days": s.get("lead_time_days", 2),
            "reliability_score": s.get("reliability_score", 0.95),
            "moq": s.get("moq", 10),
        })

    return {"item_id": item_id, "count": len(results), "suppliers": results}


async def get_price_history(supplier_id: str, item_id: str, limit: int = 12) -> dict[str, Any]:
    """Fetches price history for a supplier/item pair and calculates percentage change."""
    db = await get_db()

    query = {"$or": [{"supplier_id": supplier_id}, {"supplier_name": supplier_id}, {"name": supplier_id}]}
    if ObjectId.is_valid(supplier_id):
        query["$or"].append({"_id": ObjectId(supplier_id)})

    supplier = await db[COL_SUPPLIERS].find_one(query, {"_id": 0})
    if not supplier:
        return tool_error(f"No supplier found with supplier_id='{supplier_id}'")

    inv_item = await db[COL_INVENTORY].find_one(
        {"$or": [{"item_id": item_id}, {"item_name": item_id}]},
        {"_id": 0},
    )
    item_name = (inv_item or {}).get("item_name") or (inv_item or {}).get("name") or item_id

    target_name_lower = item_name.strip().lower()
    target_id_lower = item_id.strip().lower()

    history = [
        h for h in supplier.get("price_history", [])
        if str(h.get("item_id", "")).strip().lower() == target_id_lower
        or str(h.get("item_name", "")).strip().lower() == target_name_lower
    ]

    history.sort(key=lambda h: str(h.get("date", "")), reverse=True)
    history = history[:limit]

    percent_change = None
    if len(history) >= 2:
        latest = history[0].get("price", 0)
        previous = history[1].get("price", 0)
        if previous:
            percent_change = round(((latest - previous) / previous) * 100, 2)

    return {
        "supplier_id": supplier_id,
        "item_id": item_id,
        "history": history,
        "percent_change_vs_previous": percent_change,
    }


async def send_purchase_order(
    supplier_id: str,
    items: list[dict[str, Any]],
    qty: float | None = None,
    supplier_name: str | None = None,
    owner_id: str | None = None,
) -> dict[str, Any]:
    """Creates a PO document and sends the order email to ANY supplier dynamically with unit & total price."""
    db = await get_db()

    target_name = (supplier_name or "").strip()
    supplier = None

    # Step 1: Match by exact or partial supplier_name / name
    if target_name and target_name.lower() not in ("none", "null", "undefined"):
        escaped_name = re.escape(target_name)
        supplier = await db[COL_SUPPLIERS].find_one({
            "$or": [
                {"supplier_name": {"$regex": f"^{escaped_name}$", "$options": "i"}},
                {"name": {"$regex": f"^{escaped_name}$", "$options": "i"}},
                {"supplier_name": {"$regex": escaped_name, "$options": "i"}},
                {"name": {"$regex": escaped_name, "$options": "i"}},
            ]
        })

    # Step 2: Match by unique MongoDB ObjectId if valid
    if not supplier and ObjectId.is_valid(supplier_id):
        supplier = await db[COL_SUPPLIERS].find_one({"_id": ObjectId(supplier_id)})

    # Step 3: Match by supplier_id field
    if not supplier and supplier_id:
        supplier = await db[COL_SUPPLIERS].find_one({
            "$or": [
                {"supplier_id": str(supplier_id)},
                {"supplier_name": str(supplier_id)},
                {"name": str(supplier_id)},
            ]
        })

    if not supplier:
        print(f"[PO ERROR] Could not find supplier matching identifier='{supplier_id}' or name='{target_name}' in MongoDB!")
        return tool_error(f"No supplier found with supplier_id='{supplier_id}'")

    actual_supplier_id = supplier.get("supplier_id") or str(supplier.get("_id"))
    supplier_email = supplier.get("email")
    supplier_display_name = (supplier.get("supplier_name") or supplier.get("name") or actual_supplier_id).strip()

    print(f"\n=======================================================")
    print(f"[PO TARGET RESOLVED] Target Name:   '{supplier_display_name}'")
    print(f"[PO TARGET RESOLVED] Target ID:     '{actual_supplier_id}'")
    print(f"[PO TARGET RESOLVED] Target Email:  '{supplier_email}'")
    print(f"[PO TARGET RESOLVED] Owner ID:      '{owner_id or 'DEFAULT'}'")
    print(f"=======================================================\n")

    po_id = str(uuid.uuid4())[:8]
    po_tag = f"PO-{po_id}"

    # Extract supplier catalog for price lookups
    catalog = supplier.get("catalog") or supplier.get("item_catalog") or []

    order_lines = []
    grand_total = 0.0

    for i in items:
        raw_item_id = str(i.get("item_id", "")).strip()
        item_qty = float(i.get("qty", 0.0))

        inv_item = await db[COL_INVENTORY].find_one(
            {"$or": [{"item_id": raw_item_id}, {"item_name": raw_item_id}]},
            {"_id": 0},
        )
        item_name = (inv_item or {}).get("item_name") or (inv_item or {}).get("name") or raw_item_id
        target_name_lower = item_name.strip().lower()
        target_id_lower = raw_item_id.lower()

        # Find unit price in catalog
        price = next(
            (
                e.get("price") or e.get("current_price") or e.get("unit_price")
                for e in catalog
                if str(e.get("item_id", "")).strip().lower() == target_id_lower
                or str(e.get("item_name", "")).strip().lower() == target_name_lower
            ),
            None,
        )

        # Fallback to inventory unit price or standard default if not in supplier catalog
        if price is None:
            price = (inv_item or {}).get("unit_price") or (inv_item or {}).get("price") or 500.0

        try:
            unit_price = float(price)
        except (ValueError, TypeError):
            unit_price = 500.0

        line_total = unit_price * item_qty
        grand_total += line_total

        order_lines.append(
            f"- Item: {item_name} ({raw_item_id})\n"
            f"  Quantity: {item_qty} units\n"
            f"  Unit Price: ₹{unit_price:,.2f}\n"
            f"  Total Amount: ₹{line_total:,.2f}"
        )

    order_details = "\n\n".join(order_lines)

    email_body = (
        f"Dear {supplier_display_name},\n\n"
        f"We would like to place an urgent purchase order [{po_tag}] for:\n\n"
        f"{order_details}\n\n"
        f"Order Grand Total: ₹{grand_total:,.2f}\n\n"
        f"Please reply directly to this email with your confirmation or availability details.\n\n"
        f"Best regards,\nStore Operations Manager"
    )

    email_res = {"sent": False, "error": "No email address found for supplier"}
    if supplier_email:
        email_subject = f"[{po_tag}] Urgent Purchase Order Request - Total: ₹{grand_total:,.2f}"

        # 1. Attempt dispatch using logged-in owner's connected Google OAuth account
        oauth_creds = None
        if owner_id:
            try:
                oauth_creds = await get_owner_gmail_credentials(owner_id)
            except Exception as oauth_err:
                print(f"[OAUTH ERROR] Failed checking Google credentials for owner '{owner_id}': {oauth_err}")

        if oauth_creds:
            access_token, user_email = oauth_creds
            print(f"[OAUTH DISPATCH] Sending PO from user's connected Gmail: {user_email}")
            email_res = await send_gmail_api_email(
                access_token=access_token,
                from_email=user_email,
                to_email=supplier_email,
                subject=email_subject,
                body_text=email_body,
            )

        # 2. Seamless fallback to default SMTP in .env if OAuth is not configured, not connected, or failed
        if not oauth_creds or not email_res.get("sent"):
            if oauth_creds and not email_res.get("sent"):
                print(f"[DISPATCH FALLBACK] Gmail API failed ({email_res.get('error')}); falling back to SMTP...")
            email_res = send_smtp_email(
                to_email=supplier_email,
                subject=email_subject,
                body_text=email_body,
            )
    else:
        print(f"[PO WARNING] Supplier '{supplier_display_name}' has no email configured in the database.")

    now_iso = datetime.now(timezone.utc).isoformat()
    now_dt = datetime.now(timezone.utc)

    po_doc = {
        "po_id": po_id,
        "po_tag": po_tag,
        "owner_id": owner_id,
        "supplier_id": actual_supplier_id,
        "supplier_name": supplier_display_name,
        "supplier_email": supplier_email,
        "items": items,
        "grand_total": grand_total,
        "status": "pending_supplier_reply",
        "email_delivery": email_res,
        "created_at": now_iso,
        "created_at_dt": now_dt,
    }
    await db[COL_PURCHASE_ORDERS].insert_one(po_doc)

    return {
        "po_id": po_id,
        "po_tag": po_tag,
        "owner_id": owner_id,
        "supplier_id": actual_supplier_id,
        "supplier_name": supplier_display_name,
        "supplier_email": supplier_email,
        "items": items,
        "grand_total": grand_total,
        "status": "dispatched" if email_res.get("sent") else "failed_dispatch",
        "email_delivery": email_res,
    }



async def confirm_and_update_stock(item_id: str, qty: float, po_id: str) -> None:
    """
    Increments stock count in MongoDB Atlas when order is confirmed via email.
    Fixes last_updated by writing both a proper ISO string and updating timestamp fields.
    """
    db = await get_db()
    now_utc = datetime.now(timezone.utc)
    now_iso = now_utc.isoformat()

    await db[COL_INVENTORY].update_one(
        {"$or": [{"item_id": item_id}, {"item_name": item_id}]},
        {
            "$inc": {"current_stock": float(qty)},
            "$set": {
                "status": "In Stock",
                "last_updated": now_iso,
                "updated_at": now_iso,
            },
            "$currentDate": {
                "last_updated_dt": True,
            },
        },
    )
    await db[COL_PURCHASE_ORDERS].update_one(
        {"po_id": po_id},
        {
            "$set": {
                "status": "accepted_and_fulfilled",
                "confirmed_at": now_iso,
                "confirmed_at_dt": now_utc,
            }
        },
    )