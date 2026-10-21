import json
import threading
import time
import urllib.request
import pytest
from avishkar_ems.cli import build_parser, cmd_audit, cmd_auction, cmd_nowcast, cmd_watchdog
from avishkar_ems.api_service import run_http_server

def test_cli_argument_parser():
    parser = build_parser()
    
    # audit
    args = parser.parse_args(["audit", "--site-id", "test-01"])
    assert args.command == "audit"
    assert args.site_id == "test-01"
    
    # nowcast
    args = parser.parse_args(["nowcast", "--hub", "clinic-jaipur"])
    assert args.command == "nowcast"
    assert args.hub == "clinic-jaipur"
    
    # auction
    args = parser.parse_args(["auction"])
    assert args.command == "auction"
    
    # watchdog
    args = parser.parse_args(["watchdog"])
    assert args.command == "watchdog"
    
    # serve
    args = parser.parse_args(["serve", "--port", "8888"])
    assert args.command == "serve"
    assert args.port == 8888

def test_cli_subcommands_execution():
    parser = build_parser()
    cmd_audit(parser.parse_args(["audit"]))
    cmd_nowcast(parser.parse_args(["nowcast", "--hub", "shop-pune"]))
    cmd_auction(parser.parse_args(["auction"]))
    cmd_watchdog(parser.parse_args(["watchdog"]))

def test_http_rest_api_server():
    port = 8765
    server_thread = threading.Thread(target=run_http_server, args=(port, 5), daemon=True)
    server_thread.start()
    time.sleep(0.3)
    
    # 1. GET /healthz
    req = urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz")
    assert req.status == 200
    data = json.loads(req.read().decode("utf-8"))
    assert data["status"] == "HEALTHY_ONLINE"
    assert data["cea_cybersecurity_status"] == "COMPLIANT"
    
    # 2. GET / (Root info)
    req_root = urllib.request.urlopen(f"http://127.0.0.1:{port}/")
    assert req_root.status == 200
    root_data = json.loads(req_root.read().decode("utf-8"))
    assert "UrjaSetu" in root_data["system"]
    assert root_data["beckn_protocol"] == "DEG v2.0"
    
    # 3. POST /beckn/search
    post_payload = json.dumps({"context": {"transaction_id": "TEST-TXN-101"}}).encode("utf-8")
    req_search = urllib.request.Request(
        f"http://127.0.0.1:{port}/beckn/search",
        data=post_payload,
        headers={"Content-Type": "application/json"}
    )
    resp_search = urllib.request.urlopen(req_search)
    assert resp_search.status == 200
    search_data = json.loads(resp_search.read().decode("utf-8"))
    assert search_data["context"]["action"] == "on_search"
    assert "catalog" in search_data["message"]
    
    # 4. POST /beckn/confirm
    confirm_payload = json.dumps({
        "context": {"transaction_id": "TEST-TXN-102"},
        "message": {"order": {"quantity": {"value": 10.0}, "price": {"value": 7.00}}}
    }).encode("utf-8")
    req_confirm = urllib.request.Request(
        f"http://127.0.0.1:{port}/beckn/confirm",
        data=confirm_payload,
        headers={"Content-Type": "application/json"}
    )
    resp_confirm = urllib.request.urlopen(req_confirm)
    assert resp_confirm.status == 200
    confirm_data = json.loads(resp_confirm.read().decode("utf-8"))
    assert confirm_data["context"]["action"] == "on_confirm"
    assert confirm_data["message"]["order"]["status"] == "ACCEPTED_ESCROW_LOCKED"
