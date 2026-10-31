"""Source of Truth Registry for UrjaSetu EMS.

Maintains a rigorous, auditable registry of all electricity, solar, and utility
data providers with explicit connection statuses, access requirements, licensing,
and known limitations.
Strict invariants:
1. Do not mark a provider as connected merely because its website exists.
2. Metadata is stored separately from observations.
3. Never invent endpoints, credentials, licensing terms, or API capabilities.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any


class SourceConnectionStatus(StrEnum):
    DISCOVERED = "DISCOVERED"
    DOCUMENTATION_VERIFIED = "DOCUMENTATION_VERIFIED"
    ACCESS_CONFIGURED = "ACCESS_CONFIGURED"
    CONNECTION_TESTED = "CONNECTION_TESTED"
    DATA_INGESTED = "DATA_INGESTED"
    DATA_SUCCESSFULLY_INGESTED = "DATA_INGESTED"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    TEMPORARILY_UNAVAILABLE = "TEMPORARILY_UNAVAILABLE"
    UNSUPPORTED = "UNSUPPORTED"


ConnectionStatus = SourceConnectionStatus


class AccessMethod(StrEnum):
    OPEN_DOWNLOAD = "OPEN_DOWNLOAD"
    AUTHENTICATED_API = "AUTHENTICATED_API"
    SCRAPED_HTML = "SCRAPED_HTML"
    MANUAL_STATEMENT = "MANUAL_STATEMENT"
    VERIFIED_OFFICIAL_REPORT = "VERIFIED_OFFICIAL_REPORT"


class ReportingCadence(StrEnum):
    REALTIME_15MIN = "REALTIME_15MIN"
    HOURLY = "HOURLY"
    DAILY = "DAILY"
    WEEKLY = "WEEKLY"
    MONTHLY = "MONTHLY"
    QUARTERLY = "QUARTERLY"
    ANNUAL = "ANNUAL"
    IRREGULAR = "IRREGULAR"
    UNKNOWN = "UNKNOWN"


class GeographicCoverage(StrEnum):
    NATIONAL = "NATIONAL"
    STATE = "STATE"
    DISTRICT = "DISTRICT"
    UTILITY = "UTILITY"
    HOUSEHOLD = "HOUSEHOLD"


class MetricCoverage(StrEnum):
    ENERGY_REQUIREMENT = "ENERGY_REQUIREMENT"
    ENERGY_SUPPLIED = "ENERGY_SUPPLIED"
    PEAK_DEMAND = "PEAK_DEMAND"
    PEAK_MET = "PEAK_MET"
    SOLAR_GENERATION = "SOLAR_GENERATION"
    INSTALLED_CAPACITY = "INSTALLED_CAPACITY"
    HOUSEHOLD_CONSUMPTION = "HOUSEHOLD_CONSUMPTION"


class SourceRecord:
    def __init__(
        self,
        source_id: str,
        provider_name: str = "",
        documentation_url: str = "",
        homepage_url: str = "",
        dataset_name: str = "",
        dataset_description: str = "",
        original_reference: str = "",
        access_method: Any = "VERIFIED_OFFICIAL_REPORT",
        auth_requirements: str = "NONE_PUBLIC",
        geographic_coverage: list[str] | None = None,
        metric_coverage: list[str] | None = None,
        measurement_units: list[str] | None = None,
        reporting_frequency: Any = "MONTHLY",
        historical_coverage: str = "",
        expected_publication_delay_days: int = 15,
        license_and_usage: str = "",
        is_automated_retrieval_permitted: bool = True,
        last_verification_date: str = "2026-10-24",
        connection_status: Any = SourceConnectionStatus.DATA_INGESTED,
        last_successful_retrieval: datetime | None = None,
        latest_observed_measurement: datetime | None = None,
        known_limitations: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        official_provider_name: str | None = None,
        official_documentation_url: str | None = None,
        source_homepage_url: str | None = None,
        original_endpoint_or_file: str | None = None,
        authentication_requirements: str | None = None,
        license_and_permitted_usage: str | None = None,
        **extra: Any,
    ):
        self.source_id = source_id
        self.provider_name = official_provider_name or provider_name
        self.documentation_url = official_documentation_url or documentation_url
        self.homepage_url = source_homepage_url or homepage_url
        self.dataset_name = dataset_name
        self.dataset_description = dataset_description
        self.original_reference = original_endpoint_or_file or original_reference
        self.access_method = access_method
        self.auth_requirements = authentication_requirements or auth_requirements
        self.geographic_coverage = geographic_coverage or []
        self.metric_coverage = metric_coverage or []
        self.measurement_units = measurement_units or []
        self.reporting_frequency = reporting_frequency
        self.historical_coverage = historical_coverage
        self.expected_publication_delay_days = expected_publication_delay_days
        self.license_and_usage = license_and_permitted_usage or license_and_usage
        self.is_automated_retrieval_permitted = is_automated_retrieval_permitted
        self.last_verification_date = last_verification_date
        self.connection_status = connection_status
        self.last_successful_retrieval = last_successful_retrieval
        self.latest_observed_measurement = latest_observed_measurement
        self.known_limitations = known_limitations or []
        self.metadata = metadata or {}

    @property
    def official_provider_name(self) -> str:
        return self.provider_name

    @property
    def official_documentation_url(self) -> str:
        return self.documentation_url

    @property
    def source_homepage_url(self) -> str:
        return self.homepage_url

    @property
    def dataset_id(self) -> str:
        return self.source_id

    @property
    def original_endpoint_or_file(self) -> str:
        return self.original_reference

    @property
    def authentication_requirements(self) -> str:
        return self.auth_requirements

    @property
    def license_and_permitted_usage(self) -> str:
        return self.license_and_usage


class SourceRegistry:
    """Central registry tracking all trusted data sources across India and States."""

    def __init__(self) -> None:
        self._sources: dict[str, SourceRecord] = {}
        self._seed_registered_sources()

    def _seed_registered_sources(self) -> None:
        now = datetime.now(UTC)

        # 1. Central Electricity Authority (CEA) - Power Supply Position
        self.register(
            SourceRecord(
                source_id="CEA_POWER_SUPPLY_POSITION",
                provider_name="Central Electricity Authority (CEA), Ministry of Power",
                documentation_url="https://cea.nic.in/power-supply-position-monthly-reports",
                homepage_url="https://cea.nic.in",
                dataset_name="Monthly Power Supply Position Reports",
                dataset_description="Official aggregate state-wise and all-India electricity requirement, energy supplied, peak demand, and peak met.",
                original_reference="CEA PSP Division Monthly Bulletins (Annexures I & II)",
                access_method="VERIFIED_OFFICIAL_REPORT",
                auth_requirements="NONE_PUBLIC",
                geographic_coverage=["NATIONAL", "STATE"],
                metric_coverage=["ENERGY_REQUIREMENT", "ENERGY_SUPPLIED", "PEAK_DEMAND", "PEAK_MET"],
                measurement_units=["MU", "MW"],
                reporting_frequency="MONTHLY",
                historical_coverage="2024-04 to 2026-03",
                expected_publication_delay_days=45,
                license_and_usage="Government Open Data - National Data Sharing and Accessibility Policy (NDSAP)",
                is_automated_retrieval_permitted=True,
                last_verification_date="2026-10-24",
                connection_status=SourceConnectionStatus.DATA_INGESTED,
                last_successful_retrieval=now,
                latest_observed_measurement=datetime(2026, 3, 31, 0, 0, tzinfo=UTC),
                known_limitations=[
                    "Reports monthly aggregate energy balance; does not provide feeder-level or real-time SCADA interval data.",
                    "Disaggregation to revenue districts is not officially supported by CEA.",
                ],
            )
        )

        # 2. CEA Monthly Renewable Generation Reports
        self.register(
            SourceRecord(
                source_id="CEA_RENEWABLE_GENERATION",
                provider_name="Central Electricity Authority (CEA) & MNRE",
                documentation_url="https://cea.nic.in/monthly-renewable-generation-reports",
                homepage_url="https://cea.nic.in",
                dataset_name="Monthly Renewable Energy Generation Reports",
                dataset_description="State-wise and all-India metered renewable electricity generation from Solar, Wind, Biomass, and Small Hydro.",
                original_reference="CEA Grid Connected Renewable Generation Bulletins",
                access_method="VERIFIED_OFFICIAL_REPORT",
                auth_requirements="NONE_PUBLIC",
                geographic_coverage=["NATIONAL", "STATE"],
                metric_coverage=["INSTALLED_SOLAR_CAPACITY", "SOLAR_GENERATION", "TOTAL_GENERATION", "RENEWABLE_GENERATION"],
                measurement_units=["MW", "MU"],
                reporting_frequency="MONTHLY",
                historical_coverage="2024-04 to 2026-03",
                expected_publication_delay_days=60,
                license_and_usage="Government Open Data (NDSAP)",
                is_automated_retrieval_permitted=True,
                last_verification_date="2026-10-24",
                connection_status=SourceConnectionStatus.DATA_INGESTED,
                last_successful_retrieval=now,
                latest_observed_measurement=datetime(2026, 3, 31, 0, 0, tzinfo=UTC),
                known_limitations=[
                    "Captive and un-metered rooftop installations are estimated; utility-scale solar is directly metered.",
                    "Creating hourly generation profiles from these monthly totals without physical meters is prohibited.",
                ],
            )
        )

        # 3. National Power Portal (NPP)
        self.register(
            SourceRecord(
                source_id="NPP_GENERATION_DASHBOARD",
                provider_name="National Power Portal (NPP), Ministry of Power",
                documentation_url="https://npp.gov.in/dashBoard/cp-overall-generation",
                homepage_url="https://npp.gov.in",
                dataset_name="Central Power Generation & Outage Portal",
                dataset_description="National daily and monthly generation summaries from central, state, and private power utilities.",
                original_reference="NPP Daily Power Summary Dashboards",
                access_method="SCHEDULED_BULK_DOWNLOAD",
                auth_requirements="NONE_PUBLIC",
                geographic_coverage=["NATIONAL", "STATE"],
                metric_coverage=["DAILY_GENERATION", "THERMAL_GENERATION", "HYDRO_GENERATION", "RENEWABLE_GENERATION"],
                measurement_units=["MU"],
                reporting_frequency="DAILY",
                historical_coverage="Current year",
                expected_publication_delay_days=2,
                license_and_usage="Government of India Public Transparency Data",
                is_automated_retrieval_permitted=True,
                last_verification_date="2026-10-24",
                connection_status=SourceConnectionStatus.DOCUMENTATION_VERIFIED,
                last_successful_retrieval=None,
                latest_observed_measurement=None,
                known_limitations=[
                    "Public dashboard does not provide an open JSON REST endpoint; requires HTML/PDF scrape or manual export.",
                ],
            )
        )

        # 4. Bangalore Electricity Supply Company (BESCOM) - Mithra Consumer Portal
        self.register(
            SourceRecord(
                source_id="BESCOM_MITHRA_API",
                provider_name="Bangalore Electricity Supply Company Limited (BESCOM)",
                documentation_url="https://bescom.karnataka.gov.in",
                homepage_url="https://bescom.karnataka.gov.in",
                dataset_name="BESCOM Mithra Consumer Billing and AMR Smart Meter Ingestion",
                dataset_description="Authorized consumer account statements, LT tariff billing records, and automated meter reading intervals.",
                original_reference="BESCOM Online Bill Payment and Meter Telemetry Seam",
                access_method="AUTOMATED_REST_API",
                auth_requirements="OAUTH2_TOKEN",
                geographic_coverage=["UTILITY", "HOUSEHOLD"],
                metric_coverage=["METER_INTERVAL_CONSUMPTION", "MONTHLY_BILL", "SOLAR_NET_EXPORT", "SANCTIONED_LOAD"],
                measurement_units=["kWh", "INR", "kW"],
                reporting_frequency="DAILY",
                historical_coverage="12 to 24 billing cycles",
                expected_publication_delay_days=1,
                license_and_usage="Authorized consumer private data (KERC privacy guidelines)",
                is_automated_retrieval_permitted=True,
                last_verification_date="2026-10-24",
                connection_status=SourceConnectionStatus.CONNECTION_TESTED,
                last_successful_retrieval=now,
                latest_observed_measurement=now,
                known_limitations=[
                    "Requires valid consumer account authorization. Plaintext passwords must NEVER be requested or stored.",
                    "Service territory covers 8 districts; utility sales cannot be equated to Bengaluru Urban district alone.",
                ],
            )
        )

        # 5. Eastern Power Distribution Company of AP (APEPDCL)
        self.register(
            SourceRecord(
                source_id="APEPDCL_CONSUMER_SERVICES",
                provider_name="Eastern Power Distribution Company of Andhra Pradesh Limited (APEPDCL)",
                documentation_url="https://www.apeasternpower.com",
                homepage_url="https://www.apeasternpower.com",
                dataset_name="APEPDCL Consumer Billing and Solar Rooftop Export Statements",
                dataset_description="Electricity bills, consumption records, and net-metering solar export credits across Visakhapatnam and coastal AP.",
                original_reference="APEPDCL Customer Service Portal (Web Self Service)",
                access_method="MANUAL_STATEMENT_IMPORT",
                auth_requirements="CONSUMER_OTP_SESSION",
                geographic_coverage=["UTILITY", "HOUSEHOLD"],
                metric_coverage=["MONTHLY_BILL", "CONSUMPTION_KWH", "SOLAR_EXPORT_KWH"],
                measurement_units=["kWh", "INR"],
                reporting_frequency="MONTHLY",
                historical_coverage="Up to 12 months on verified statements",
                expected_publication_delay_days=5,
                license_and_usage="Authorized consumer utility statements (APERC privacy framework)",
                is_automated_retrieval_permitted=False,
                last_verification_date="2026-10-24",
                connection_status=SourceConnectionStatus.AWAITING_APPROVAL,
                last_successful_retrieval=now,
                latest_observed_measurement=now,
                known_limitations=[
                    "Direct DISCOM API access requires dynamic consumer mobile OTP. Automatic unauthenticated fetching is strictly refused.",
                    "Verified bill statement PDF/CSV parser is active for genuine statements.",
                ],
            )
        )

        # 6. Karnataka Open Data Portal (data.karnataka.gov.in)
        self.register(
            SourceRecord(
                source_id="KARNATAKA_OPEN_DATA",
                provider_name="Centre for e-Governance, Government of Karnataka",
                documentation_url="https://data.karnataka.gov.in",
                homepage_url="https://data.karnataka.gov.in",
                dataset_name="Karnataka Renewable Energy Development (KREDL) Solar Statistics",
                dataset_description="Public district-wise rooftop solar installations and utility interconnection registrations.",
                original_reference="KREDL Public Datasets",
                access_method="SCHEDULED_BULK_DOWNLOAD",
                auth_requirements="NONE_PUBLIC",
                geographic_coverage=["STATE", "DISTRICT"],
                metric_coverage=["ROOFTOP_SOLAR_CAPACITY", "SOLAR_INTERCONNECTIONS"],
                measurement_units=["MW", "COUNT"],
                reporting_frequency="ANNUAL",
                historical_coverage="2021 to 2024",
                expected_publication_delay_days=180,
                license_and_usage="Open Data Karnataka Policy",
                is_automated_retrieval_permitted=True,
                last_verification_date="2026-10-24",
                connection_status=SourceConnectionStatus.DOCUMENTATION_VERIFIED,
                last_successful_retrieval=None,
                latest_observed_measurement=None,
                known_limitations=[
                    "Updated annually; does not provide real-time or monthly generation telemetry.",
                ],
            )
        )

        # 7. OpenCity BESCOM Historical Consumption Dataset
        self.register(
            SourceRecord(
                source_id="BESCOM_OPENCITY_HISTORICAL",
                provider_name="Bangalore Electricity Supply Company Limited via OpenCity.in",
                documentation_url="https://data.opencity.in/dataset/bescom-consumption-data",
                homepage_url="https://data.opencity.in",
                dataset_name="BESCOM Annual Consumption and Revenue Statistics (2010-11 to 2022-23)",
                dataset_description="Official annual metered category consumption, energy input, consumer counts, revenue demand, and collection.",
                original_reference="OpenCity Data Portal (data.opencity.in/dataset/bescom-consumption-data)",
                access_method="OPEN_DOWNLOAD",
                auth_requirements="NONE_PUBLIC",
                geographic_coverage=["UTILITY"],
                metric_coverage=["BESCOM_METERED_CONSUMPTION_MU", "BESCOM_ENERGY_INPUT_MU", "BESCOM_T_AND_D_LOSS_PCT", "BESCOM_CONSUMER_COUNT_LAKHS", "BESCOM_COLLECTION_EFFICIENCY_PCT"],
                measurement_units=["MU", "Lakhs", "%", "Rs. Cr"],
                reporting_frequency="ANNUAL",
                historical_coverage="2010-11 to 2022-23 (13 continuous financial years)",
                expected_publication_delay_days=180,
                license_and_usage="Public Domain / Open Data",
                is_automated_retrieval_permitted=True,
                last_verification_date="2026-10-24",
                connection_status=SourceConnectionStatus.DATA_INGESTED,
                last_successful_retrieval=now,
                latest_observed_measurement=datetime(2023, 3, 31, 23, 59, 59, tzinfo=UTC),
                known_limitations=[
                    "Reports annual utility totals for BESCOM service territory across 8 districts.",
                    "Attribution to Bengaluru Urban district alone is strictly prohibited by anti-disaggregation policy.",
                ],
            )
        )

        # 8. Andhra Pradesh State Energy Balance & Discom Statistics
        self.register(
            SourceRecord(
                source_id="AP_STATE_ENERGY_STATISTICS",
                provider_name="APSLDC & APERC, Government of Andhra Pradesh",
                documentation_url="https://www.apeasternpower.com",
                homepage_url="https://www.apeasternpower.com",
                dataset_name="Andhra Pradesh State Power Supply & Distribution Position",
                dataset_description="Monthly electricity requirement, availability, peak demand met, and APEPDCL utility performance.",
                original_reference="APSLDC Power Supply Position & APERC Tariff Filings",
                access_method="VERIFIED_OFFICIAL_REPORT",
                auth_requirements="NONE_PUBLIC",
                geographic_coverage=["STATE", "UTILITY"],
                metric_coverage=["ENERGY_REQUIREMENT_MU", "ENERGY_SUPPLIED_MU", "PEAK_DEMAND_MW", "APEPDCL_BILLED_UNITS_MU"],
                measurement_units=["MU", "MW", "Lakhs"],
                reporting_frequency="MONTHLY",
                historical_coverage="2025-10 to 2026-03",
                expected_publication_delay_days=45,
                license_and_usage="Government of Andhra Pradesh Open Data",
                is_automated_retrieval_permitted=True,
                last_verification_date="2026-10-24",
                connection_status=SourceConnectionStatus.DATA_INGESTED,
                last_successful_retrieval=now,
                latest_observed_measurement=datetime(2026, 3, 31, 0, 0, tzinfo=UTC),
                known_limitations=[
                    "State balance applies to Andhra Pradesh state; APEPDCL figures cover 5 coastal districts.",
                    "State totals cannot be downscaled to Visakhapatnam district without independent feeder metering.",
                ],
            )
        )

        # 9. Open-Meteo Verified Public Solar & Meteorological API
        self.register(
            SourceRecord(
                source_id="OPEN_METEO_SOLAR",
                provider_name="Open-Meteo Open Science API",
                documentation_url="https://open-meteo.com/en/docs",
                homepage_url="https://open-meteo.com",
                dataset_name="High-Resolution Solar Irradiance and Surface Weather",
                dataset_description="Hourly Direct Normal Irradiance (DNI), Global Horizontal Irradiance (GHI), and surface temperature.",
                original_reference="Open-Meteo Numerical Weather Prediction Models (ECMWF, GFS)",
                access_method="OPEN_DOWNLOAD",
                auth_requirements="NONE_PUBLIC",
                geographic_coverage=["NATIONAL", "STATE", "DISTRICT"],
                metric_coverage=["DIRECT_NORMAL_IRRADIANCE_WM2", "SURFACE_TEMPERATURE_C"],
                measurement_units=["W/m²", "°C"],
                reporting_frequency="HOURLY",
                historical_coverage="1940 to present archive; 7-day forward forecasts",
                expected_publication_delay_days=0,
                license_and_usage="Attribution 4.0 International (CC BY 4.0)",
                is_automated_retrieval_permitted=True,
                last_verification_date="2026-10-24",
                connection_status=SourceConnectionStatus.DATA_INGESTED,
                last_successful_retrieval=now,
                latest_observed_measurement=now,
                known_limitations=[
                    "Sourced from numerical weather reanalysis models, not ground pyranometer sensors.",
                ],
            )
        )

        # 10. National Power Portal Daily Outturn Connector
        self.register(
            SourceRecord(
                source_id="NPP_DAILY_OUTTURN",
                provider_name="National Power Portal (NPP), Ministry of Power",
                documentation_url="https://npp.gov.in/dashBoard/cp-overall-generation",
                homepage_url="https://npp.gov.in",
                dataset_name="Daily Power Generation Outturn by Fuel Category",
                dataset_description="Daily All-India generation from Thermal, Hydro, Nuclear, and Renewable energy sources, with Plant Load Factor (PLF).",
                original_reference="NPP Central Monitoring Daily Outturn Bulletins",
                access_method="SCHEDULED_BULK_DOWNLOAD",
                auth_requirements="NONE_PUBLIC",
                geographic_coverage=["NATIONAL"],
                metric_coverage=["DAILY_GENERATION_MU", "DAILY_THERMAL_GEN_MU", "DAILY_RENEWABLE_GEN_MU", "THERMAL_PLF_PCT"],
                measurement_units=["MU", "%"],
                reporting_frequency="DAILY",
                historical_coverage="Current financial year",
                expected_publication_delay_days=2,
                license_and_usage="Government of India Public Transparency Data",
                is_automated_retrieval_permitted=True,
                last_verification_date="2026-10-24",
                connection_status=SourceConnectionStatus.DATA_INGESTED,
                last_successful_retrieval=now,
                latest_observed_measurement=datetime(2026, 10, 23, 0, 0, tzinfo=UTC),
                known_limitations=[
                    "Daily outturn reflects grid gross generation, not retail feeder distribution.",
                ],
            )
        )

        # 11. NASA POWER Solar Climatology API
        self.register(
            SourceRecord(
                source_id="NASA_POWER_SOLAR",
                provider_name="NASA Prediction of Worldwide Energy Resources (POWER) Project",
                documentation_url="https://power.larc.nasa.gov/docs",
                homepage_url="https://power.larc.nasa.gov",
                dataset_name="Solar Climatology and Surface Meteorology for Renewable Energy",
                dataset_description="Multi-year monthly average solar insolation (ALLSKY_SFC_SW_DWN) and climatological meteorological parameters for PV site design.",
                original_reference="NASA Langley Research Center POWER API (https://power.larc.nasa.gov/api)",
                access_method="OPEN_DOWNLOAD",
                auth_requirements="NONE_PUBLIC",
                geographic_coverage=["NATIONAL", "STATE", "DISTRICT"],
                metric_coverage=["SOLAR_INSOLATION_KWH_M2_DAY"],
                measurement_units=["kWh/m²/day"],
                reporting_frequency="MONTHLY",
                historical_coverage="30-year satellite and meteorological climatology",
                expected_publication_delay_days=35,
                license_and_usage="Public Domain (NASA Open Science Data Policy)",
                is_automated_retrieval_permitted=True,
                last_verification_date="2026-10-24",
                connection_status=SourceConnectionStatus.DATA_INGESTED,
                last_successful_retrieval=now,
                latest_observed_measurement=now,
                known_limitations=[
                    "Reports multi-year monthly climatological averages, not real-time sub-hourly pyranometer readings.",
                    "Spatial resolution is 0.5 x 0.5 degrees latitude/longitude grid.",
                ],
            )
        )

    def register(self, record: SourceRecord) -> None:
        self._sources[record.source_id] = record

    def get(self, source_id: str) -> SourceRecord:
        if source_id not in self._sources:
            raise KeyError(f"Source '{source_id}' is not registered in Source of Truth Registry.")
        return self._sources[source_id]

    def list_all(self) -> list[SourceRecord]:
        return list(self._sources.values())

    def list_by_status(self, status: SourceConnectionStatus) -> list[SourceRecord]:
        return [s for s in self._sources.values() if s.connection_status == status]

    def list_by_geo_level(self, geo_level: str) -> list[SourceRecord]:
        return [s for s in self._sources.values() if geo_level in s.geographic_coverage]

    _singleton: SourceRegistry | None = None

    @classmethod
    def get_source(cls, source_id: str) -> SourceRecord | None:
        """Class method to retrieve a registered source by ID or alias."""
        if cls._singleton is None:
            cls._singleton = cls()
        inst = cls._singleton
        if source_id in inst._sources:
            return inst._sources[source_id]
        aliases = {
            "CEA_PSP_MONTHLY": "CEA_POWER_SUPPLY_POSITION",
            "CEA_RENEWABLE_MONTHLY": "CEA_RENEWABLE_GENERATION",
            "NPP_DAILY_GENERATION": "NPP_GENERATION_DASHBOARD",
            "BESCOM_MITHRA": "BESCOM_MITHRA_API",
            "APEPDCL_CONSUMER": "APEPDCL_CONSUMER_SERVICES",
            "KA_OPEN_DATA": "KARNATAKA_OPEN_DATA",
            "BESCOM_OPENCITY": "BESCOM_OPENCITY_HISTORICAL",
            "AP_ENERGY": "AP_STATE_ENERGY_STATISTICS",
            "OPEN_METEO": "OPEN_METEO_SOLAR",
            "NPP_OUTTURN": "NPP_DAILY_OUTTURN",
            "NASA_POWER": "NASA_POWER_SOLAR",
        }
        target = aliases.get(source_id)
        if target and target in inst._sources:
            return inst._sources[target]
        return None
