"""Battery sizing advice: what each battery size earns, what backup it gives, and whether the bill savings alone repay it.

The EMS is replayed on sampled days of the site's own data for several battery sizes. The battery price per kWh is an
ASSUMPTION you should replace with a real quote.
"""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pandas as pd

from avishkar_ems.payback import evaluate

BATTERY_INR_PER_KWH = 25_000.0  # an ASSUMPTION: replace with a real quote


def battery_advice(site, df, pv_model, load_model, test_days, sizes_kwh=(0.0, 2.5, 5.0, 10.0, 15.0),
                   battery_inr_per_kwh: float = BATTERY_INR_PER_KWH) -> pd.DataFrame:
    rows = []
    for kwh in sizes_kwh:
        s = replace(site, battery_kwh=max(kwh, 0.01), battery_kw=max(min(site.battery_kw, kwh / 2 or 0.01), 0.01))
        t = evaluate(s, df, pv_model, load_model, test_days, with_hindsight=False, with_replan=False).payback_table()
        rows.append({"battery_kwh": kwh, "benefit_inr_year": t.loc["EMS", "annual_benefit_inr"],
                     "unserved_critical_kwh": t.loc["EMS", "unserved_critical_kwh"],
                     "backup_hours": kwh * site.dod * site.one_way_eff / max(site.critical_kw, 1e-6)})
    out = pd.DataFrame(rows).set_index("battery_kwh")
    out["extra_benefit_inr_year"] = out["benefit_inr_year"] - out.loc[0.0, "benefit_inr_year"]
    out["battery_cost_inr"] = out.index * battery_inr_per_kwh
    out["years_to_repay_from_bills"] = (out["battery_cost_inr"] / out["extra_benefit_inr_year"].where(out["extra_benefit_inr_year"] > 0)).round(1)
    out.loc[out["years_to_repay_from_bills"] > 30, "years_to_repay_from_bills"] = np.nan  # longer than a battery lasts
    return out.round(1)


def advise_text(table: pd.DataFrame, wanted_backup_hours: float, lang: str = "en") -> str:
    ok = table[table["backup_hours"] >= wanted_backup_hours]
    pick = ok.index.min() if len(ok) else None
    if pick is None:
        return ("No size in this list gives the backup hours you asked for. Try a bigger battery or a smaller critical load."
                if lang == "en" else "इस सूची में कोई बैटरी आपके माँगे गए बैकअप घंटे नहीं देती। बड़ी बैटरी या कम ज़रूरी लोड आज़माएँ।")
    r = table.loc[pick]
    yrs = r["years_to_repay_from_bills"]
    never, long_ = pd.isna(yrs), pd.isna(yrs) or yrs > 10
    if lang == "hi":
        if never:
            return (f"{pick:g} kWh की बैटरी आपके {wanted_backup_hours:g} घंटे के बैकअप के लिए काफ़ी है। सिर्फ़ बिजली बिल की बचत से "
                    "उसकी कीमत कभी नहीं लौटेगी, इसलिए इसे बैकअप के लिए खरीदें, बचत के लिए नहीं।")
        if long_:
            return (f"{pick:g} kWh की बैटरी आपके {wanted_backup_hours:g} घंटे के बैकअप के लिए काफ़ी है। सिर्फ़ बिजली बिल की बचत से "
                    f"उसकी कीमत लौटने में लगभग {yrs:.0f} साल लगेंगे, इसलिए इसे बैकअप के लिए खरीदें, बचत के लिए नहीं।")
        return f"{pick:g} kWh की बैटरी आपके बैकअप के लिए काफ़ी है और बिल की बचत से लगभग {yrs:.0f} साल में अपनी कीमत निकाल लेगी।"
    head = f"A {pick:g} kWh battery is the smallest that gives your {wanted_backup_hours:g} hours of backup."
    if never:
        return f"{head} Bill savings alone would never repay it, so buy it for backup, not for savings."
    if long_:
        return f"{head} Bill savings alone would repay it in {yrs:.0f} years, so buy it for backup, not for savings."
    return f"{head} Bill savings alone repay it in about {yrs:.0f} years."
