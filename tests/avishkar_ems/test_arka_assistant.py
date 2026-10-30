"""Tests for ARKA — Personal AI Solar & Energy Intelligence Assistant."""

import pytest

from avishkar_ems.arka_assistant import ArkaPersonalAssistant, ArkaResponse


@pytest.fixture
def arka() -> ArkaPersonalAssistant:
    return ArkaPersonalAssistant()


@pytest.fixture
def sample_context() -> dict:
    return {
        "owner_name": "Sharma Niwas (Mathura Residence)",
        "home_type": "3-BHK Independent Villa",
        "location": "Krishna Nagar, Mathura, Uttar Pradesh",
        "discom": "DVVNL",
        "solar_kw": 3.0,
        "battery_kwh": 5.0,
        "soc": 0.85,
        "backup_hours": 6.5,
        "pre_bill": 4250.0,
        "cur_bill": 480.0,
        "monthly_save": 3770.0,
        "clean_kwh": 14.5,
        "state_name": "Uttar Pradesh",
        # What the dashboard now passes: this site's own computed figures. No state average, because
        # AVISHKAR holds no sourced one (see tests/avishkar_ems/test_no_invented_figures.py).
        "self_consumption_pct": 79.2,
        "annual_save": 15529.0,
    }


def test_arka_initialization(arka: ArkaPersonalAssistant):
    assert arka.agent_name == "ARKA (अर्क)"
    assert arka.version == "2.0-Personal"


def test_arka_subsidy_and_sizing_scenario(arka: ArkaPersonalAssistant, sample_context: dict):
    resp = arka.answer_query("How much subsidy do I get under PM Surya Ghar and what size do I need?", sample_context)
    assert isinstance(resp, ArkaResponse)
    assert resp.intent == "SUBSIDY_SIZING"
    assert "₹78,000" in resp.headline or "₹78,000" in resp.answer_text
    assert "pmsuryaghar.gov.in" in resp.answer_text
    assert resp.key_metrics["subsidy_inr"] == 78000.0
    assert resp.key_metrics["recommended_kwp"] == 3.0
    assert len(resp.suggested_followups) >= 2


def test_arka_bill_savings_scenario(arka: ArkaPersonalAssistant, sample_context: dict):
    resp = arka.answer_query("How much money will I save on my electricity bill every month?", sample_context)
    assert resp.intent == "BILL_SAVINGS"
    assert "₹3,770" in resp.headline or "₹3,770" in resp.answer_text
    assert "₹4,250" in resp.answer_text
    assert "₹480" in resp.answer_text
    assert resp.key_metrics["monthly_save"] == 3770.0


def test_arka_battery_blackout_scenario(arka: ArkaPersonalAssistant, sample_context: dict):
    resp = arka.answer_query("Will my battery survive an 8-hour blackout tonight?", sample_context)
    assert resp.intent == "BATTERY_BLACKOUT"
    assert "kWh" in resp.headline
    assert "LED" in resp.answer_text
    assert "Wi-Fi" in resp.answer_text
    assert "Refrigerator" in resp.answer_text
    assert resp.key_metrics["battery_soc"] == 0.85
    assert resp.key_metrics["usable_kwh"] > 0


def test_arka_appliance_scheduling_scenario(arka: ArkaPersonalAssistant, sample_context: dict):
    resp = arka.answer_query("When should I run my washing machine and water geyser?", sample_context)
    assert resp.intent == "APPLIANCE_TIMING"
    assert "11:00 AM" in resp.headline or "11:30 AM" in resp.answer_text
    assert "Geyser" in resp.answer_text
    assert "Washing Machine" in resp.answer_text
    assert "FREE" in resp.answer_text or "free" in resp.answer_text


def test_arka_ev_v2h_scenario(arka: ArkaPersonalAssistant, sample_context: dict):
    resp = arka.answer_query("Can I charge my EV scooter with free solar and use V2H in the evening?", sample_context)
    assert resp.intent == "EV_V2H"
    assert "V2H" in resp.headline
    assert "Commute Range" in resp.answer_text or "commute" in resp.answer_text
    assert resp.key_metrics["commute_reserve_km"] == 120


def test_arka_p2p_trading_and_upi_scenario(arka: ArkaPersonalAssistant, sample_context: dict):
    resp = arka.answer_query("How do I sell surplus solar to neighbors and receive UPI payments?", sample_context)
    assert resp.intent == "P2P_TRADING_UPI"
    assert "Beckn DEG" in resp.answer_text
    assert "UPI" in resp.answer_text
    assert "₹6.80" in str(resp.key_metrics.get("p2p_clearing_price_inr", ""))


def test_arka_panel_cleaning_and_dust_scenario(arka: ArkaPersonalAssistant, sample_context: dict):
    resp = arka.answer_query("Why is my generation lower? Do my rooftop solar panels need cleaning?", sample_context)
    assert resp.intent == "PANEL_CLEANING_DUST"
    assert "8.5%" in resp.answer_text or "8.5%" in str(resp.key_metrics)
    assert "8:00 AM" in resp.answer_text
    assert "₹675" in resp.answer_text or "₹675" in str(resp.key_metrics)


def test_arka_hardware_and_islanding_safety_scenario(arka: ArkaPersonalAssistant, sample_context: dict):
    resp = arka.answer_query("Is my inverter safe from grid faults and anti-islanding?", sample_context)
    assert resp.intent == "HARDWARE_SAFETY"
    assert "IEEE 1547" in resp.headline or "IEEE 1547" in resp.answer_text
    assert "Modbus" in resp.answer_text
    assert "< 2000 ms" in resp.key_metrics["anti_islanding_latency"]


def test_arka_carbon_and_ccts_scenario(arka: ArkaPersonalAssistant, sample_context: dict):
    resp = arka.answer_query("How many carbon credits and trees has my home solar saved?", sample_context)
    assert resp.intent == "CARBON_OFFSETS"
    assert "CO₂" in resp.headline or "CO2" in resp.headline or "CO₂" in resp.answer_text
    assert "0.716" in resp.answer_text
    assert resp.key_metrics["avoided_co2_kg"] > 0


def test_arka_state_benchmark_scenario(arka: ArkaPersonalAssistant, sample_context: dict):
    """Asked to compare the home against its state, ARKA reports the home's own figures and refuses to rank it.

    This test used to assert the opposite: that the reply contained "79.2%" and that `community_rank` held
    "Top 12%". Both were constants written into the reply, alongside an 81.5% "reduction in utility coal
    imports" and INR 11.4 lakh of "family wealth", none of which had a source. The test was locking in the
    invention, so it has been rewritten along with the handler.
    """
    resp = arka.answer_query("How does my home compare to the average solar home in Uttar Pradesh?", sample_context)
    assert resp.intent == "STATE_COMPARISON"
    assert "Uttar Pradesh" in resp.headline or "Uttar Pradesh" in resp.answer_text

    # It reports what it was given about this home, computed elsewhere from the replay.
    assert "79.2%" in resp.answer_text  # the caller's own figure, passed in through the context
    assert "15,529" in resp.answer_text  # the replay's annual benefit

    # And it says plainly that there is nothing to compare against, rather than inventing one.
    assert "holds no sourced residential average" in resp.answer_text
    assert "invention" in resp.answer_text
    assert resp.key_metrics["state_average_pct"] is None
    assert resp.key_metrics["community_rank"] is None
    assert "Top 12%" not in resp.answer_text


def test_arka_state_benchmark_says_what_it_does_not_know(arka: ArkaPersonalAssistant):
    """With no figures in the context at all, it says so instead of falling back to a plausible number."""
    resp = arka.answer_query("How does my home compare to the state average?", {"state_name": "Rajasthan"})
    assert resp.intent == "STATE_COMPARISON"
    assert resp.answer_text.count("not known") >= 2
    assert resp.key_metrics["self_consumption_pct"] is None
    assert resp.key_metrics["annual_benefit_inr"] is None


def test_arka_state_benchmark_refuses_to_rank_in_hindi_too(arka: ArkaPersonalAssistant, sample_context: dict):
    """Strings shown to people come in English/Hindi pairs, and so must the refusal to invent a benchmark.

    The question is put in English because the intent classifier matches on English keywords only
    (`compare|benchmark|state average|district|<state name>`); a Hindi phrasing of the same question falls
    through to the general handler. That is a pre-existing limit of the classifier, not of this reply, and it is
    noted here so the next reader does not mistake one for the other. `lang="hi"` is what selects the Hindi text.
    """
    resp = arka.answer_query("How does my home compare to the state average?", sample_context, lang="hi")
    assert resp.intent == "STATE_COMPARISON"
    assert resp.language == "hi"
    assert "AVISHKAR के पास नहीं है" in resp.answer_text
    assert "शीर्ष 12%" not in resp.answer_text


def test_arka_hindi_multilingual_response(arka: ArkaPersonalAssistant, sample_context: dict):
    resp = arka.answer_query("मुझे कितनी बिजली बचत होगी और वाशिंग मशीन कब चलाऊं?", sample_context, lang="hi")
    assert resp.language == "hi"
    assert ("बचत" in resp.answer_text or "उपकरण" in resp.answer_text or "रुपये" in resp.answer_text or "नमस्ते" in resp.answer_text)


def test_arka_rooftop_engineering_scenario(arka: ArkaPersonalAssistant, sample_context: dict):
    resp = arka.answer_query("How much roof area do I need and what is the optimal tilt angle for my panels?", sample_context)
    assert resp.intent == "ROOFTOP_ENGINEERING"
    assert "300 sq.ft" in resp.headline or "300 sq.ft" in resp.answer_text
    assert "27°" in resp.answer_text or "27°" in resp.headline
    assert "TOPCon" in resp.answer_text
    assert resp.key_metrics["required_roof_sqft"] == 300
    assert resp.key_metrics["tilt_degrees"] == 27


def test_arka_troubleshooting_faults_scenario(arka: ArkaPersonalAssistant, sample_context: dict):
    resp = arka.answer_query("Why is my inverter showing a red light and Riso isolation fault?", sample_context)
    assert resp.intent == "TROUBLESHOOTING_FAULTS"
    assert "Riso" in resp.answer_text
    assert "MC4" in resp.answer_text
    assert "1.0 MΩ" in resp.answer_text or "> 1.0 MOhm" in str(resp.key_metrics.get("isolation_threshold"))


def test_arka_commercial_tax_incentives_scenario(arka: ArkaPersonalAssistant, sample_context: dict):
    resp = arka.answer_query("What accelerated depreciation and tax benefits does a clinic get under Section 32?", sample_context)
    assert resp.intent == "COMMERCIAL_TAX_INCENTIVES"
    assert "Accelerated Depreciation" in resp.headline or "Accelerated Depreciation" in resp.answer_text
    assert "Section 32" in resp.answer_text
    assert "12% GST" in resp.answer_text or "12%" in str(resp.key_metrics.get("gst_itc_rate"))
    assert resp.key_metrics["depreciation_rate"] == "40% (Sec 32)"


def test_arka_sbi_solar_loan_scenario(arka: ArkaPersonalAssistant, sample_context: dict):
    resp = arka.answer_query("Can I get an SBI Surya Ghar solar loan and what is the EMI?", sample_context)
    assert resp.intent == "SUBSIDY_SIZING"
    assert "7.00%" in resp.answer_text
    assert "EMI" in resp.headline or "EMI" in resp.answer_text
    assert "SBI" in resp.answer_text
    assert resp.key_metrics["monthly_emi_inr"] > 0


def test_arka_monsoon_and_clouds_scenario(arka: ArkaPersonalAssistant, sample_context: dict):
    resp = arka.answer_query("Will my solar panels work during rainy season and monsoon clouds?", sample_context)
    assert resp.intent == "MONSOON_RAIN_CLOUDS"
    assert "20–30%" in resp.headline or "20-30%" in resp.headline or "20% to 30%" in resp.answer_text
    assert "Reserve" in resp.headline or "रिजर्व" in resp.headline
    assert resp.key_metrics["monsoon_reserve_floor_pct"] == 70


def test_arka_lightning_and_earthing_scenario(arka: ArkaPersonalAssistant, sample_context: dict):
    resp = arka.answer_query("Do I need earthing pits and a lightning arrester for my rooftop solar?", sample_context)
    assert resp.intent == "LIGHTNING_EARTHING_SAFETY"
    assert "Earthing" in resp.headline or "अर्थिंग" in resp.headline
    assert "< 5 Ω" in resp.headline or "< 5.0 Ω" in resp.answer_text or "< 5" in resp.answer_text
    assert resp.key_metrics["chemical_pits_count"] == 3


def test_arka_net_metering_discom_sla_scenario(arka: ArkaPersonalAssistant, sample_context: dict):
    resp = arka.answer_query("Why is my DISCOM delaying my net meter installation and what is the SLA?", sample_context)
    assert resp.intent == "NET_METERING_DISCOM"
    assert "15-Day" in resp.headline or "15 दिन" in resp.headline
    assert "₹500" in resp.answer_text
    assert resp.key_metrics["statutory_delay_penalty_per_day"] == 500.0


def test_arka_warranties_and_insurance_scenario(arka: ArkaPersonalAssistant, sample_context: dict):
    resp = arka.answer_query("What warranties and insurance protect my solar panels and inverter?", sample_context)
    assert resp.intent == "WARRANTIES_INSURANCE"
    assert "25-Year" in resp.headline or "25 साल" in resp.headline
    assert "84.8" in resp.answer_text
    assert resp.key_metrics["panel_warranty_years"] == 25
    assert resp.key_metrics["yr25_guaranteed_output_pct"] == 84.8


def test_arka_virtual_net_metering_apartments_scenario(arka: ArkaPersonalAssistant, sample_context: dict):
    resp = arka.answer_query("Can tenants and apartment societies install solar under virtual net metering?", sample_context)
    assert resp.intent == "TENANTS_APARTMENTS"
    assert "Virtual Net Metering" in resp.headline or "VNM" in resp.headline or "वर्चुअल" in resp.headline
    assert "₹18,000" in resp.answer_text
    assert resp.key_metrics["rwa_subsidy_per_kwp_inr"] == 18000.0



