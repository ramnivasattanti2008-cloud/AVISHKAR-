# Open-source reuse audit, 2026-10-31

Five repositories were cloned, their licences read at the commit cloned, and their source inspected to
decide what AVISHKAR should actually reuse. This file records the decision and the reason for each. The
components that were reused are tabulated in
[OPEN_SOURCE_INTEGRATION_MAP.md](OPEN_SOURCE_INTEGRATION_MAP.md).

AVISHKAR is **MIT** (`LICENSE`), so MIT, BSD and Apache-2.0 upstreams may be copied in with their
notices; a GPL or AGPL upstream could not be, and would have had to be a separate process. In the event,
all five are permissive, so licensing blocked nothing.

## What was acquired

Cloned into `/tmp/oss-research` (outside the repository). GitHub's REST API answers HTTP 403 through this
container's proxy, so `git clone` was used; the commit of each clone is recorded below and is the commit
every line reference in this audit and in the integration map refers to.

| Repository | Commit cloned | Licence at that commit | Language | Size |
|---|---|---|---|---|
| `davidusb-geek/emhass` | `f1e99c58716d4af72eab1afabe8de9cb316ad7ad` | MIT | Python | 30 MB |
| `traktore-org/sem-community` | `067c8615a36fbad2cc912a005f63525038093b07` | MIT | Python (1,177 files) | 69 MB |
| `evcc-io/evcc` | `e2240501caa2c3aae1ce021528cde75997427ca1` | MIT | Go (1,373) + Vue (373) | 30 MB |
| `lbsanto/SolarFlow` | `cde543e5d3013c79c997259f600de5d9ff7cbfc4` | Apache-2.0 | JavaScript (18 files) | 4.4 MB |
| `jirihelmich/smart-energy-manager` | `56ff9cea865a3d556150fd73e779315ce0f81da1` | MIT | Python (43 files) | 1.2 MB |

## EMHASS — already reused, in full

**Decision: no change. It is already vendored.** `src/emhass/` is upstream EMHASS, unmodified, at commit
`237d0fe4089f76ff5f8bbcae24876e64008e60ad`, with its MIT licence kept as the repository's own `LICENSE`
and the whole arrangement recorded in `NOTICE.md`. The planner (`src/avishkar_ems/planner.py`) builds an
EMHASS configuration and calls into it; the reserve floor is applied as EMHASS's battery minimum SoC, so
it is a hard constraint inside the optimiser rather than a clamp afterwards.

This is the largest piece of source-level reuse in the project and it predates this session. Upstream has
moved on (the clone is `f1e99c5`), but re-vendoring is not free: `results/*.csv`, the README's numbers and
the dashboard cache are all fingerprinted against the vendored code, and `planner._base_params` raises
`KeyError` on a configuration key EMHASS has renamed, which is how a version mismatch announces itself.
Re-vendoring is a deliberate exercise with its own regeneration pass, not a side effect of this work, and
is listed in the next actions rather than done here.

## SEM (`sem-community`) — reused at source level

**Decision: vendor seven pure functions verbatim. Done.**

SEM is a Home Assistant integration, so most of it is coupled to `hass`, config entries and coordinator
lifecycles that AVISHKAR has none of. But `coordinator/surplus_controller.py` keeps its hard arithmetic in
**module-level pure functions** — floats in, float out, no HA imports — and that arithmetic is the part of
a surplus controller that is genuinely difficult. Its docstrings cite the upstream issues and the user
reports that produced each rule:

- a controller allocating from `grid_export` alone chases its own tail, because its own loads suppress
  the signal it reads. The fix adds the loads' draw back, reconstructing the surplus that would exist
  with them off;
- surplus must be clamped to the generation, or a load running off the **battery** at night reads as
  surplus and the controller keeps it running on the pack (`#620`, reported by @onkelfu);
- the same clamp has to bound the whole pool rather than one addend, or a battery charging from the grid
  on the inverter's own time-of-use window funds a "solar only" load at 01:29 with the sun at 0 W
  (`#938`, reported by alexmc1510 with timestamps);
- a zero-export inverter holds a small import **deliberately** (Victron ESS, +50 W), so a naive "import
  means no surplus" rule stops every load. Hence a 100 W deadband;
- an EV charger's own grid draw must not be charged against the household loads' pool, or a 3 kW boiler
  cycles against a steady import (`#1102`, @lostcontrol);
- a price signal may damp the pool but must never inflate it, or "solar only" quietly means "grid in
  every cheap hour" (`#953`).

AVISHKAR computed surplus as `generation - demand` and had none of this. Reimplementing it would have
meant rediscovering six field failures. **Not** vendored: `tier1_battery_reserved_w`,
`surplus_reserved_w`, `grid_top_up_defers_to_sun`, `compute_load_intent` and the `SurplusController`
class, all of which need SEM's `ControllableDevice` and its HA lifecycle.

Verified by running **four of upstream's own test classes, 24 tests, verbatim against AVISHKAR's copy**.

## evcc — not reusable as source; convention adopted, with that said plainly

**Decision: no code imported. Reason: language, not licence.**

evcc is MIT, so copying would be permitted. It is 1,373 Go files and a Vue front end, and AVISHKAR is
Python and TypeScript, so there is no in-process reuse to be had. The three remaining options were each
weighed and rejected for this session:

- **As a service.** evcc runs as its own daemon with a REST and MQTT API, and that is the right way to
  use it — but its purpose is to *drive real chargers*. No charger, inverter or vehicle exists anywhere in
  this project's reach, so standing up evcc here would add a daemon that could only talk to simulated
  devices, which is worse than not having it: it would imply hardware integration that has never been
  tested. Recorded as the recommended path for whoever first attaches real hardware.
- **Transliterating its loadpoint logic.** Possible, and it is where AVISHKAR's charging modes and
  hysteresis idea come from, but a hand port of Go control code with no hardware to verify it against is
  an imitation with extra steps, and the previous docstring already showed where that leads.

What was done instead is a correction: `surplus_engine.py` claimed to synthesise evcc (and SEM, EMHASS,
SolarFlow and four others) when it was written from scratch. Its docstring now says which parts are
AVISHKAR's own, that the charging-mode names follow evcc's public convention, and that none of evcc's
code is present. `NOTICE.md` says the same.

## SolarFlow — not reusable

**Decision: nothing imported.**

`lbsanto/SolarFlow` is Apache-2.0 and would have been usable. It is a **Node-RED flow bundle** — 18
JavaScript files, most of it in `dist`, plus deploy scripts for Windows, macOS and Linux — for driving
Zendure SolarFlow hardware over MQTT. There is no library to call and no algorithm separable from the
Node-RED runtime and the specific hardware. The previous docstring cited it for "battery
state-of-charge hard protective bounds"; SoC bounds are four comparisons and owe it nothing.

## smart-energy-manager — inspected, nothing reused

**Decision: nothing imported.** See the note in the integration map for what it contains and why.

## Licence obligations now carried

| Obligation | Where it is met |
|---|---|
| SEM's MIT notice and copyright | `src/avishkar_ems/vendor/LICENSES/sem-community-MIT.txt`, the module docstring, `NOTICE.md` |
| Identify the vendored code as modified or not | Module docstring states the bodies are byte-identical and lists the three additions around them |
| EMHASS's MIT notice | Repository `LICENSE` and `NOTICE.md` (unchanged) |
| No trademark or branding use | No upstream project's name is used as AVISHKAR's own; each is named only as the source |

Nothing was imported from a repository without a licence, and no credential, token or private data came
in with any clone. The clones live in `/tmp` and are not part of the repository.
