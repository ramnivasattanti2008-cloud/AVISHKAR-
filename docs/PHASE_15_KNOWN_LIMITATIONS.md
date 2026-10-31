# Phase 15: Known Limitations & Future Roadmap

## 1. Geographic Granularity Limitations

1. **State-Level vs. District-Level Direct Telemetry**:
   - Central Electricity Authority (CEA) monthly power supply position reports aggregate energy requirement (MU), energy supplied (MU), and peak demand (MW) at the **National and State levels** only.
   - Revenue districts (e.g. Bengaluru Urban, Hubballi-Dharwad, Visakhapatnam) do not have independent statutory monthly balance filings published by CEA.
   - *Design Boundary*: UrjaSetu EMS strictly refuses to synthesize or downscale state figures across districts using proportional population heuristics. When district telemetry is unavailable, the system transparently indicates that direct district monitoring is pending primary local DISCOM integration.

2. **Utility Territory vs. Administrative Boundary Divergence**:
   - Electricity distribution companies (DISCOMs like BESCOM, HESCOM, APEPDCL) operate on operational circles and feeders that do not align identically with revenue district boundaries. Cross-referencing utility data with municipal census wards requires specialized spatial boundary reconciliation.

---

## 2. Citizen Reporting Boundaries

1. **Unverified User Observations vs. Statutory Facts**:
   - Every citizen report logged in the portal carries `is_verified_fact = False`.
   - Even when a report is transitioned to `ACCEPTED_FOR_PUBLICATION` by an authorized moderator, it represents a **moderated community observation**, not an official regulatory audit finding or legal proof of service failure.

2. **External DISCOM Ticket Dispatch**:
   - The Citizen Energy Portal moderates and aggregates community observations internally.
   - It **does not automatically lodge legal consumer court grievances or push directly to DISCOM SCADA/1912 ticketing endpoints** unless a formal utility MOU and authenticated API gateway are commissioned.

---

## 3. Infrastructure & Storage Considerations

1. **In-Memory Rate Limiting**:
   - The sliding-window rate limiter (5 submissions per hour per user/IP) operates in server memory. In multi-node horizontal deployments, distributed rate-limiting via Redis or Memcached is recommended.
2. **File Sandboxing & Antivirus**:
   - Evidence file upload validates file size (max 5 MB), allowed file extensions (`.jpg`, `.jpeg`, `.png`, `.pdf`, `.csv`, `.txt`), and magic byte headers (`\xff\xd8\xff`, `\x89PNG`, `%PDF-`).
   - Deep dynamic sandbox execution and malware behavioral scanning require external enterprise AV engine integration (e.g., ClamAV).

---

## 4. Future Roadmap

1. **DISCOM 1912 Consumer Grievance Integration**: Direct webhook bridging to state electricity regulatory commission (SERC) and DISCOM consumer dispute redressal forums.
2. **Geospatial Hex-Bin Outage Clustering**: H3 spatial indexing for crowd-sourced outage clustering without revealing exact user coordinates.
3. **Automated Optical Character Recognition (OCR)**: Server-side validation of uploaded public outage notices and utility circulars.
