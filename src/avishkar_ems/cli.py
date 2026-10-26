#!/usr/bin/env python3
"""UrjaSetu (ऊर्जासेतु) Enterprise CLI.

Unified command-line interface for Indian microgrid optimization, Beckn DEG v2.0
trading, CEA 2026 cybersecurity auditing, and autonomous anti-islanding watchdogs.
"""

from __future__ import annotations

import argparse
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from avishkar_ems.anti_islanding import AntiIslandingWatchdog
from avishkar_ems.cybersecurity_cea import CEACyberSecurityManager
from avishkar_ems.market_auction import MarketOrder, MicrogridAuctionEngine
from avishkar_ems.satellite import INDIAN_SATELLITE_HUBS, fetch_satellite_solar


def cmd_audit(args: argparse.Namespace) -> None:
    """Execute CEA 2026 Cybersecurity & Regulatory audit."""
    print("=" * 65)
    print("🛡️  CEA 2026 CYBERSECURITY & REGULATORY AUDIT")
    print("=" * 65)
    mgr = CEACyberSecurityManager(site_id=args.site_id)
    audit = mgr.perform_statutory_audit(offline_local_mode=True)

    print(f"Site ID:                  {args.site_id}")
    print(f"Compliant:                {'YES' if audit.is_compliant else 'NO'}")
    print(f"Data Residency:           {audit.data_residency_country}")
    print(f"OT/IT Segmentation:       {audit.ot_it_segmentation}")
    print(f"Air-Gap Ready:            {'YES' if audit.offline_airgap_ready else 'NO'}")
    print(f"TLS Encryption:           {'ENABLED' if audit.tls_encryption_enabled else 'DISABLED'}")
    print(f"CERT-In Notice Window:    {audit.incident_notification_window_hours} Hours")
    print(f"SHA-256 Fingerprint:      {audit.system_fingerprint_sha256[:24]}...")
    print(f"Controls Passed:          {len(audit.security_controls_passed)} controls")
    print("=" * 65)


def cmd_nowcast(args: argparse.Namespace) -> None:
    """Fetch ISRO INSAT-3D/3DR solar nowcast for regional hubs."""
    hub_key = args.hub
    if hub_key not in INDIAN_SATELLITE_HUBS:
        print(f"Unknown hub '{hub_key}'. Available: {list(INDIAN_SATELLITE_HUBS.keys())}")
        sys.exit(1)

    hub = INDIAN_SATELLITE_HUBS[hub_key]
    print(f"🛰️  Fetching INSAT-3D/3DR radar for {hub['name']} ({hub['lat']}°N, {hub['lon']}°E)...")
    report = fetch_satellite_solar(hub["lat"], hub["lon"], days=1)

    print("-" * 55)
    print(f"Location:           {hub['name']} ({hub['state']} - {hub['discom']})")
    print(f"Orbital Sensor:     {report.source_description}")
    print(f"Direct Normal DNI:  {report.current_dni_wm2:.1f} W/m²")
    print(f"Cloud Cover:        {report.current_cloud_cover_pct:.1f}%")
    print(f"Ambient Temp:       {report.current_temp_c:.1f} °C")
    print(f"Live Sensor Feed:   {'YES' if report.is_live else 'CACHED'}")
    print("-" * 55)


def cmd_auction(args: argparse.Namespace) -> None:
    """Clear double-sided continuous microgrid auction."""
    print("⚡ CONTINUOUS DOUBLE-SIDED P2P ENERGY AUCTION")
    print("-" * 55)
    engine = MicrogridAuctionEngine()
    engine.submit_order(MarketOrder("ORD-A1", "shop-pune", "ASK", 12.5, 6.20))
    engine.submit_order(MarketOrder("ORD-A2", "clinic-jaipur", "ASK", 8.0, 6.80))
    engine.submit_order(MarketOrder("ORD-B1", "home-mathura", "BID", 10.0, 7.50))
    engine.submit_order(MarketOrder("ORD-B2", "ev-cluster-delhi", "BID", 15.0, 7.20))

    result = engine.clear_market("11:00-11:15")
    print(f"Trading Window:         {result.window}")
    print(f"Uniform Clearing Price: ₹{result.uniform_clearing_price_rs_kwh:.2f}/kWh")
    print(f"Cleared Volume:         {result.cleared_volume_kwh:.2f} kWh")
    print(f"Total Social Welfare:   ₹{result.total_social_welfare_inr:.2f}")
    print(f"Producer Surplus:       ₹{result.producer_surplus_inr:.2f}")
    print(f"Consumer Surplus:       ₹{result.consumer_surplus_inr:.2f}")
    print(f"Matched Trades:         {len(result.matched_trades)}")
    for t in result.matched_trades:
        print(f"  • {t.seller_id} -> {t.buyer_id}: {t.cleared_kwh} kWh @ ₹{t.clearing_price_rs_kwh:.2f}/kWh (₹{t.trade_value_inr:.2f})")
    print("-" * 55)


def cmd_watchdog(args: argparse.Namespace) -> None:
    """Run IEEE 1547 / CEA anti-islanding watchdog check."""
    print("🔌 IEEE 1547 / CEA 2.0s ANTI-ISLANDING WATCHDOG")
    print("-" * 55)
    wd = AntiIslandingWatchdog()
    wd.feed_heartbeat()

    # Normal sample
    d1 = wd.evaluate_grid_safety(230.0, 50.0)
    print(f"Normal Grid (230V, 50.0Hz):   Breaker={d1.shunt_trip_relay_state}, Compliance={d1.statutory_compliance}")

    # Islanding perturbation sample (Frequency drop & under-voltage)
    d2 = wd.evaluate_grid_safety(185.0, 46.8)
    print(f"Fault Grid (185V, 46.8Hz):    Breaker={d2.shunt_trip_relay_state}, Reason={d2.trip_reason}")
    print(f"Trip Latency:                 {d2.trip_latency_ms:.3f} ms (Mandate <= 2000.0 ms)")
    print("-" * 55)


def cmd_serve(args: argparse.Namespace) -> None:
    """Launch the UrjaSetu REST API service."""
    from avishkar_ems.api_service import run_http_server

    print(f"🚀 Starting UrjaSetu Beckn DEG v2.0 REST API on port {args.port}...")
    run_http_server(port=args.port)


def build_parser() -> argparse.ArgumentParser:
    """Construct CLI argument parser."""
    parser = argparse.ArgumentParser(
        prog="urjasetu",
        description="UrjaSetu EMS: Predictive Energy Management & Surplus Dispatch",
    )
    sub = parser.add_subparsers(dest="command", help="Available subcommands")

    # audit
    p_audit = sub.add_parser("audit", help="Run CEA 2026 Cybersecurity & Regulatory audit")
    p_audit.add_argument("--site-id", default="mathura-01", help="Microgrid Site ID")

    # nowcast
    p_nowcast = sub.add_parser("nowcast", help="Fetch ISRO INSAT-3D/3DR solar satellite nowcast")
    p_nowcast.add_argument("--hub", default="shop-pune", choices=list(INDIAN_SATELLITE_HUBS.keys()), help="Hub key")

    # auction
    sub.add_parser("auction", help="Clear continuous double-sided P2P market auction")

    # watchdog
    sub.add_parser("watchdog", help="Test IEEE 1547 / CEA anti-islanding watchdog logic")

    # serve
    p_serve = sub.add_parser("serve", help="Run Beckn DEG v2.0 REST API server")
    p_serve.add_argument("--port", type=int, default=8000, help="HTTP port to bind (default: 8000)")

    return parser


def main() -> None:
    """CLI entrypoint."""
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "audit":
        cmd_audit(args)
    elif args.command == "nowcast":
        cmd_nowcast(args)
    elif args.command == "auction":
        cmd_auction(args)
    elif args.command == "watchdog":
        cmd_watchdog(args)
    elif args.command == "serve":
        cmd_serve(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
