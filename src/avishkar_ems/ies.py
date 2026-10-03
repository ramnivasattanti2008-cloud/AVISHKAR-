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


# ---- confirm and settle steps (buyer side is simulated: no live network was available) ----------------------

def _ctx(pub: dict, action: str, buyer: str, now: pd.Timestamp) -> dict:
    c = dict(pub["context"], action=action, bapId=buyer, bapUri=f"http://{buyer}/bap/receiver",
             messageId=str(uuid.uuid4()), timestamp=_z(now))
    return c


def _contract(pub: dict, offer: dict, buyer: str, requested: list[float], status: str, commit: str) -> dict:
    ca = offer["offerAttributes"]["commitmentAttributes"]
    ivs = [{"id": iv["id"], "payloads": iv["payloads"] + [{"type": "REQUESTED_QTY", "values": [round(q, 3)]}]}
           for iv, q in zip(ca["intervals"], requested)]
    desc = ca["payloadDescriptors"] + [{"objectType": "EVENT_PAYLOAD_DESCRIPTOR", "payloadType": "REQUESTED_QTY",
                                        "units": "KWH", "insertedBy": "buyerPlatform"}]
    cat = pub["message"]["catalogs"][0]
    res = dict(cat["resources"][0])
    roles = [dict(r, participantId=buyer) if r["role"] == "buyerPlatform" else r
             for r in offer["offerAttributes"]["contractAttributes"]["roles"]]
    return {
        "id": f"contract-{offer['id']}", "status": {"code": status},
        "commitments": [{"id": f"commitment-{offer['id']}", "status": {"descriptor": {"code": commit}},
                         "resources": [{"id": res["id"], "descriptor": res["descriptor"],
                                        "quantity": {"@type": "Quantity", "unitCode": "KWH",
                                                     "unitQuantity": round(sum(requested), 3)},
                                        "resourceAttributes": res["resourceAttributes"]}],
                         "offer": {"id": offer["id"], "resourceIds": offer["resourceIds"]},
                         "commitmentAttributes": dict(ca, payloadDescriptors=desc, intervals=ivs)}],
        "contractAttributes": dict(offer["offerAttributes"]["contractAttributes"], roles=roles)}


def _requests(pub: dict, offers: list[Offer], trades: list) -> list[tuple[dict, list[float]]]:
    """Per catalog offer, the quantity the (simulated) buyer asks for in each interval: the committed quantity
    where the clearing price met the floor, zero where it did not."""
    matched = {t.offer_id: t.matched for t in trades}
    cat_offers = pub["message"]["catalogs"][0]["offers"]
    return [(co, [o.quantity_kwh if matched.get(o.offer_id, True) else 0.0 for o in run])
            for co, run in zip(cat_offers, _runs(offers))]


def confirm_flow(pub: dict, offers: list[Offer], trades: list, buyer: str = "buyerapp.example.com",
                 now: pd.Timestamp | None = None) -> tuple[list[dict], list[dict]]:
    """Buyer confirms (DRAFT contract), seller platform answers on_confirm (ACTIVE). One pair per catalog offer."""
    now = now or pd.Timestamp.now(tz="UTC")
    reqs = _requests(pub, offers, trades)
    conf = [{"context": _ctx(pub, "confirm", buyer, now),
             "message": {"contract": _contract(pub, o, buyer, q, "DRAFT", "DRAFT")}} for o, q in reqs]
    onc = [{"context": _ctx(pub, "on_confirm", buyer, now + pd.Timedelta(seconds=2)),
            "message": {"contract": _contract(pub, o, buyer, q, "ACTIVE", "ACTIVE")}} for o, q in reqs]
    return conf, onc


def settled_status(pub: dict, offers: list[Offer], trades: list, buyer: str = "buyerapp.example.com",
                   now: pd.Timestamp | None = None) -> list[dict]:
    """on_status after delivery: contract COMPLETE, with the money that moved (from `settle.TradeResult`)."""
    now = now or pd.Timestamp.now(tz="UTC")
    by_id = {t.offer_id: t for t in trades}
    out = []
    for co, run in zip(pub["message"]["catalogs"][0]["offers"], _runs(offers)):
        ts = [by_id[o.offer_id] for o in run if o.offer_id in by_id]
        c = _contract(pub, co, buyer, [by_id[o.offer_id].delivered_kwh if o.offer_id in by_id else 0.0 for o in run],
                      "COMPLETE", "CLOSED")
        net = sum(t.revenue_inr - t.penalty_inr for t in ts)
        c["consideration"] = [{"id": "auto-settlement-flows", "considerationAttributes": {
            "@type": "RevenueFlow", "revenueFlows": [{
                "role": "sellerPlatform", "value": round(net, 2), "currency": "INR",
                "description": f"{sum(t.delivered_kwh for t in ts):.2f} kWh delivered, net of charges and penalty"}]}}]
        c["settlements"] = [{"id": f"settlement-{co['id']}", "considerationId": "auto-settlement-flows",
                             "status": "COMPLETE", "settlementAttributes": {
                                 "@type": "SettlementTerm", "paymentTrigger": "ON_FULFILLMENT",
                                 "settlementStatus": "COMPLETE"}}]
        out.append({"context": _ctx(pub, "on_status", buyer, now), "message": {"contract": c}})
    return out


def validate_flow(confirm: list[dict], on_confirm: list[dict], settled: list[dict]) -> list[str]:
    """Check the lifecycle: DRAFT -> ACTIVE -> COMPLETE, same contract throughout, buyer filled in, money booked."""
    bad: list[str] = []
    for c, a, s in zip(confirm, on_confirm, settled):
        k = [m["message"]["contract"] for m in (c, a, s)]
        if [x["status"]["code"] for x in k] != ["DRAFT", "ACTIVE", "COMPLETE"]:
            bad.append("contract status must go DRAFT, ACTIVE, COMPLETE")
        if len({x["id"] for x in k}) != 1:
            bad.append("contract id changed between messages")
        if any(r["role"] == "buyerPlatform" and r["participantId"] is None for r in k[0]["contractAttributes"]["roles"]):
            bad.append("buyerPlatform must be set at confirm")
        if not k[2].get("consideration") or k[2]["settlements"][0]["status"] != "COMPLETE":
            bad.append("settled message needs consideration and a COMPLETE settlement")
        qty = k[2]["commitments"][0]["commitmentAttributes"]["intervals"]
        if any(p["type"] == "REQUESTED_QTY" and v < 0 for iv in qty for p in iv["payloads"] for v in p["values"]):
            bad.append("negative quantity")
    return bad
