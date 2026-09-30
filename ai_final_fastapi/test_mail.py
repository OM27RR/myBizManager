import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from dotenv import load_dotenv

load_dotenv()

host = os.getenv("SMTP_HOST", "smtp.gmail.com")
port = int(os.getenv("SMTP_PORT", 587))
user = os.getenv("SMTP_USER")
pwd = os.getenv("SMTP_PASS")
target_email = "govil.nishita@gmail.com"  # The supplier's email

print(f"Testing SMTP with:")
print(f"Host: {host}:{port}")
print(f"User: {user}")
print(f"Pass: {'*' * len(pwd) if pwd else 'MISSING'}")

if not user or not pwd:
    print("\n[ERROR] SMTP_USER or SMTP_PASS is missing in .env!")
    exit(1)

try:
    msg = MIMEMultipart()
    msg["From"] = user
    msg["To"] = target_email
    msg["Subject"] = "[TEST] Urgent Purchase Order Diagnostic"
    msg.attach(MIMEText("This is a direct test email from your AI inventory agent.", "plain"))

    print(f"\n1. Connecting to {host}:{port}...")
    server = smtplib.SMTP(host, port, timeout=15)
    server.set_debuglevel(1)  # Prints complete SMTP conversation
    
    print("2. Starting TLS encryption...")
    server.starttls()
    
    print("3. Logging in...")
    server.login(user, pwd)
    
    print(f"4. Sending test email to {target_email}...")
    server.sendmail(user, [target_email], msg.as_string())
    server.quit()
    
    print("\n[SUCCESS] Email successfully delivered to your recipient!")
except Exception as e:
    print(f"\n[FAILED] SMTP Error: {e}")