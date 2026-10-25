# UrjaSetu EMS Phase 18: Operational Runbook & Alert Response Guide

## 1. Daily Operations & Routine Monitoring

### 1.1 Alert Queue Inspection
1. Navigate to Streamlit UI **Tab 16: "🔔 16. Event Monitoring & Alert Management"**.
2. Review top KPI metrics:
   - If **Critical Alerts > 0**: Prioritize immediate investigation of safety or severe load overdraw conditions.
   - If **Dispatched Notifications** shows failures: Inspect the Outbox ledger for dead-lettered messages.
3. Use the Filter bar to isolate alerts by `OPEN` status or `CRITICAL` severity.

---

## 2. Standard Operating Procedures (SOPs)

### SOP-01: Responding to a Consumption Spike Alert (`RULE-EVT-SPIKE-01`)
1. Open the alert drawer in Tab 16.
2. Note the observed interval consumption (kWh) and percentage deviation.
3. Click **"👁️ Acknowledge"** to notify team that an investigation has started.
4. Navigate to **Tab 10: "🏡 Household Monitoring"** and cross-reference appliance schedules.
5. If the spike is verified as legitimate (e.g. EV fast charging or heavy AC usage during a heatwave):
   - Enter a resolution note: *"Verified consumer EV charging session."*
   - Click **"✅ Resolve"**.
6. If the reading is spurious or meter malfunction is suspected:
   - Transition to `IN_PROGRESS` and flag for DISCOM AMR meter calibration.

### SOP-02: Handling Dead-Lettered Notifications (`PERMANENTLY_FAILED`)
1. Review the Outbox table at the bottom of Tab 16.
2. Locate notifications with status `PERMANENTLY_FAILED`.
3. Check the `Last Error Summary`:
   - If error is `HTTP 503 Gateway Timeout`: Verify remote provider status.
   - If error is `Retry exhausted`: Inspect provider network route.
4. Click **"🔄 Retry"** once connectivity has been restored.
