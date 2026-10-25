# Phase 21: Repository Baseline & Architecture Audit
**UrjaSetu Energy Management & Intelligence System**
*Evaluation Date: October 24, 2026 | Technical Acceptance Owner & Architecture Review*

---

## 1. Executive Summary

This repository audit establishes the verified baseline of the UrjaSetu EMS codebase prior to final acceptance and integration sign-off. UrjaSetu EMS combines statutory Indian national and state power sector intelligence with household-level prosumer analytics, digital twin scenario modeling, authoritative electricity tariff validation, and an evidence-grounded AI Copilot.

---

## 2. Git & Workspace Baseline

- **Repository**: `AVISHKAR-`
- **Active Working Branch**: `claude/avishkar-fixes-and-platform`
- **Repository Remote**: `origin/claude/avishkar-fixes-and-platform`
- **Operating System**: Windows NT (x86_64)
- **Local Runtime**: Python 3.12.10 (virtual environment: `.venv/Scripts/python.exe`), Node.js v20.18.0 / pnpm 9.15.0
- **Git State**: Clean of merge conflicts. Uncommitted working files preserved. Vendored `src/emhass/` strictly untouched.

---

## 3. Repository Architecture & Layout

```
AVISHKAR-/
├── src/
│   ├── avishkar_ems/                  # Core Python Energy Intelligence Platform (Phases 1-21)
│   │   ├── trust/                     # Canonical observation schemas, source registry, quality validators
│   │   │   ├── connectors/            # CEA, NPP, Karnataka, AP, Open-Meteo, NASA POWER connectors
│   │   │   ├── canonical_observation.py
│   │   │   ├── data_quality.py
│   │   │   ├── geo_integrity.py
│   │   │   ├── idempotent_ingestion.py
│   │   │   ├── source_registry.py
│   │   │   └── unit_validation.py
│   │   ├── ai_copilot.py              # Evidence-grounded Copilot & prompt defense
│   │   ├── citizen_portal.py          # Public indicators, citizen reporting & moderation
│   │   ├── command_center_service.py  # Unified executive dashboard service
│   │   ├── digital_twin.py            # Calibrated digital twins & scenario simulation
│   │   ├── energy_balance.py          # CEA power supply position & gap accounting
│   │   ├── event_monitoring.py        # Real-time event detection, alerts & deduplication
│   │   ├── forecasting_engine.py      # Statistical & machine-learning demand forecasting
│   │   ├── generation_mix.py          # Renewable vs thermal fuel dispatch analysis
│   │   ├── geo_explorer.py            # Geographic hierarchy & anti-disaggregation
│   │   ├── health_center.py           # Data-source health observability & liveness
│   │   ├── household_module.py        # Multi-tenant profile inventory & isolation
│   │   ├── household_import.py        # Utility bill & AMR interval reading parser
│   │   ├── policy_intelligence.py     # PM Surya Ghar, KERC, NDC targets & amendments
│   │   ├── recommendations.py         # Multi-factor ranked energy conservation rules
│   │   ├── solar_intel.py             # Rooftop PV yield, insolation & degradation
│   │   └── tariff_intelligence.py     # Gazetted tariff schedules, slabs & reconciliation
│   └── emhass/                        # Vendored upstream code (strictly preserved, untouched)
├── app/
│   ├── dashboard.py                   # Streamlit launcher with UrjaSetu tab dispatch
│   └── urjasetu_view.py               # Complete 19-tab Streamlit user interface
├── data/
│   ├── energy_reports/                # Canonical CEA, NPP, and state report datasets
│   ├── policy/                        # Net metering and solar subsidy rules
│   └── tariffs/                       # Gazetted SERC tariff schedule definitions
├── docs/                              # Architecture, workflows, and phase audits
├── platform/                          # High-performance Next.js + TypeScript platform
└── tests/
    └── avishkar_ems/                  # Comprehensive pytest test suite (418+ tests)
```

---

## 4. Package Managers & Environment Configuration

### Python EMS Runtime
- **Package Manager**: `pip` with pinned virtual environment dependencies in `pyproject.toml`.
- **Core Dependencies**: `pandas`, `numpy`, `scipy`, `scikit-learn`, `requests`, `streamlit`, `pytest`, `ruff`.
- **Environment Template**: `.env.example` provides configurable DISCOM endpoints, weather API keys, and secret masks.

### Platform Engine Runtime
- **Package Manager**: `pnpm` (workspace layout under `platform/`).
- **Core Packages**: `platform/engine` (Python simulation engine), `platform/api` (Fastify / TypeScript microservices), `platform/web` (Next.js 15 UI with Leaflet basemaps).

---

## 5. Security & Isolation Architecture

1. **Multi-Tenant Household Isolation**: Profile and bill access checks are server-enforced in Python domain services (`HouseholdManager.get_home()`, `TariffIntelligenceService.validate_property_bill()`, `PolicyIntelligenceService.assess_household_eligibility()`). Cross-household lookups raise `PermissionError`.
2. **PII Scrubbing & Account Masking**: Connection identifiers are hashed and masked (`BES...1029`). Citizen reports scrub emails, names, and phone numbers.
3. **Anti-Injection Guards**:
   - AI Copilot rejects prompt injection and privilege escalation patterns.
   - Command Center CSV exports escape `=, +, -, @, \t, \r` to prevent spreadsheet formula execution.
   - File upload utilities validate extensions against allowlists (`.txt`, `.csv`, `.xlsx`, `.json`) and reject path traversal attempts.

---

## 6. Baseline Test & Build Status

| Component | Test Command | Result | Pass Rate |
|:---|:---|:---:|:---:|
| **Full Python EMS Suite** | `python -m pytest tests/avishkar_ems -q` | 406 passed, 2 skipped | 100% |
| **Phases 10-21 Suite** | `python -m pytest tests/avishkar_ems/test_phase1*.py tests/avishkar_ems/test_phase2*.py -q` | 144 passed | 100% |
| **Phase 21 Integration Suite** | `python -m pytest tests/avishkar_ems/test_phase21_integration_acceptance.py -v` | 12 passed | 100% |
| **Platform Engine Suite** | `python -m pytest platform/engine/tests -q` | 414 passed | 100% |
| **Python Code Linter** | `python -m ruff check tests/avishkar_ems/test_phase21_integration_acceptance.py --no-fix` | 0 errors | Clean |
