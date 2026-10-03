"""India Energy Stack P2P offer message (Beckn DEG v2.0, `catalog/publish`).

The structure follows the public devkit `devkits/p2p-trading-ies-wave2` of beckn/DEG (licence CC BY-NC-SA 4.0,
so only the message format is followed, no files are copied). One catalog offer is emitted per run of
consecutive hourly windows, with a `PRICE_PER_KWH` and an `AVAILABLE_QTY` value for every interval.
`validate_publish` enforces the structural and consistency rules stated in the EnergyTradeOffer v2.0 spec.
"""

from __future__ import annotations

import re
import uuid

import pandas as pd

from avishkar_ems.dispatch import Offer
from avishkar_ems.site import SiteSpec

NETWORK_ID = "indiaenergystack.in/test-ies-p2p-trading-network"
CONTEXTS = ["EnergyTradeOffer/v2.0", "EnergyResource/v2.0", "EnergyCustomer/v2.0", "DEGContract/v2.0",
            "BecknTimeSeries/v1.0"]
_URL = "https://schema.nfh.global/{}/context.jsonld"


def _z(ts: pd.Timestamp) -> str:
    return ts.tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%SZ")


def _runs(offers: list[Offer]) -> list[list[Offer]]:
    runs: list[list[Offer]] = []
    for o in sorted(offers, key=lambda x: x.start):
        if runs and runs[-1][-1].end == o.start and (o.end - o.start) == (runs[-1][-1].end - runs[-1][-1].start):
            runs[-1].append(o)
        else:
            runs.append([o])
    return runs


def catalog_publish(site: SiteSpec, offers: list[Offer], bpp_id: str = "sellerapp.example.com",
                    meter_id: str | None = None, discom_id: str = "SELLER_DISCOM",
                    now: pd.Timestamp | None = None) -> dict:
    """Build the `catalog/publish` message for a site's offers."""
    now = now or pd.Timestamp.now(tz="UTC")
    meter = meter_id or f"METER_{site.site_id}"
    first = min(o.start for o in offers) if offers else now
    txn, cat_id = str(uuid.uuid4()), f"catalog-p2p-{site.site_id}-{first:%Y%m%d}"
    offer_objs = []
    for i, run in enumerate(_runs(offers)):
        dur = run[0].end - run[0].start
        offer_objs.append({
            "id": f"offer-{site.site_id}-{run[0].start:%Y%m%dT%H%M}-{i}",
            "descriptor": {"name": f"Solar surplus {run[0].start:%H:%M}-{run[-1].end:%H:%M} IST",
                           "shortDesc": f"{sum(o.quantity_kwh for o in run):.1f} kWh from {site.dc_kwp:g} kWp + battery"},
            "resourceIds": [f"energy-resource-{site.site_id}"],
            "availableTo": [],
            "offerAttributes": {
                "@context": _URL.format("EnergyTradeOffer/v2.0"), "@type": "EnergyTradeOffer",
                "validityWindow": {"@type": "beckn:TimePeriod", "schema:startTime": _z(now),
                                   "schema:endTime": _z(run[0].start)},
                "contractAttributes": {
                    "@context": _URL.format("DEGContract/v2.0"), "@type": "DEGContract",
                    "roles": [{"role": "buyerPlatform", "participantId": None},
                              {"role": "sellerPlatform", "participantId": bpp_id},
                              {"role": "buyerDiscom", "participantId": None},
                              {"role": "sellerDiscom", "participantId": discom_id}]},
                "commitmentAttributes": {
                    "@context": _URL.format("BecknTimeSeries/v1.0"), "@type": "TimeSeries",
                    "intervalPeriod": {"start": _z(run[0].start), "duration": f"PT{int(dur.total_seconds() // 60)}M"},
                    "payloadDescriptors": [
                        {"objectType": "EVENT_PAYLOAD_DESCRIPTOR", "payloadType": "PRICE_PER_KWH",
                         "currency": "INR", "insertedBy": "sellerPlatform"},
                        {"objectType": "EVENT_PAYLOAD_DESCRIPTOR", "payloadType": "AVAILABLE_QTY",
                         "units": "KWH", "insertedBy": "sellerPlatform"}],
                    "intervals": [{"id": k, "payloads": [
                        {"type": "PRICE_PER_KWH", "values": [round(o.floor_price, 2)]},
                        {"type": "AVAILABLE_QTY", "values": [round(o.quantity_kwh, 3)]}]}
                        for k, o in enumerate(run)]}}})
    return {
        "context": {"networkId": NETWORK_ID, "version": "2.0.0", "action": "catalog/publish", "bppId": bpp_id,
                    "bppUri": f"http://{bpp_id}/bpp/receiver", "transactionId": txn, "messageId": str(uuid.uuid4()),
                    "timestamp": _z(now), "schemaContext": [_URL.format(c) for c in CONTEXTS]},
        "message": {
            "publishDirectives": [{"catalogId": cat_id, "catalogType": "REGULAR", "updateMode": "MERGE",
                                   "visibleTo": [NETWORK_ID]}],
            "catalogs": [{
                "id": cat_id, "descriptor": {"name": "Rooftop solar surplus", "shortDesc": site.site_id},
                "bppId": bpp_id, "bppUri": f"http://{bpp_id}/bpp/receiver",
                "provider": {"id": bpp_id, "descriptor": {"name": site.site_id}},
                "resources": [{"id": f"energy-resource-{site.site_id}",
                               "descriptor": {"name": f"Solar + storage at {site.site_id}"},
                               "resourceAttributes": {"@context": _URL.format("EnergyResource/v2.0"),
                                                      "@type": "EnergyResource", "type": "SOLAR", "id": meter}}],
                "offers": offer_objs}]}}


_ISO_DUR = re.compile(r"^PT(\d+H)?(\d+M)?$")


def validate_publish(msg: dict) -> list[str]:
    """Structural and consistency checks from the EnergyTradeOffer v2.0 spec. Empty list means valid."""
    bad: list[str] = []
    ctx = msg.get("context", {})
    for k in ("networkId", "version", "action", "bppId", "transactionId", "messageId", "timestamp", "schemaContext"):
        if k not in ctx:
            bad.append(f"context.{k} missing")
    if ctx.get("action") != "catalog/publish":
        bad.append("context.action must be catalog/publish")
    for cat in msg.get("message", {}).get("catalogs", []):
        rids = {r["id"] for r in cat.get("resources", [])}
        for off in cat.get("offers", []):
            oa = off.get("offerAttributes", {})
            if oa.get("@type") != "EnergyTradeOffer":
                bad.append(f"{off.get('id')}: @type must be EnergyTradeOffer")
            if not set(off.get("resourceIds", [])) <= rids:
                bad.append(f"{off.get('id')}: resourceIds not in catalog resources")
            vw = oa.get("validityWindow", {})
            if vw.get("schema:startTime", "") >= vw.get("schema:endTime", ""):
                bad.append(f"{off.get('id')}: validityWindow must end after it starts")
            ca = oa.get("commitmentAttributes", {})
            if not _ISO_DUR.match(ca.get("intervalPeriod", {}).get("duration", "")):
                bad.append(f"{off.get('id')}: intervalPeriod.duration must be an ISO-8601 PT duration")
            declared = {d["payloadType"] for d in ca.get("payloadDescriptors", [])}
            used = {p["type"] for iv in ca.get("intervals", []) for p in iv.get("payloads", [])}
            if not used <= declared or not {"PRICE_PER_KWH", "AVAILABLE_QTY"} <= used:
                bad.append(f"{off.get('id')}: interval payload types {sorted(used)} must be declared and include price and quantity")
            if {r["role"] for r in oa.get("contractAttributes", {}).get("roles", [])} != {
                    "buyerPlatform", "sellerPlatform", "buyerDiscom", "sellerDiscom"}:
                bad.append(f"{off.get('id')}: contract roles incomplete")
    return bad
