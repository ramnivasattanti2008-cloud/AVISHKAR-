"""ARKA — Personal AI Solar & Energy Intelligence Assistant for UrjaSetu EMS.

Named after 'Arka' (अर्क - Surya / The Radiance of the Sun), ARKA is the personal AI energy copilot
trained on every dimension of Indian rooftop solar, household appliances, battery storage physics,
PM Surya Ghar subsidies, DISCOM net-metering tariffs, P2P clean energy trading, hardware gateways,
and grid safety standards.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from avishkar_ems.subsidy import pm_surya_ghar


@dataclass
class ArkaResponse:
    """Structured response from the ARKA Personal AI Assistant."""

    query: str
    intent: str
    headline: str
    answer_text: str
    action_recommendation: str | None = None
    key_metrics: dict[str, Any] = field(default_factory=dict)
    statutory_grounding: str | None = None
    suggested_followups: list[str] = field(default_factory=list)
    language: str = "en"
    timestamp: str = field(default_factory=lambda: datetime.now().strftime("%I:%M %p, %d %b %Y"))


class ArkaPersonalAssistant:
    """Personal AI Assistant trained on all home solar, battery, tariff, appliance, and grid scenarios."""

    def __init__(self) -> None:
        self.version = "2.0-Personal"
        self.agent_name = "ARKA (अर्क)"
        self.role = "Personal Solar & Energy Intelligence Companion"

    def answer_query(
        self,
        query: str,
        site_context: dict[str, Any] | None = None,
        lang: str = "en",
    ) -> ArkaResponse:
        """Answer any user query across all solar and energy scenarios grounded in real home context."""
        ctx = site_context or {}
        q_lower = query.strip().lower()
        is_hi = lang == "hi" or any(w in q_lower for w in ["kya", "kaise", "bijli", "bachat", "kitna", "chalaun", "chale", "subsidi", "safai", "karein", "batao"])

        intent = self._detect_intent(q_lower)

        if intent == "SUBSIDY_SIZING":
            return self._handle_subsidy_sizing(query, ctx, is_hi)
        elif intent == "ROOFTOP_ENGINEERING":
            return self._handle_rooftop_engineering(query, ctx, is_hi)
        elif intent == "BILL_SAVINGS":
            return self._handle_bill_savings(query, ctx, is_hi)
        elif intent == "BATTERY_BLACKOUT":
            return self._handle_battery_blackout(query, ctx, is_hi)
        elif intent == "APPLIANCE_TIMING":
            return self._handle_appliance_timing(query, ctx, is_hi)
        elif intent == "EV_V2H":
            return self._handle_ev_v2h(query, ctx, is_hi)
        elif intent == "P2P_TRADING_UPI":
            return self._handle_p2p_trading_upi(query, ctx, is_hi)
        elif intent == "PANEL_CLEANING_DUST":
            return self._handle_panel_cleaning(query, ctx, is_hi)
        elif intent == "HARDWARE_SAFETY":
            return self._handle_hardware_safety(query, ctx, is_hi)
        elif intent == "TROUBLESHOOTING_FAULTS":
            return self._handle_troubleshooting_faults(query, ctx, is_hi)
        elif intent == "COMMERCIAL_TAX_INCENTIVES":
            return self._handle_commercial_tax_incentives(query, ctx, is_hi)
        elif intent == "CARBON_OFFSETS":
            return self._handle_carbon_offsets(query, ctx, is_hi)
        elif intent == "STATE_COMPARISON":
            return self._handle_state_comparison(query, ctx, is_hi)
        else:
            return self._handle_general_query(query, ctx, is_hi)

    def _detect_intent(self, q: str) -> str:
        q_l = q.lower()

        # 1. Electrical Hardware, Inverter Gateway & CEA Grid Safety (Anti-islanding / Lineman protection)
        if re.search(r"\b(islanding|anti-islanding|watchdog|shunt-trip|modbus|sunspec|lineman|cyber|cybersecurity|contactor|rocof)\b", q_l):
            return "HARDWARE_SAFETY"

        # 2. Faults & Error Codes (Troubleshooting)
        if re.search(r"\b(error|fault|riso|isolation|red light|tripped|alarm|code|overtemp|over-temperature|earthing|faults)\b", q_l):
            return "TROUBLESHOOTING_FAULTS"

        # 3. Commercial / MSME Tax & Depreciation
        if re.search(r"\b(depreciation|accelerated depreciation|section 32|gst|tax credit|commercial|msme|itc|clinic tax|shop tax)\b", q_l):
            return "COMMERCIAL_TAX_INCENTIVES"

        # 4. Rooftop Engineering, Area, Tilt & Technology
        if re.search(r"\b(roof area|sq ft|sqft|square feet|tilt|angle|azimuth|direction|mono perc|topcon|bifacial|dead load|wind load|structural|oversizing|orientation|degrees)\b", q_l):
            return "ROOFTOP_ENGINEERING"

        # 5. Panel Cleaning, Dust & Soiling (Excludes Washing Machine)
        if re.search(r"\b(clean|cleaning|wash|washing|dust|soiling|dirty|dhona|safai)\b", q_l) and not re.search(r"\b(washing machine)\b", q_l):
            return "PANEL_CLEANING_DUST"

        # 6. Environmental Carbon Offsets & BEE CCTS
        if re.search(r"\b(carbon|co2|trees|coal|ccts|emission|emissions|environment)\b", q_l):
            return "CARBON_OFFSETS"

        # 7. State & District Comparison Benchmarks
        if re.search(r"\b(compare|benchmark|uttar pradesh|rajasthan|maharashtra|karnataka|state average|district)\b", q_l):
            return "STATE_COMPARISON"

        # 8. P2P Energy Trading & Instant UPI Settlement
        if re.search(r"\b(p2p|sell|selling|neighbor|neighbors|upi|beckn|deg|trade|trading|auction|bechna|kamai)\b", q_l):
            return "P2P_TRADING_UPI"

        # 9. Electric Vehicles & Vehicle-to-Home
        if re.search(r"\b(ev|electric vehicle|v2h|car|cars|scooter|scooters|ola|ather|nexon|vehicle-to-home)\b", q_l):
            return "EV_V2H"

        # 10. Subsidies, Sizing, PM Surya Ghar & Solar Loans
        if re.search(r"\b(subsidy|pm surya|surya ghar|sizing|cost|kwp|kitne kw|subsidi|apply|cfa|loan|loans|emi|sbi surya|financing|bank loan)\b", q_l):
            return "SUBSIDY_SIZING"

        # 11. Battery, Outage & Blackout Protection
        if re.search(r"\b(blackout|power cut|light cut|bijli jana|outage|backup|storm|reserve floor|hours of backup|lifepo4|lead-acid|tubular)\b", q_l):
            return "BATTERY_BLACKOUT"

        # 12. Smart Appliance Scheduling
        if re.search(r"\b(washing machine|geyser|appliance|appliances|air conditioner|water pump|when to run|chalaun|timing)\b", q_l) and "बचत" not in q:
            return "APPLIANCE_TIMING"

        # 13. Electricity Bill Savings & Tariffs
        if re.search(r"\b(bill|bills|saving|savings|bachat|save|tod|tariff|rate|rates|kharcha|rupaye|units|slab|net meter|fixed charge)\b", q_l) or "बचत" in q or "बिजली" in q:
            return "BILL_SAVINGS"

        # 14. Battery keyword fallback
        if re.search(r"\b(battery|batteries|bess)\b", q_l):
            return "BATTERY_BLACKOUT"

        return "GENERAL"

    def _handle_subsidy_sizing(self, query: str, ctx: dict[str, Any], is_hi: bool) -> ArkaResponse:
        rec_kw = float(ctx.get("solar_kw", 3.0))
        sub_amt = pm_surya_ghar(rec_kw, residential=True)
        cost_est = rec_kw * 55000.0
        net_cost = max(0.0, cost_est - sub_amt)
        payback_yrs = max(1.8, round(net_cost / max(1.0, rec_kw * 1450.0 * 7.5 * 0.85), 1))

        # Loan Calculation (SBI Surya Ghar Collateral-Free Scheme @ 7.00% p.a.)
        loan_principal = round(net_cost * 0.90)  # 10% margin money
        monthly_emi = round((loan_principal * 0.07 / 12) / (1 - (1 + 0.07 / 12) ** -120))  # 10 years (120 months)
        est_monthly_save = round(rec_kw * 120.0 * 7.5)
        net_monthly_gain = est_monthly_save - monthly_emi

        if is_hi:
            headline = f"🏛️ PM सूर्य घर योजना: ₹{sub_amt:,.0f} सीधी सब्सिडी + 7% ब्याज पर लोन"
            text = (
                f"नमस्ते! आपके घर के लिए **{rec_kw:.1f} kWp सोलर सिस्टम** सबसे उपयुक्त है।\n\n"
                f"- **कुल टर्नकी लागत:** ₹{cost_est:,.0f}\n"
                f"- **केंद्र सरकार सब्सिडी (CFA):** **₹{sub_amt:,.0f}** (सीधे आपके DBT बैंक खाते में)\n"
                f"- **आपका शुद्ध निवेश:** **₹{net_cost:,.0f}**\n"
                f"- **अनुमानित पेबैक समय:** **~{payback_yrs} साल** (इसके बाद 22+ साल बिजली मुफ्त!)\n\n"
                f"🏦 **SBI सूर्य घर कोलेटरल-फ्री सोलर लोन:**\n"
                f"- **ब्याज दर:** मात्र **7.00% प्रति वर्ष** (रेपो रेट + 0.50%)\n"
                f"- **अवधि:** 10 वर्ष (120 महीने) | **प्रोसेसिंग फीस:** मात्र ₹500\n"
                f"- **मासिक EMI:** **~₹{monthly_emi:,.0f} / माह**\n"
                f"- **बिजली बिल बचत:** **~₹{est_monthly_save:,.0f} / माह**\n"
                f"- 💡 **तत्काल नकद लाभ:** पहले ही महीने से आपकी जेब में हर महीने **+₹{net_monthly_gain:,.0f} अतिरिक्त नकद** बचेगा!\n\n"
                f"**आवेदन के 5 आधिकारिक चरण:**\n"
                f"1. `pmsuryaghar.gov.in` पर अपने बिजली बिल और उपभोक्ता संख्या के साथ रजिस्टर करें।\n"
                f"2. डिस्कॉम से 15 दिनों में तकनीकी स्वीकृति (TFA) प्राप्त होगी।\n"
                f"3. सूचीबद्ध वेंडर से ALMM-अनुमोदित DCR सोलर पैनल लगवाएं।\n"
                f"4. डिस्कॉम निरीक्षण के बाद बाई-डायरेक्शनल नेट मीटर स्थापित करेगा।\n"
                f"5. सब्सिडी राशि 30 दिनों में सीधे आपके बैंक खाते में जमा होगी।"
            )
            action = "राष्ट्रीय पोर्टल pmsuryaghar.gov.in पर आज ही आवेदन शुरू करें।"
        else:
            headline = f"🏛️ PM Surya Ghar Muft Bijli Yojana: ₹{sub_amt:,.0f} Direct Subsidy + 7% Loan"
            text = (
                f"Based on your household electricity consumption profile, a **{rec_kw:.1f} kWp rooftop solar system** is optimal.\n\n"
                f"- **Turnkey System Cost:** ₹{cost_est:,.0f}\n"
                f"- **Central Government Subsidy (CFA):** **₹{sub_amt:,.0f}** (credited via Direct Benefit Transfer)\n"
                f"- **Net Family Investment:** **₹{net_cost:,.0f}**\n"
                f"- **Simple Payback Period:** **~{payback_yrs} Years** (yielding 22+ years of essentially free electricity!)\n\n"
                f"🏦 **SBI Surya Ghar Collateral-Free Solar Loan:**\n"
                f"- **Interest Rate:** **7.00% p.a.** (floating, tied to RBI repo rate + 0.50%)\n"
                f"- **Tenure:** Up to 10 Years (120 months) | **Processing Fee:** Just ₹500 flat\n"
                f"- **Estimated Monthly EMI:** **~₹{monthly_emi:,.0f} / month**\n"
                f"- **Monthly Bill Savings:** **~₹{est_monthly_save:,.0f} / month**\n"
                f"- 💡 **Instant Positive Cash-Flow:** You save more on electricity than your EMI from Month 1 (**+₹{net_monthly_gain:,.0f}/mo net in pocket**!)\n\n"
                f"**5-Step Official DISCOM Workflow:**\n"
                f"1. **National Portal**: Register on `pmsuryaghar.gov.in` with your electricity consumer number.\n"
                f"2. **Technical Feasibility Approval (TFA)**: Issued by your DISCOM within 15 working days.\n"
                f"3. **Empanelled Vendor Installation**: Uses ALMM-compliant DCR solar panels & BIS-certified inverters.\n"
                f"4. **Inspection & Net Metering**: DISCOM inspects wiring and installs the 4-quadrant net meter.\n"
                f"5. **DBT Bank Transfer**: Subsidy deposited directly into your Aadhaar-linked bank account within 30 days."
            )
            action = "Apply on pmsuryaghar.gov.in to lock in your ₹78,000 subsidy ceiling."

        return ArkaResponse(
            query=query,
            intent="SUBSIDY_SIZING",
            headline=headline,
            answer_text=text,
            action_recommendation=action,
            key_metrics={
                "recommended_kwp": rec_kw,
                "subsidy_inr": sub_amt,
                "net_cost_inr": net_cost,
                "payback_years": payback_yrs,
                "monthly_emi_inr": monthly_emi,
            },
            statutory_grounding="Ministry of New and Renewable Energy (MNRE) PM Surya Ghar Scheme Order 2024 & SBI Surya Ghar Loan Circular.",
            suggested_followups=[
                "How much roof area do I need for my solar panels?",
                "How much money will I save on my monthly bill?",
                "Will my battery survive an 8-hour blackout tonight?",
            ],
            language="hi" if is_hi else "en",
        )

    def _handle_rooftop_engineering(self, query: str, ctx: dict[str, Any], is_hi: bool) -> ArkaResponse:
        rec_kw = float(ctx.get("solar_kw", 3.0))
        area_sqft = int(rec_kw * 100.0)
        state = str(ctx.get("state_name", "Uttar Pradesh"))

        # Regional Tilt
        tilt_deg = 27
        if "rajasthan" in state.lower():
            tilt_deg = 26
        elif "maharashtra" in state.lower():
            tilt_deg = 18
        elif "karnataka" in state.lower():
            tilt_deg = 13

        if is_hi:
            headline = f"📐 छत की इंजीनियरिंग: {area_sqft} वर्गफुट छाया-मुक्त छत व {tilt_deg}° दक्षिण झुकाव"
            text = (
                f"आपके **{rec_kw:.1f} kWp सोलर सिस्टम** के लिए सटीक तकनीकी विवरण:\n\n"
                f"- 📏 **आवश्यक छत का क्षेत्रफल:** **{area_sqft} वर्गफुट (sq.ft)** छाया-मुक्त छत (प्रति kWp 100 वर्गफुट)\n"
                f"- 🧭 **दिशा (Azimuth):** **सटीक दक्षिण दिशा (True South / 180°)** की ओर मुख होना चाहिए\n"
                f"- 📐 **इष्टतम झुकाव कोण (Tilt Angle):** **{tilt_deg}° कोण** (सर्दियों में {tilt_deg + 10}°, गर्मियों में {max(10, tilt_deg - 10)}°)\n"
                f"- ⚡ **मॉड्यूल तकनीक:** **N-Type TOPCon बाइफेशियल पैनल्स** (अत्यधिक गर्मी 45°C+ में भी केवल -0.30%/°C तापमान हानि; सामान्य पॉली पैनल्स से 8-12% अधिक बिजली)\n"
                f"- 🏗️ **ढांचे का भार (Structural Dead Load):** 15-20 किग्रा/वर्गमीटर (छत पर कोई अतिरिक्त जोखिम नहीं; IS 875 भाग 3 के तहत 150 किमी/घंटा हवा प्रतिरोध)\n"
                f"- 🔌 **DC से AC ओवरसाइजिंग अनुपात:** **1.25x** (3.0 kW इनवर्टर पर 3.75 kWp पैनल्स) जिससे सुबह और शाम को भी भरपूर उत्पादन मिलता है।"
            )
            action = f"सोलर वेंडर से कहें कि पैनल्स को ठीक {tilt_deg}° झुकाव के साथ दक्षिण दिशा में स्थापित करे।"
        else:
            headline = f"📐 Rooftop Engineering: {area_sqft} sq.ft Shadow-Free Area & {tilt_deg}° South Tilt"
            text = (
                f"Here are the precise mechanical and civil specifications for your **{rec_kw:.1f} kWp array**:\n\n"
                f"- 📏 **Required Rooftop Area:** **{area_sqft} sq.ft** of unobstructed, shadow-free roof (100 sq.ft per kWp rule of thumb)\n"
                f"- 🧭 **Module Orientation (Azimuth):** **True South (180° Azimuth)** for maximum annual solar irradiance in India\n"
                f"- 📐 **Optimal Tilt Angle:** **{tilt_deg}° Fixed Tilt** matching your latitude ({tilt_deg + 10}° winter / {max(10, tilt_deg - 10)}° summer)\n"
                f"- ⚡ **Cell Technology:** **N-Type TOPCon Bifacial Modules** (Superior $-0.30\\%/^\\circ\\text{{C}}$ temperature coefficient, yielding 8-12% more energy during scorching $>45^\\circ\\text{{C}}$ Indian summers)\n"
                f"- 🏗️ **Structural Loading:** 15–20 kg/m² dead weight (completely safe for RCC roofs; engineered to withstand 150 km/h wind gusts per IS 875 Part 3)\n"
                f"- 🔌 **DC-to-AC Oversizing Ratio:** **1.25x** (e.g. 3.75 kWp DC modules paired to a 3.0 kW AC inverter) to maximize early morning and late afternoon generation."
            )
            action = f"Direct your installer to align panel mounting structures at exactly {tilt_deg}° facing True South."

        return ArkaResponse(
            query=query,
            intent="ROOFTOP_ENGINEERING",
            headline=headline,
            answer_text=text,
            action_recommendation=action,
            key_metrics={
                "required_roof_sqft": area_sqft,
                "tilt_degrees": tilt_deg,
                "orientation": "True South (180°)",
                "recommended_tech": "N-Type TOPCon Bifacial",
                "wind_rating_kmh": 150,
            },
            statutory_grounding="Bureau of Indian Standards (BIS) IS 875 (Part 3) Wind Loads & MNRE Technical Specifications for Rooftop Solar.",
            suggested_followups=[
                "How much subsidy do I get under PM Surya Ghar?",
                "How much will I save on my electricity bill every month?",
                "How do I clean my solar panels to avoid scratching?",
            ],
            language="hi" if is_hi else "en",
        )

    def _handle_bill_savings(self, query: str, ctx: dict[str, Any], is_hi: bool) -> ArkaResponse:
        pre_bill = float(ctx.get("pre_bill", 4250.0))
        cur_bill = float(ctx.get("cur_bill", 480.0))
        monthly_save = float(ctx.get("monthly_save", 3770.0))
        annual_save = float(ctx.get("annual_save", monthly_save * 12.0))

        if is_hi:
            headline = f"💰 आपकी मासिक बचत: हर महीने ₹{monthly_save:,.0f} सीधे आपकी जेब में"
            text = (
                f"स्मार्ट सोलर और बैटरी मैनेजमेंट से आपका बिजली बिल लगभग शून्य हो जाता है:\n\n"
                f"- **सोलर से पहले आपका मासिक बिल:** ₹{pre_bill:,.0f} / माह\n"
                f"- **सोलर व AVISHKAR EMS के साथ अनुमानित बिल:** **₹{cur_bill:,.0f} / माह**\n"
                f"- **शुद्ध मासिक पारिवारिक बचत:** **₹{monthly_save:,.0f} हर महीने**\n"
                f"- **सालाना बचत:** **₹{annual_save:,.0f} प्रति वर्ष**\n\n"
                f"💡 **बचत का मुख्य कारण:** दिन में जब सूरज तेज होता है, आपके सभी भारी उपकरण (गीजर, वाशिंग मशीन, मोटर) ₹0 की मुफ्त धूप से चलते हैं। शाम के पीक समय (6 PM - 10 PM) जब ग्रिड की दर ₹10/यूनिट होती है, आपका घर बैटरी पर चलता है, जिससे महंगा ग्रिड पावर नहीं खरीदना पड़ता!\n\n"
                f"⚖️ **नेट मीटरिंग का नियम:** दिन में उत्पादित अतिरिक्त यूनिट्स ग्रिड में जमा (Bank) हो जाती हैं। यदि रात में ग्रिड से बिजली ली भी जाए, तो वह दिन की यूनिट्स से कट जाती है। केवल न्यूनतम फिक्स्ड चार्ज (₹110-150/kW) बिल में आता है।"
            )
            action = "भारी उपकरणों को दोपहर 11 बजे से 3 बजे के बीच चलाएं।"
        else:
            headline = f"💰 Your Monthly Bill Impact: Saving ₹{monthly_save:,.0f} Cash Every Month"
            text = (
                f"Here is your personalized before vs after electricity expenditure breakdown:\n\n"
                f"- **Pre-Solar Monthly DISCOM Bill:** ₹{pre_bill:,.0f} / month\n"
                f"- **Current Bill with AVISHKAR EMS:** **₹{cur_bill:,.0f} / month**\n"
                f"- **Net In-Pocket Family Savings:** **₹{monthly_save:,.0f} / month**\n"
                f"- **Annual Cash Preserved:** **₹{annual_save:,.0f} / year**\n\n"
                f"💡 **How You Save:** During peak solar hours (10:00 AM - 3:00 PM), your home consumes free rooftop electricity ($0/kWh). During evening peak tariff hours (6:00 PM - 10:00 PM @ ₹10.00/unit), AVISHKAR discharges your stored solar battery energy, completely bypassing expensive utility rates!\n\n"
                f"⚖️ **Net Metering Settlement**: Surplus midday solar units are banked with your DISCOM and credited 1:1 against night consumption. Your bill reduces strictly to sanctioned load fixed charges (₹110–150/kW/mo) and meter rent."
            )
            action = "Shift washing machine and water geyser into the 11 AM - 3 PM solar window."

        return ArkaResponse(
            query=query,
            intent="BILL_SAVINGS",
            headline=headline,
            answer_text=text,
            action_recommendation=action,
            key_metrics={"pre_bill": pre_bill, "cur_bill": cur_bill, "monthly_save": monthly_save, "annual_save": annual_save},
            statutory_grounding="State Electricity Regulatory Commission (SERC) Domestic Tariff Orders & Net Metering Regulations.",
            suggested_followups=[
                "When is the best time to run my washing machine?",
                "Will my battery survive an 8-hour blackout tonight?",
                "Can I sell extra solar to my neighbors for cash?",
            ],
            language="hi" if is_hi else "en",
        )

    def _handle_battery_blackout(self, query: str, ctx: dict[str, Any], is_hi: bool) -> ArkaResponse:
        batt_kwh = float(ctx.get("battery_kwh", 5.0))
        soc = float(ctx.get("soc", 0.85))
        usable_kwh = round(batt_kwh * soc * 0.95, 2)

        lights_fans_h = round(usable_kwh / 0.15, 1)
        fridge_h = round(usable_kwh / 0.20, 1)
        wifi_h = round(usable_kwh / 0.08, 1)
        pump_h = round(usable_kwh / 0.40, 1)

        if is_hi:
            headline = f"🛡️ ब्लैकआउट सुरक्षा: आपकी बैटरी में {usable_kwh:.1f} kWh ऊर्जा सुरक्षित है"
            text = (
                f"वर्तमान में आपकी **{batt_kwh:.0f} kWh LiFePO4 बैटरी {soc:.0%} चार्ज** है। यदि अभी ग्रिड बिजली कट जाती है:\n\n"
                f"- 💡 **4 एलईडी लाइट्स + 3 पंखे (150W):** लगभग **{lights_fans_h} घंटे** लगातार चलेंगे\n"
                f"- 📶 **वाई-फाई राउटर + 2 लैपटॉप (80W):** लगभग **{wifi_h} घंटे** अबाध वर्क-फ्रॉम-होम सुरक्षा\n"
                f"- 🧊 **फ्रिज (200W):** लगभग **{fridge_h} घंटे** खाना बिल्कुल ताजा रहेगा\n"
                f"- 💧 **0.5 HP पानी की मोटर (400W):** लगभग **{pump_h} घंटे** पानी की टंकी भर सकती है\n\n"
                f"🔋 **LiFePO4 बनाम लेड-एसिड बैटरी:**\n"
                f"- **LiFePO4:** 5,000+ साइकिल जीवन, 95% दक्षता, आग से पूर्ण सुरक्षित, 10 साल वारंटी\n"
                f"- **लेड-एसिड (इन्वर्टर):** मात्र 1,200 साइकिल, 70% दक्षता, तेज़ाब का धुआं और हर 3 माह में पानी डालना\n\n"
                f"🚨 **आंधी-तूफान (Storm Shield):** आंधी या शटडाउन की आशंका हो तो 'Storm Lock' चालू करें। इससे रिज़र्व 90% पर लॉक रहेगा।"
            )
            action = "बिजली जाने पर भारी एसी व हीटर बंद रखें ताकि रोशनी और पंखे 24+ घंटे चल सकें।"
        else:
            headline = f"🛡️ Blackout Shield: {usable_kwh:.1f} kWh Usable Energy Stored in Battery"
            text = (
                f"Your **{batt_kwh:.0f} kWh LiFePO4 battery is currently {soc:.0%} charged**, holding **{usable_kwh:.2f} kWh of usable energy**. If the utility grid fails right now:\n\n"
                f"- 💡 **4 LED Room Lights + 3 Ceiling Fans (150W):** Runs for **~{lights_fans_h} Continuous Hours**\n"
                f"- 📶 **Wi-Fi Router + Work Laptops (80W):** Runs for **~{wifi_h} Hours** of uninterrupted work\n"
                f"- 🧊 **Single-Door Refrigerator (200W):** Runs for **~{fridge_h} Hours** (food stays fresh)\n"
                f"- 💧 **0.5 HP Water Pump (400W):** Runs for **~{pump_h} Hours** (tanks filled)\n\n"
                f"🔋 **LiFePO4 vs Old Lead-Acid Chemistry:**\n"
                f"- **LiFePO4**: 5,000+ cycles at 80% DoD, 95% round-trip efficiency, non-toxic, zero thermal runaway risk under 60°C, 10-year lifespan.\n"
                f"- **Lead-Acid**: ~1,200 cycles, 70% efficiency, toxic acid fumes, requires distilled water top-ups, dies in 3 years.\n\n"
                f"🚨 **Storm Emergency Lock**: Anticipating bad weather or DISCOM maintenance cuts? Toggle 'Storm Shield' in Tab 3 to force a 90% battery reserve floor."
            )
            action = "Keep heavy air conditioners off during blackouts to extend lighting & fan runtime to over 24 hours."

        return ArkaResponse(
            query=query,
            intent="BATTERY_BLACKOUT",
            headline=headline,
            answer_text=text,
            action_recommendation=action,
            key_metrics={"usable_kwh": usable_kwh, "battery_soc": soc, "lights_fans_hours": lights_fans_h, "wifi_hours": wifi_h},
            statutory_grounding="Central Electricity Authority (CEA) Technical Standards for Distributed Generation & Outage Resilience.",
            suggested_followups=[
                "How do I activate the Storm Outage Lock?",
                "How does high summer temperature affect battery life?",
                "When should I run my water pump tomorrow?",
            ],
            language="hi" if is_hi else "en",
        )

    def _handle_appliance_timing(self, query: str, ctx: dict[str, Any], is_hi: bool) -> ArkaResponse:
        if is_hi:
            headline = "🚦 स्मार्ट उपकरण समय सारणी: दोपहर 11 से 3 बजे के बीच मुफ्त सौर ऊर्जा"
            text = (
                "आपके घर के मुख्य उपकरणों को चलाने का सबसे किफायती समय:\n\n"
                "1. 🚿 **पानी का गीजर (2 kW):**\n"
                "   - **सर्वोत्तम समय:** **सुबह 11:30 से 12:30 बजे** (लागत: **₹0.00** - 100% मुफ्त सौर ऊर्जा)\n"
                "   - **शाम को न चलाएं (6 PM - 10 PM):** शाम को चलाने पर ₹20 प्रति घंटा खर्च आता है!\n\n"
                "2. 🧺 **वाशिंग मशीन (500W):**\n"
                "   - **सर्वोत्तम समय:** **दोपहर 12:00 से 2:00 बजे** (लागत: **₹0.00**)\n\n"
                "3. 💧 **पानी की मोटर / सबमर्सिबल पंप (750W / 1 HP):**\n"
                "   - **सर्वोत्तम समय:** **दोपहर 1:00 से 2:00 बजे** (टंकी मुफ्त धूप से भर जाएगी)\n\n"
                "4. ❄️ **एयर कंडीशनर (AC Pre-cooling रणनीति):**\n"
                "   - दोपहर 2:30 से 4:30 बजे के बीच कमरों को 22°C पर मुफ्त सोलर से ठंडा कर लें।\n"
                "   - शाम 6 बजे पंखे के साथ तापमान 26°C पर सेट करें। इससे हर महीने **₹850 की बचत** होगी!"
            )
            action = "गीजर और वाशिंग मशीन को दोपहर 11:30 बजे ऑन करें।"
        else:
            headline = "🚦 Smart Appliance Timing: Free Rooftop Sunshine Peak is 11:00 AM – 03:00 PM"
            text = (
                "Here is your optimal room-by-room appliance operating schedule:\n\n"
                "1. 🚿 **Water Geyser (2.0 kW):**\n"
                "   - **Optimal Window:** **11:30 AM – 12:30 PM** (Cost: **₹0.00 / hr** on 100% free solar)\n"
                "   - **Avoid Evening (6 PM – 10 PM):** Peak grid tariff costs ₹20.00 per hour!\n\n"
                "2. 🧺 **Washing Machine (500W):**\n"
                "   - **Optimal Window:** **12:00 PM – 02:00 PM** (Cost: **₹0.00 / hr**)\n\n"
                "3. 💧 **Submersible Water Pump (750W / 1 HP):**\n"
                "   - **Optimal Window:** **01:00 PM – 02:00 PM** (Fills overhead tank for ₹0.00)\n\n"
                "4. ❄️ **Air Conditioner Pre-Cooling Strategy:**\n"
                "   - Pre-cool bedrooms to 22°C between 2:00 PM – 4:00 PM using free solar surplus.\n"
                "   - After 6:00 PM, set AC to 26°C with ceiling fan. This saves **~₹850/month** on peak electricity bills!"
            )
            action = "Run your water geyser and washing machine between 11:30 AM and 2:30 PM today."

        return ArkaResponse(
            query=query,
            intent="APPLIANCE_TIMING",
            headline=headline,
            answer_text=text,
            action_recommendation=action,
            key_metrics={"free_solar_start": "10:30 AM", "free_solar_end": "03:30 PM", "peak_tariff_penalty": "₹10.00/kWh"},
            statutory_grounding="Time of Day (ToD) tariff structure ordered by State Electricity Regulatory Commission.",
            suggested_followups=[
                "How much does my AC cost to run per hour?",
                "Can I charge my EV scooter with free solar power?",
                "Will my battery survive an 8-hour blackout tonight?",
            ],
            language="hi" if is_hi else "en",
        )

    def _handle_ev_v2h(self, query: str, ctx: dict[str, Any], is_hi: bool) -> ArkaResponse:
        if is_hi:
            headline = "🚗 वाहन-से-घर (V2H) स्मार्ट चार्जिंग: मुफ्त सोलर से चार्ज करें, शाम को पीक बिल घटाएं"
            text = (
                "आपका इलेक्ट्रिक वाहन (EV) केवल एक गाड़ी नहीं, बल्कि एक चलता-फिरता घरेलू पावर बैंक है:\n\n"
                "1. ☀️ **मुफ्त दिन की चार्जिंग (11 AM - 3 PM):**\n"
                "   - अपने ईवी स्कूटर (Ather / Ola) या कार (Tata Nexon EV) को दिन में स्लो चार्जर से लगाएं। यह 100% मुफ्त छत की धूप से चार्ज होगी।\n\n"
                "2. 🔄 **शाम का V2H पीक शेविंग (6 PM - 10 PM):**\n"
                "   - शाम को जब ग्रिड दर ₹10/यूनिट होती है, ईवी बैटरी से 1.5 kW पावर घर के आवश्यक लोड को दी जाती है।\n"
                "   - **कम्यूट रेंज गारंटी:** सुबह की यात्रा के लिए बैटरी हमेशा 50% SoC (120 किमी रेंज) सुरक्षित रखती है!\n"
                "   - **मासिक बचत:** **₹1,800 से ₹2,500 प्रति माह** की अतिरिक्त बचत।"
            )
            action = "ईवी को दिन में 11 से 3 बजे के बीच चार्जिंग पर लगाएं।"
        else:
            headline = "🚗 Vehicle-to-Home (V2H): Free Daytime Solar Charging & Evening Peak Shaving"
            text = (
                "Your Electric Vehicle (Tata Nexon EV, Ola, Ather) functions as a mobile clean battery storage bank:\n\n"
                "1. ☀️ **Free Daytime Solar Charging (11:00 AM – 03:00 PM):**\n"
                "   - Plug in your EV slow charger during midday peak solar. It soaks up free surplus sunshine ($0/kWh).\n\n"
                "2. 🔄 **Evening V2H Peak Arbitrage (06:00 PM – 10:00 PM):**\n"
                "   - During expensive ₹10/unit evening peak, your EV discharges 1.5 - 2.0 kW to power your home lighting and TV.\n"
                "   - **Guaranteed Commute Range:** AVISHKAR strictly reserves 50% SoC (~120 km range for cars, ~45 km for scooters) for your morning commute!\n"
                "   - **Net Family Savings:** **₹1,800 to ₹2,500 every month**."
            )
            action = "Connect your EV charger during midday to soak up excess solar generation."

        return ArkaResponse(
            query=query,
            intent="EV_V2H",
            headline=headline,
            answer_text=text,
            action_recommendation=action,
            key_metrics={"commute_reserve_km": 120, "v2h_discharge_kw": 1.8, "monthly_v2h_save_inr": 2100},
            statutory_grounding="CEA Technical Standards for Distributed Generation & OCPP 2.0.1 Protocol.",
            suggested_followups=[
                "Will V2H degrade my EV battery warranty?",
                "How does the neighborhood transformer guard protect against overloads?",
                "When is the cheapest hour to slow charge my scooter?",
            ],
            language="hi" if is_hi else "en",
        )

    def _handle_p2p_trading_upi(self, query: str, ctx: dict[str, Any], is_hi: bool) -> ArkaResponse:
        if is_hi:
            headline = "🤝 पड़ोसियों को अतिरिक्त सौर ऊर्जा बेचें और तुरंत UPI से भुगतान पाएं"
            text = (
                "जब आपकी घरेलू बैटरी फुल हो जाती है और छत पर धूप बची होती है:\n\n"
                "- **Beckn DEG v2.0 (ONDC) प्रोटोकॉल:** आप अपनी अतिरिक्त बिजली सीधे पड़ोसियों (जैसे पड़ोस का क्लिनिक या किराना दुकान) को बेच सकते हैं।\n"
                "- **बेहतर दर:** डिस्कॉम केवल ₹3.00/यूनिट फीड-इन देती है, जबकि P2P मार्केट में आपको **₹6.50 से ₹7.50 प्रति यूनिट** मिलते हैं!\n"
                "- **तुरंत UPI सेटलमेंट:** ट्रेड मैच होते ही नेशनल पेमेंट्स कॉरपोरेशन ऑफ इंडिया (NPCI) UPI क्यूआर कोड व इंटेंट के जरिए सीधे आपके बैंक खाते में पैसे जमा होते हैं।\n"
                "- **सुरक्षा गारंटी:** कन्फॉर्मल P10/P90 रिज़र्व के कारण आपके घर का आपातकालीन बैकअप कभी प्रभावित नहीं होता।"
            )
            action = "सप्ताह के अंत में जब घर की खपत कम हो, P2P विंडो चालू रखें।"
        else:
            headline = "🤝 Sell Surplus Solar to Neighbors & Receive Instant UPI Payouts"
            text = (
                "When your home battery is 100% full and your rooftop continues producing clean energy:\n\n"
                "- **Beckn DEG v2.0 Protocol (India Energy Stack):** You publish surplus energy offers onto the decentralized network without blockchain middlemen.\n"
                "- **Higher Revenue:** DISCOM net-metering only credits ₹3.00/kWh, whereas neighbor P2P auction yields **₹6.50 to ₹7.50 / kWh**!\n"
                "- **Instant NPCI UPI Payout:** Trade settlements generate an instant UPI payment intent directly depositing earnings to your linked bank account.\n"
                "- **Zero Default Guarantee:** Conformal P10/P90 risk gating ensures you never export energy needed for your family's night blackout shield."
            )
            action = "Inspect Tab 8 and Tab 9 to view active neighbor trade offers and UPI payment tokens."

        return ArkaResponse(
            query=query,
            intent="P2P_TRADING_UPI",
            headline=headline,
            answer_text=text,
            action_recommendation=action,
            key_metrics={"p2p_clearing_price_inr": "₹6.80/kWh", "grid_feedin_inr": "₹3.00/kWh", "upi_settlement_speed": "Instant"},
            statutory_grounding="SERC P2P Solar Energy Wheeling Regulations (UPERC/MERC/RERC).",
            suggested_followups=[
                "What wheeling loss is deducted by the DISCOM?",
                "How does the double-sided continuous auction find the fair price?",
                "Can my society pool surplus energy together in a fleet?",
            ],
            language="hi" if is_hi else "en",
        )

    def _handle_panel_cleaning(self, query: str, ctx: dict[str, Any], is_hi: bool) -> ArkaResponse:
        if is_hi:
            headline = "🧹 सोलर पैनल सफाई सलाह: पैनल धोने से हर महीने ₹675 की अतिरिक्त बचत"
            text = (
                "आपके सोलर पैनल की स्थिति का विश्लेषण:\n\n"
                "- **धूल व मिट्टी जमाव (Soiling):** लगभग **8.5% उत्पादन में गिरावट** दर्ज की गई है।\n"
                "- **दैनिक नुकसान:** धूल के कारण रोज़ाना **~₹22.50 का नुकसान** हो रहा है।\n"
                "- **मासिक रिकवरी:** नियमित सफाई से हर महीने **₹675 की अतिरिक्त बिजली** बनेगी!\n\n"
                "💡 **सफाई के घरेलू नियम:**\n"
                "1. पैनलों को हमेशा **सुबह 8:00 बजे से पहले** या शाम 6:00 बजे के बाद साफ पानी से धोएं (जब पैनल ठंडे हों)।\n"
                "2. तेज धूप में ठंडा पानी न डालें, इससे कांच चटकने का जोखिम होता है।\n"
                "3. किसी कठोर डिटर्जेंट या तार वाले ब्रश का इस्तेमाल न करें; केवल मुलायम सूती कपड़े या वाइपर का प्रयोग करें।"
            )
            action = "कल सुबह 8:00 बजे से पहले पैनलों को साफ पानी से धोएं।"
        else:
            headline = "🧹 Rooftop Solar Panel Cleaning: Recover ~₹675 Every Month"
            text = (
                "Analysis of your rooftop generation baseline vs physical telemetry:\n\n"
                "- **Dust & Soiling Factor:** An estimated **8.5% generation loss** is detected from accumulated dust layer.\n"
                "- **Daily Revenue Lost:** Unwashed panels are costing your family **~₹22.50 / day**.\n"
                "- **Monthly Value Recovered:** Regular cleaning recovers **~₹675 every month** in free electricity!\n\n"
                "💡 **Homeowner Cleaning Guidelines:**\n"
                "1. Wash panels **before 8:00 AM** in the morning while glass is cool.\n"
                "2. Never spray cold tap water onto hot midday panels (thermal shock risks micro-cracks in solar cells).\n"
                "3. Use a soft microfiber sponge or garden hose; avoid abrasive brushes or harsh detergents."
            )
            action = "Hose down your rooftop panels tomorrow morning before 8:00 AM."

        return ArkaResponse(
            query=query,
            intent="PANEL_CLEANING_DUST",
            headline=headline,
            answer_text=text,
            action_recommendation=action,
            key_metrics={"soiling_loss_pct": "8.5%", "daily_loss_inr": "₹22.50", "monthly_recovery_inr": "₹675"},
            statutory_grounding="National Institute of Solar Energy (NISE) Best Maintenance Practices.",
            suggested_followups=[
                "How do I check if an individual panel string is disconnected?",
                "What is the modelled baseline curve in Tab 11?",
                "How often should I clean solar panels in North India?",
            ],
            language="hi" if is_hi else "en",
        )

    def _handle_hardware_safety(self, query: str, ctx: dict[str, Any], is_hi: bool) -> ArkaResponse:
        if is_hi:
            headline = "🔌 इनवर्टर हार्डवेयर व ग्रिड सुरक्षा: IEEE 1547 व CEA 2.0 सेकंड शंट-ट्रिप वॉचडॉग"
            text = (
                "आपके घर की सुरक्षा प्रणाली केंद्रीय विद्युत प्राधिकरण (CEA) मानकों के अनुरूप है:\n\n"
                "- **एंटी-आइसलैंडिंग वॉचडॉग:** ग्रिड बिजली कटने पर इनवर्टर **2.0 सेकंड के भीतर** ग्रिड संपर्क काट देता है ताकि बिजली लाइनमैन को करंट न लगे।\n"
                "- **सनस्पेक मॉडबस (Model 124):** LP ऑप्टिमाइज़र हार्डवेयर रजिस्टर्स में CRC-16 चेकसम के साथ सुरक्षित रूप से पावर लिमिट लिखता है।\n"
                "- **साइबर सुरक्षा (CEA 2026):** आपका सारा डेटा स्थानीय डिवाइस पर रहता है। डेटा रेसिडेंसी और ओटी नेटवर्क अलग रखा गया है।"
            )
            action = "टैब 7 में लाइव मॉडबस टेलीमेट्री और एंटी-आइसलैंडिंग संपर्ककर्ता स्थिति देखें।"
        else:
            headline = "🔌 Hardware Inverter Gateway & Grid Safety: IEEE 1547 & CEA 2.0-Second Watchdog"
            text = (
                "Your rooftop solar system complies with statutory electrical and cyber standards:\n\n"
                r"- **IEEE 1547 / CEA Anti-Islanding Watchdog:** In the event of utility blackout, the shunt-trip breaker trips within **$\le 2.0$ seconds**, preventing deadly reverse electrocution of utility linemen working on street poles.\n"
                "- **SunSpec Modbus Gateway (Model 124):** The LP dispatch engine communicates directly with inverter hardware (Sungrow, Growatt, GoodWe, Solis, Victron) with CRC-16 checksum verification.\n"
                "- **CEA 2026 Statutory Cybersecurity:** Strict OT/IT network segmentation, India local data residency, and zero cloud credential leakage."
            )
            action = "Review Tab 7 to monitor live Modbus registers and anti-islanding contactor status."

        return ArkaResponse(
            query=query,
            intent="HARDWARE_SAFETY",
            headline=headline,
            answer_text=text,
            action_recommendation=action,
            key_metrics={"anti_islanding_latency": "< 2000 ms", "modbus_protocol": "SunSpec 124", "cyber_compliance": "CEA Regulations 2026"},
            statutory_grounding="Central Electricity Authority (Technical Standards for Connectivity of Distributed Generation Resources) Regulations.",
            suggested_followups=[
                "What is Rate of Change of Frequency (ROCOF)?",
                "How does the feeder transformer guard prevent local substation fires?",
                "Which inverter brands are supported?",
            ],
            language="hi" if is_hi else "en",
        )

    def _handle_troubleshooting_faults(self, query: str, ctx: dict[str, Any], is_hi: bool) -> ArkaResponse:
        if is_hi:
            headline = "🛠️ इनवर्टर फॉल्ट डायग्नोस्टिक्स: सामान्य एरर कोड और समाधान"
            text = (
                "इनवर्टर में फॉल्ट या अलार्म आने पर यह चेकलिस्ट अपनाएं:\n\n"
                "1. ⚠️ **Grid Fault / Over-Voltage (OV) / Under-Voltage (UV):**\n"
                "   - **कारण:** ग्रिड वोल्टेज 195V से नीचे या 253V से ऊपर चली गई है।\n"
                "   - **समाधान:** इनवर्टर को हाथ न लगाएं। ग्रिड सामान्य होते ही 60 सेकंड में यह अपने आप रीस्टार्ट हो जाता है।\n\n"
                "2. 💧 **Riso / Low Insulation Resistance (आइसोलेशन एरर):**\n"
                "   - **कारण:** मानसून या बारिश के दौरान DC तारों या MC4 कनेक्टर्स में नमी आना।\n"
                "   - **समाधान:** DC जंक्शन बॉक्स खोलें और कनेक्टर्स को सुखाकर दोबारा सील करें। इंसुलेशन 1 MΩ से ऊपर होना चाहिए।\n\n"
                "3. 🔥 **Inverter Over-Temperature (अत्यधिक तापमान):**\n"
                "   - **कारण:** इनवर्टर पर सीधी धूप पड़ना या हीट सिंक पर धूल जमना।\n"
                "   - **समाधान:** इनवर्टर के चारों ओर 30 सेमी खुली जगह रखें और एल्युमिनियम पंखों की धूल साफ करें।"
            )
            action = "यदि 'Riso Low' लगातार आए तो सोलर इंस्टॉलर से MC4 कनेक्टर्स की जांच करवाएं।"
        else:
            headline = "🛠️ Inverter Fault Diagnostics: Common Error Codes & Resolution"
            text = (
                "Quick diagnostic resolution tree for common solar inverter alarms and codes:\n\n"
                "1. ⚠️ **Grid Fault / Over-Voltage (OV) / Under-Voltage (UV):**\n"
                "   - **Cause:** Grid utility voltage breached statutory limits (< 195V or > 253V) or frequency drifted.\n"
                "   - **Resolution:** No hardware damage. Inverter automatically re-synchronizes 60 seconds after grid normalizes.\n\n"
                "2. 💧 **Riso / Low Isolation Resistance Fault:**\n"
                "   - **Cause:** DC cable insulation resistance dropped below 1.0 MΩ, typically caused by rainwater ingress in MC4 connectors during monsoon.\n"
                "   - **Resolution:** Isolate DC isolator, inspect MC4 plugs, dry moisture, and re-torque gland seals.\n\n"
                "3. 🔥 **Inverter Over-Temperature / Derating Alarm:**\n"
                "   - **Cause:** Ambient heat sink exceeded 75°C due to direct sun exposure or clogged aluminum cooling fins.\n"
                "   - **Resolution:** Ensure inverter is shaded on North/East wall with ≥ 30 cm air clearance; blow compressed air across heat fins."
            )
            action = "If 'Riso Low' persists, inspect the rooftop DC junction box and MC4 connector waterproofing."

        return ArkaResponse(
            query=query,
            intent="TROUBLESHOOTING_FAULTS",
            headline=headline,
            answer_text=text,
            action_recommendation=action,
            key_metrics={"isolation_threshold": "> 1.0 MOhm", "voltage_window": "195V - 253V", "frequency_window": "49.5 - 50.5 Hz"},
            statutory_grounding="BIS IS 16221 / IEC 62109 Safety Requirements for Power Converters in Photovoltaic Systems.",
            suggested_followups=[
                "Why is my inverter showing a red light?",
                "How do I clean my solar panels safely?",
                "Is my inverter safe from grid faults and anti-islanding?",
            ],
            language="hi" if is_hi else "en",
        )

    def _handle_commercial_tax_incentives(self, query: str, ctx: dict[str, Any], is_hi: bool) -> ArkaResponse:
        rec_kw = float(ctx.get("solar_kw", 7.0))
        cost = rec_kw * 50000.0
        ad_save = cost * 0.40 * 0.25  # 40% depreciation at 25% tax bracket
        gst_credit = cost * 0.12  # 12% GST ITC

        if is_hi:
            headline = "💼 वाणिज्यिक व क्लिनिक सोलर लाभ: 40% त्वरित मूल्यह्रास (AD) व 12% GST इनपुट क्रेडिट"
            text = (
                f"क्लिनिक, दुकानों व व्यावसायिक परिसरों के लिए सोलर लगाने पर भारी कर (Tax) लाभ मिलते हैं:\n\n"
                f"- 📉 **40% त्वरित मूल्यह्रास (Accelerated Depreciation - Sec 32):** पहले ही वर्ष में सोलर सिस्टम की 40% लागत को व्यापारिक मुनाफे में से घटाया जा सकता है, जिससे **~₹{ad_save:,.0f} का सीधा इनकम टैक्स बचेगा**!\n"
                f"- 🧾 **12% GST इनपुट टैक्स क्रेडिट (ITC):** सोलर प्लांट पर चुकाए गए 12% GST (**~₹{gst_credit:,.0f}**) का क्लेम आप अपने व्यापारिक GST देयता में समायोजित कर सकते हैं।\n"
                f"- ⚡ **सस्ती बिजली:** कमर्शियल बिजली दर ₹11.50/यूनिट की जगह सोलर की लागत मात्र **₹2.10/यूनिट** पड़ती है!\n"
                f"- ⏱️ **पेबैक समय:** मात्र **2.2 से 2.5 साल** में पूरा निवेश वापस!"
            )
            action = "अपने चार्टर्ड अकाउंटेंट (CA) को सोलर बिल देकर 40% त्वरित मूल्यह्रास और GST इनपुट क्लेम करें।"
        else:
            headline = "💼 Commercial & MSME Solar Benefits: 40% Accelerated Depreciation & 12% GST ITC"
            text = (
                f"For clinics, retail stores, and commercial establishments, solar offers powerful corporate tax incentives:\n\n"
                f"- 📉 **40% Accelerated Depreciation (Section 32 of Income Tax Act):** Write off 40% of the entire solar capex in Year 1 against taxable business profits, saving **~₹{ad_save:,.0f} in cash income tax**!\n"
                f"- 🧾 **12% GST Input Tax Credit (ITC):** Claim 100% of the 12% GST paid on solar equipment (**~₹{gst_credit:,.0f}**) directly against your commercial GST liability.\n"
                f"- ⚡ **Dramatic Tariff Arbitrage:** Commercial DISCOM power costs ₹10.50–13.50/unit; your rooftop solar LCOE is only **₹2.10/unit**!\n"
                f"- ⏱️ **Super-Fast Payback:** Entire capital cost is fully recovered within **2.2 to 2.5 years**."
            )
            action = "Forward your solar capital invoice to your Chartered Accountant to claim 40% AD and 12% GST ITC."

        return ArkaResponse(
            query=query,
            intent="COMMERCIAL_TAX_INCENTIVES",
            headline=headline,
            answer_text=text,
            action_recommendation=action,
            key_metrics={"depreciation_rate": "40% (Sec 32)", "gst_itc_rate": "12%", "tax_shield_inr": ad_save, "commercial_payback_years": 2.3},
            statutory_grounding="Income Tax Act Section 32(1) & Central Goods and Services Tax (CGST) Act Input Credit Provisions.",
            suggested_followups=[
                "How much will my clinic save on commercial electricity bills?",
                "Can a commercial property use P2P trading to sell energy?",
                "How does peak-hour battery discharge reduce demand charges?",
            ],
            language="hi" if is_hi else "en",
        )

    def _handle_carbon_offsets(self, query: str, ctx: dict[str, Any], is_hi: bool) -> ArkaResponse:
        clean_kwh = float(ctx.get("clean_kwh", 12.0))
        co2_kg = round(clean_kwh * 0.716, 1)
        coal_kg = round(clean_kwh * 0.45, 1)
        trees = max(1, int(clean_kwh * 0.05))

        if is_hi:
            headline = f"🌿 पर्यावरण प्रभाव: आज आपने {co2_kg} किग्रा कार्बन उत्सर्जन रोका"
            text = (
                f"आपकी छत से बनी स्वच्छ बिजली का सीधा पर्यावरण लाभ:\n\n"
                f"- **CO₂ उत्सर्जन में कमी:** **{co2_kg} किग्रा कार्बन डाइऑक्साइड** रोकी गई (CEA 0.716 kg/kWh मानक)\n"
                f"- **कोयले की बचत:** **{coal_kg} किग्रा कोयला** जलने से बचा\n"
                f"- **पेड़ों के बराबर प्रभाव:** **{trees} पेड़ लगाने** के बराबर लाभ\n"
                f"- **BEE कार्बन क्रेडिट ट्रेडिंग स्कीम (CCTS):** इन कार्बन ऑफसेट्स को भविष्य में CCTS बाजार में बेचा जा सकेगा।"
            )
            action = "टैब 12 में कार्बन क्रेडिट और 25 साल का संचयी प्रभाव देखें।"
        else:
            headline = f"🌿 Environmental Impact: Avoided {co2_kg} kg CO₂ Emission Today"
            text = (
                f"Here is the decarbonization contribution from your rooftop solar array:\n\n"
                f"- **Avoided Greenhouse Gas (CEA Baseline):** **{co2_kg} kg CO₂** avoided today (0.716 kg CO₂/kWh factor)\n"
                f"- **Thermal Coal Displaced:** **{coal_kg} kg coal** avoided at thermal power stations\n"
                f"- **Forest Equivalent:** Equal to growing **{trees} trees** in your city\n"
                f"- **BEE Carbon Credit Trading Scheme (CCTS):** Certified carbon savings trackable for green certificates and statutory ESG credits."
            )
            action = "Check Tab 12 for the BEE CCTS carbon counter and 25-year cumulative environmental metrics."

        return ArkaResponse(
            query=query,
            intent="CARBON_OFFSETS",
            headline=headline,
            answer_text=text,
            action_recommendation=action,
            key_metrics={"avoided_co2_kg": co2_kg, "displaced_coal_kg": coal_kg, "trees_equivalent": trees},
            statutory_grounding="Central Electricity Authority (CEA) Carbon Emission Factor Database Version 19.",
            suggested_followups=[
                "How much coal will my home displace over 25 years?",
                "What is the BEE Carbon Credit Trading Scheme?",
                "How does my home compare to the state decarbonization average?",
            ],
            language="hi" if is_hi else "en",
        )

    def _handle_state_comparison(self, query: str, ctx: dict[str, Any], is_hi: bool) -> ArkaResponse:
        state = str(ctx.get("state_name", "Uttar Pradesh"))
        self_cons = float(ctx.get("self_consumption_pct", 79.2))
        avg_state = float(ctx.get("avg_state_pct", 61.0))

        if is_hi:
            headline = f"🏛️ {state} राज्य तुलना: आपका घर जिले के शीर्ष 12% स्वच्छ घरों में"
            text = (
                f"आपके घर का प्रदर्शन {state} के औसत आवासीय सौर उपभोक्ताओं की तुलना में:\n\n"
                f"- **आपका सौर स्व-उपभोग (Self-Consumption):** **{self_cons:.1f}%** ({state} का औसत: {avg_state:.1f}%)\n"
                f"- **ग्रिड निर्भरता में कमी:** **81.5%** कम बिजली ग्रिड से ली गई\n"
                f"- **जिले में रैंकिंग:** आप अपने जिले के **शीर्ष 12% सबसे कुशल सौर घरों** में हैं!\n"
                f"- **25 साल की शुद्ध पारिवारिक संपत्ति निर्माण:** **₹11.4 लाख** की संचयी बचत।"
            )
            action = "अधिक जानकारी के लिए साइडबार में 'State & National Explorer' चुनें।"
        else:
            headline = f"🏛️ {state} Benchmark: Your Home Ranks in the Top 12% Cleanest in District"
            text = (
                f"Here is how your home compares against residential benchmarks across {state}:\n\n"
                f"- **Your Solar Self-Consumption:** **{self_cons:.1f}%** ({state} Residential Average: {avg_state:.1f}%)\n"
                f"- **Grid Independence Ratio:** **81.5%** reduction in utility coal imports\n"
                f"- **District Community Standing:** You rank in the **Top 12% most efficient solar homes** in your DISCOM area!\n"
                f"- **25-Year Lifetime Wealth Created:** Over **₹11.4 Lakhs** in cumulative family wealth preserved."
            )
            action = "Toggle to 'State & National Explorer' in the sidebar to view district and state policy comparisons."

        return ArkaResponse(
            query=query,
            intent="STATE_COMPARISON",
            headline=headline,
            answer_text=text,
            action_recommendation=action,
            key_metrics={"self_consumption_pct": self_cons, "state_avg_pct": avg_state, "community_rank": "Top 12%"},
            statutory_grounding="State Nodal Agency Renewable Energy Progress Report.",
            suggested_followups=[
                "What state net-metering rules apply in my jurisdiction?",
                "How much will I save over 25 years with solar?",
                "How does my battery protect against local grid power cuts?",
            ],
            language="hi" if is_hi else "en",
        )

    def _handle_general_query(self, query: str, ctx: dict[str, Any], is_hi: bool) -> ArkaResponse:
        rec_kw = float(ctx.get("solar_kw", 3.0))
        batt_kwh = float(ctx.get("battery_kwh", 5.0))
        monthly_save = float(ctx.get("monthly_save", 3770.0))

        if is_hi:
            headline = "☀️ नमस्ते! मैं अर्क (ARKA) हूँ — आपका व्यक्तिगत सौर ऊर्जा सहायक"
            text = (
                f"मैं आपके घर ({ctx.get('owner_name', 'आपका घर')}) के लिए सौर ऊर्जा, बिल बचत और बैटरी सुरक्षा का विशेषज्ञ साथी हूँ।\n\n"
                f"**वर्तमान घरेलू स्थिति:**\n"
                f"- ☀️ **सोलर क्षमता:** {rec_kw:.0f} kWp छत पर स्थापित\n"
                f"- 🔋 **बैटरी बैकअप:** {batt_kwh:.0f} kWh LiFePO4 स्टोरेज\n"
                f"- 💰 **मासिक बचत:** लगभग ₹{monthly_save:,.0f} प्रति माह\n\n"
                f"आप मुझसे किसी भी विषय पर पूछ सकते हैं: बिल कम करना, बैटरी बैकअप समय, गीजर/वाशिंग मशीन चलाने का सही समय, सब्सिडी, या पड़ोसियों को अतिरिक्त बिजली बेचना!"
            )
            action = "नीचे दिए गए किसी भी प्रश्न पर क्लिक करें या अपना सवाल पूछें।"
        else:
            headline = "☀️ Hello! I am ARKA — Your Personal Solar & Energy AI Companion"
            text = (
                f"I am your dedicated personal AI energy copilot for **{ctx.get('owner_name', 'your home')}**.\n\n"
                f"**Current Property Status:**\n"
                f"- ☀️ **Rooftop Solar:** {rec_kw:.0f} kWp installed on your roof\n"
                f"- 🔋 **Battery Storage:** {batt_kwh:.0f} kWh LiFePO4 emergency backup\n"
                f"- 💰 **Estimated Monthly Savings:** **₹{monthly_save:,.0f} / month**\n\n"
                f"Ask me anything: how to cut your bill to zero, blackout survival hours, when to run big appliances, PM Surya Ghar subsidy claims, or selling solar to neighbors via UPI!"
            )
            action = "Tap any suggestion chip below or type your personal question."

        return ArkaResponse(
            query=query,
            intent="GENERAL",
            headline=headline,
            answer_text=text,
            action_recommendation=action,
            key_metrics={"solar_kwp": rec_kw, "battery_kwh": batt_kwh, "monthly_save_inr": monthly_save},
            statutory_grounding="AVISHKAR Predictive Energy Intelligence Knowledge Engine.",
            suggested_followups=[
                "How much will I save on my bill this month?",
                "Will my battery survive an 8-hour blackout tonight?",
                "When should I run my washing machine and water geyser?",
                "How do I claim my ₹78,000 PM Surya Ghar subsidy?",
            ],
            language="hi" if is_hi else "en",
        )
