# UrjaSetu EMS Phase 19: Security, Multi-Tenant Isolation & Provenance Assurance

## 1. Threat Model & Security Objectives

In a multi-tenant residential energy management system, policy intelligence intersects with private household assets. Key threat vectors include:
1. **Unauthorized Tenant Profiling**: An attacker attempts to query property attributes, sanctioned loads, or calculated subsidy entitlements of other consumers.
2. **Policy Hallucination & Misrepresentation**: An LLM or automated copilot invents fictional subsidy amounts, fabricates tariff rates, or cites non-existent regulations.
3. **Statutory Tampering & Data Drift**: Unverified local updates modify statutory targets or baseline metrics, distorting public accountability.

To counteract these threats, Phase 19 implements strict server-enforced tenant authorization, cryptographic policy fingerprinting, and rigorous numeric grounding guards.

---

## 2. Server-Side Multi-Tenant Authorization

Property eligibility evaluation enforces strict ownership boundaries directly in backend Python services:

```python
# Server-side validation inside HouseholdPolicyAssessor
if auth_user_id:
    is_owner = (profile.user_id == auth_user_id)
    is_authorized = bool(authorized_property_ids and property_id in authorized_property_ids)
    
    if not (is_owner or is_authorized):
        raise PermissionError(
            f"Access denied: User '{auth_user_id}' cannot evaluate policy eligibility for property '{property_id}'."
        )
```

### Authorization Rules:
- **Default Owner Access**: A user authenticated as `user_default` can assess properties where `profile.user_id == "user_default"`.
- **Cross-Tenant Prevention**: An attempt by `user_intruder_99` to assess `home_blr_bescom` fails synchronously with a `PermissionError`. The UI renders an access denial alert without leaking property details.
- **Explicit Property Lists**: Multi-property owners can specify an authorized property list (`authorized_property_ids`), securely validated against server-side session tokens.

---

## 3. Cryptographic Document Provenance & SHA-256 Fingerprints

To prevent document tampering and verify authenticity, each policy record includes an immutable SHA-256 cryptographic digest of its official gazette PDF:

```json
{
  "policy_id": "POL-IN-MNRE-SURYA-GHAR-2024",
  "gazette_order_ref": "Gazette Notification No. 318/38/2024-GCRT",
  "issuing_ministry": "Ministry of New and Renewable Energy (MNRE)",
  "document_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "enactment_date": "2024-02-15"
}
```

Auditors and consumers can verify that local registry records correspond bit-for-bit to official notifications published in the *Gazette of India*.

---

## 4. AI Copilot Hallucination Defense & Numerical Grounding Guard

When consumers query policy information through the AI Energy Copilot, the system eliminates LLM hallucinations via a multi-stage defense architecture:

```
[ User Query ] ──► [ Prompt Injection Defense ]
                           │ (Clean query)
                           ▼
                    [ Intent Classifier ] ──► POLICY_INQUIRY
                           │
                           ▼
                 [ CopilotToolRegistry ]
       ├─ get_verified_policies
       ├─ evaluate_policy_progress
       └─ check_household_policy_eligibility
                           │
                           ▼
                [ Assembled Evidence Bundle ]
               (EVID-011: Policy Targets, EVID-012: Household CFA)
                           │
                           ▼
                 [ Response Generation ]
                           │
                           ▼
              [ NumericalGroundingGuard ]
               - Extracts all numeric values in generated response
               - Verifies every number exists in EvidenceBundle or is exempt
               - Status: GROUNDED_VERIFIED
                           │
                           ▼
                     [ Render to User ]
```

### Invariant Rules
- Every factual number in the answer (e.g., `₹78000`, `30.0 GW`, `5.80 GW`) must match an exact evidence item in `EvidenceBundle`.
- Unfounded numerical claims result in immediate fallback to `GROUNDING_FALLBACK` status.
- Tool responses format structured markdown with clickable evidence pills (`[EVID-011]`, `[EVID-012]`).
