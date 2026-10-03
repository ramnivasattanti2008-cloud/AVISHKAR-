"""Plain-language summary of a day's plan for a householder, in English and Hindi."""

from __future__ import annotations

from avishkar_ems.demo import DayView

_T = {
    "en": {
        "risk": {"low": "a low chance of a power cut", "mid": "a real chance of a power cut",
                 "high": "a high chance of a power cut"},
        "line": ("Tomorrow there is {risk}. Your battery will keep at least {floor:.0%} charge so that essential "
                 "appliances run for {hours:.0f} hours if the power goes. Your panels should make about {pv:.1f} units "
                 "and your home should use about {load:.1f} units. {offers}"),
        "offers_n": "We expect to sell about {kwh:.1f} units to neighbours in {n} time slot(s).",
        "offers_0": "No safe surplus to sell to neighbours, so nothing is promised to anyone.",
    },
    "hi": {
        "risk": {"low": "बिजली कटने की संभावना कम है", "mid": "बिजली कटने की अच्छी-खासी संभावना है",
                 "high": "बिजली कटने की संभावना अधिक है"},
        "line": ("कल {risk}। बैटरी में कम से कम {floor:.0%} चार्ज रखा जाएगा ताकि बिजली जाने पर ज़रूरी उपकरण "
                 "{hours:.0f} घंटे चल सकें। आपके पैनल लगभग {pv:.1f} यूनिट बनाएँगे और घर में लगभग {load:.1f} यूनिट "
                 "खर्च होगी। {offers}"),
        "offers_n": "हम पड़ोसियों को लगभग {kwh:.1f} यूनिट {n} समय-खंड में बेचने की उम्मीद करते हैं।",
        "offers_0": "पड़ोसियों को बेचने लायक सुरक्षित अतिरिक्त बिजली नहीं है, इसलिए किसी से कोई वादा नहीं किया गया।",
    },
}


def plain_summary(dv: DayView, site_backup_hours: float, lang: str = "en") -> str:
    t = _T[lang]
    r = dv.reserve.risk
    level = "low" if r < 0.15 else "mid" if r < 0.4 else "high"
    s = dv.plan.steps
    offers = (t["offers_n"].format(kwh=sum(o.quantity_kwh for o in dv.offers), n=len(dv.offers))
              if dv.offers else t["offers_0"])
    return t["line"].format(risk=t["risk"][level], floor=dv.reserve.floor_soc, hours=site_backup_hours,
                            pv=float(s["pv_p50"].sum() * 0.25), load=float(s["load_p50"].sum() * 0.25), offers=offers)
