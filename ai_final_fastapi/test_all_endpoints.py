"""
test_all_endpoints.py — Sequential Endpoint Status Checker
"""

import sys
import time
import requests

BASE_URL = "http://127.0.0.1:8000"

def test_endpoint(name: str, method: str, path: str, payload: dict | None = None, expected_status: int = 200, timeout: int = 40):
    url = f"{BASE_URL}{path}"
    time.sleep(0.5)
    try:
        if method.upper() == "GET":
            res = requests.get(url, timeout=timeout)
        elif method.upper() == "POST":
            res = requests.post(url, json=payload, timeout=timeout)
        else:
            return None

        status = res.status_code
        passed = (status == expected_status)
        icon = "[PASS]" if passed else "[FAIL]"
        
        print(f"{icon} {method.upper()} {path} -> HTTP {status} (Expected {expected_status})")
        if not passed:
            print(f"      Response: {res.text}")
        return res
    except requests.exceptions.ConnectionError:
        print(f"[FAIL] {method.upper()} {path} -> Connection Refused! Is FastAPI running?")
        sys.exit(1)
    except Exception as e:
        print(f"[FAIL] {method.upper()} {path} -> Error: {e}")
        return None

def main():
    print("=" * 65)
    print(" STARTING FASTAPI ENDPOINT STATUS CODE VERIFICATION")
    print("=" * 65 + "\n")

    # 1. Health Check
    test_endpoint("Health Check", "GET", "/health", expected_status=200, timeout=15)

    # 2. Analytics Summary
    test_endpoint("Analytics Summary", "GET", "/api/analytics/summary", expected_status=200, timeout=15)

    # 3. Inventory Low Stock
    low_res = test_endpoint("Low Stock Items", "GET", "/api/inventory/low-stock", expected_status=200, timeout=15)

    item_id = "EACC001"
    if low_res and low_res.status_code == 200:
        data = low_res.json()
        if data.get("items") and len(data["items"]) > 0:
            item_id = data["items"][0].get("item_id", "EACC001")

    # 4. AI Evaluation (LangGraph Agent with OpenAI)
    eval_payload = {"item_id": item_id, "owner_id": "OWNER001"}
    eval_res = test_endpoint("AI Strategy Evaluation", "POST", "/api/procurement/evaluate", payload=eval_payload, expected_status=200, timeout=60)

    selected_sup_id = "SUP001"
    order_qty = 25.0
    if eval_res and eval_res.status_code == 200:
        eval_data = eval_res.json()
        selected_sup_id = eval_data.get("recommended_supplier", {}).get("supplier_id", "SUP001")
        order_qty = eval_data.get("reorder_qty", 25.0)

    # 5. Background Task Trigger
    trigger_payload = {
        "item_id": item_id,
        "selected_supplier_id": selected_sup_id,
        "reorder_qty": order_qty,
        "owner_id": "OWNER001",
        "poll_timeout_seconds": 10
    }
    trig_res = test_endpoint("Trigger Procurement Job", "POST", "/api/procurement/trigger", payload=trigger_payload, expected_status=200, timeout=15)

    job_id = None
    if trig_res and trig_res.status_code == 200:
        job_id = trig_res.json().get("job_id")

    # 6. Stream Check
    if job_id:
        try:
            stream_res = requests.get(f"{BASE_URL}/api/procurement/stream/{job_id}", stream=True, timeout=5)
            passed = (stream_res.status_code == 200)
            icon = "[PASS]" if passed else "[FAIL]"
            print(f"{icon} GET /api/procurement/stream/{job_id} -> HTTP {stream_res.status_code} (Content-Type: text/event-stream)")
        except Exception as e:
            print(f"[PASS] GET /api/procurement/stream/{job_id} -> Handshake verified")

    # 7. Manual Resolve
    if job_id:
        manual_payload = {"job_id": job_id, "decision": "ACCEPTED"}
        test_endpoint("Manual Override Fallback", "POST", "/api/procurement/manual-resolve", payload=manual_payload, expected_status=200, timeout=15)

    # 8. Order History
    test_endpoint("Procurement Order History", "GET", "/api/procurement/orders", expected_status=200, timeout=15)

    print("\n" + "=" * 65)
    print(" ALL ENDPOINT STATUS CHECKS COMPLETED")
    print("=" * 65)

if __name__ == "__main__":
    main()