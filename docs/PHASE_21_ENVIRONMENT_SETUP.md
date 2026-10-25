# Phase 21: Environment Setup & External Integration Guide
**UrjaSetu Energy Management & Intelligence System**
*Evaluation Date: October 24, 2026 | Technical Acceptance Owner & DevOps Engineer*

---

## 1. System Requirements

### Host Environment
- **Operating System**: Windows 10/11, Ubuntu 22.04 LTS, or macOS 14+
- **Python Runtime**: Python 3.12+ (tested on Python 3.12.10)
- **Node.js Runtime**: Node.js v20.18+ (tested with pnpm 9.15+)
- **Memory**: Minimum 4 GB RAM (8 GB recommended for Streamlit and Next.js dev servers)
- **Storage**: Minimum 2 GB free disk space for cache and report datasets

---

## 2. Environment Variables Specification

The platform operates safely out-of-the-box using bundled verified datasets (`data/energy_reports/`, `data/tariffs/`). Optional external connectors can be configured in `.env`:

| Variable Name | Required? | Default / Standby Behavior | Purpose |
|:---|:---:|:---|:---|
| `URJASETU_ENV` | Optional | `development` | Runtime environment (`development`, `staging`, `production`). |
| `STREAMLIT_SERVER_PORT` | Optional | `8501` | Local port for Streamlit energy dashboard. |
| `CEA_REPORT_CACHE_DIR` | Optional | `data/energy_reports` | Filesystem cache path for official CEA and NPP monthly bulletins. |
| `OPEN_METEO_API_KEY` | Optional | Public open endpoint | Hourly solar irradiance and temperature telemetry. |
| `NASA_POWER_USER` | Optional | Public open endpoint | Multi-year monthly solar insolation benchmarks. |
| `BESCOM_MITHRA_API_KEY` | Optional | Offline fixture mode | Consumer billing statements and AMR interval data for BESCOM. |
| `APEPDCL_API_KEY` | Optional | Offline fixture mode | Consumer billing statements for APEPDCL. |
| `COPILOT_LLM_PROVIDER` | Optional | `deterministic` | Provider for AI Copilot (`deterministic`, `gemini`, `openai`). |
| `GEMINI_API_KEY` | Optional | Redacted fallback mode | API key for Gemini LLM; fallback generates deterministic grounded answers. |

*Security Guarantee*: Secret keys are masked in memory and never logged to stdout or serialized in test artifacts.

---

## 3. Step-by-Step Installation & Verification

### Step 1: Clone & Initialize Python Virtual Environment
```bash
# Verify Python version
python --version  # Must be 3.12+

# Activate virtual environment
# Windows PowerShell:
.\.venv\Scripts\Activate.ps1
# Linux/macOS:
source .venv/bin/activate

# Install dependencies
pip install -e .
```

### Step 2: Validate Data Integrity & Health Readiness
```bash
# Execute Phase 21 integration acceptance test suite
python -m pytest tests/avishkar_ems/test_phase21_integration_acceptance.py -v

# Execute complete Phases 10-21 functional test suite
python -m pytest tests/avishkar_ems/test_phase10_operations.py tests/avishkar_ems/test_phase11_connectors.py tests/avishkar_ems/test_phase12_command_center.py tests/avishkar_ems/test_phase13_recommendations.py tests/avishkar_ems/test_phase14_data_science_lab.py tests/avishkar_ems/test_phase15_citizen_portal.py tests/avishkar_ems/test_phase16_copilot.py tests/avishkar_ems/test_phase17_digital_twin.py tests/avishkar_ems/test_phase18_event_monitoring.py tests/avishkar_ems/test_phase19_policy_intelligence.py tests/avishkar_ems/test_phase20_tariff_intelligence.py tests/avishkar_ems/test_phase21_integration_acceptance.py -q
```

### Step 3: Run Code Quality Checks
```bash
# Verify no lint or formatting errors
python -m ruff check tests/avishkar_ems/test_phase21_integration_acceptance.py --no-fix
```

### Step 4: Launch the Streamlit Energy Management Dashboard
```bash
streamlit run app/dashboard.py
```
*Access in browser*: `http://localhost:8501`

---

## 4. Fallback Modes for Unavailable External Services

1. **DISCOM Gateway Partner APIs**:
   - When utility credentials are not configured, the platform operates in **Offline Statement Import Mode**. Users can upload utility bills (.pdf, .txt, .csv) or select pre-seeded verified household profiles (Indiranagar Residence, Waltair Villa).
2. **AI LLM APIs (Gemini/OpenAI)**:
   - When no external LLM API key is present, the AI Energy Copilot automatically executes internal **Deterministic Domain Engines**. It calculates bills, extracts PM Surya Ghar subsidies, and evaluates tariffs directly in Python, returning grounded responses without third-party network calls.
3. **Live Weather & SCADA Feeders**:
   - The platform uses local caching (`data/energy_reports/`) to maintain 100% functionality during internet disconnections or upstream portal maintenance.
