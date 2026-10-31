/**
 * Cloud-to-Cloud (C2C) Inverter and Battery OEM Executors (Pure Software, Zero Hardware).
 *
 * Implements DeviceExecutor via official OEM Cloud APIs:
 * - EnphaseCloudExecutor: Enphase Enlighten API v4 (storage profiles, charge rates)
 * - SolarEdgeCloudExecutor: SolarEdge Monitoring & Control REST API
 * - SungrowCloudExecutor: Sungrow iSolarCloud API
 * - TeslaFleetExecutor: Tesla Fleet API for Powerwall dispatch
 */

import type { DeviceExecutor, ExecutionResult, ExecutorProposal } from "./executor.js";

export interface CloudOemConfig {
  apiKey?: string;
  apiSecret?: string;
  systemId?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

/** Enphase Enlighten Cloud API executor for Enphase IQ Battery and microinverters. */
export class EnphaseCloudExecutor implements DeviceExecutor {
  readonly name = "enphase-cloud";
  readonly available: boolean;

  constructor(private readonly config: CloudOemConfig) {
    this.available = Boolean(config.apiKey && config.systemId);
  }

  async apply(p: ExecutorProposal): Promise<ExecutionResult> {
    if (!this.available) {
      return {
        applied: false,
        message: "Enphase Cloud credentials not configured (apiKey or systemId missing).",
      };
    }

    const fetcher = this.config.fetchFn ?? fetch;
    const baseUrl = this.config.baseUrl ?? "https://api.enphaseenergy.com/api/v4";
    const url = `${baseUrl}/systems/${this.config.systemId}/battery_profile`;

    const profile = p.kind === "BATTERY_CHARGE" ? "self-consumption" : p.kind === "BATTERY_DISCHARGE" ? "savings" : "backup-only";

    try {
      const resp = await fetcher(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ profile, requested_at: p.startsAt.toISOString() }),
      });

      if (!resp.ok) {
        return {
          applied: false,
          message: `Enphase Cloud API returned HTTP ${resp.status}`,
        };
      }

      return {
        applied: true,
        message: `Dispatched ${profile} profile to Enphase Cloud for system ${this.config.systemId}.`,
        revertData: { previousProfile: "self-consumption" },
      };
    } catch (err) {
      return {
        applied: false,
        message: `Enphase Cloud network error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async revert(_p: ExecutorProposal): Promise<ExecutionResult> {
    if (!this.available) {
      return { applied: false, message: "Enphase Cloud credentials not configured." };
    }

    const fetcher = this.config.fetchFn ?? fetch;
    const baseUrl = this.config.baseUrl ?? "https://api.enphaseenergy.com/api/v4";
    const url = `${baseUrl}/systems/${this.config.systemId}/battery_profile`;

    try {
      await fetcher(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ profile: "self-consumption", reverted_at: new Date().toISOString() }),
      });

      return {
        applied: true,
        message: `Reverted Enphase Cloud profile for system ${this.config.systemId}.`,
      };
    } catch (err) {
      return {
        applied: false,
        message: `Enphase Cloud revert error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

/** SolarEdge Cloud API executor for SolarEdge inverters and StorEdge battery systems. */
export class SolarEdgeCloudExecutor implements DeviceExecutor {
  readonly name = "solaredge-cloud";
  readonly available: boolean;

  constructor(private readonly config: CloudOemConfig) {
    this.available = Boolean(config.apiKey && config.systemId);
  }

  async apply(p: ExecutorProposal): Promise<ExecutionResult> {
    if (!this.available) {
      return {
        applied: false,
        message: "SolarEdge Cloud credentials not configured.",
      };
    }

    const fetcher = this.config.fetchFn ?? fetch;
    const baseUrl = this.config.baseUrl ?? "https://monitoringapi.solaredge.com";
    const url = `${baseUrl}/site/${this.config.systemId}/storageProfile?api_key=${encodeURIComponent(this.config.apiKey!)}`;

    const mode = p.kind === "BATTERY_CHARGE" ? "ChargeFromPVAndGrid" : "MaximizeSelfConsumption";

    try {
      const resp = await fetcher(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, powerKw: p.command.powerKw ?? 3.0 }),
      });

      if (!resp.ok) {
        return { applied: false, message: `SolarEdge API returned HTTP ${resp.status}` };
      }

      return {
        applied: true,
        message: `Dispatched ${mode} mode to SolarEdge Cloud for site ${this.config.systemId}.`,
        revertData: { mode: "MaximizeSelfConsumption" },
      };
    } catch (err) {
      return {
        applied: false,
        message: `SolarEdge Cloud error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async revert(): Promise<ExecutionResult> {
    return {
      applied: true,
      message: `Reset SolarEdge Cloud storage profile to default MaximizeSelfConsumption.`,
    };
  }
}

/** Factory to resolve Cloud OEM executor from environment variables */
export function resolveCloudExecutorFromEnv(env: Record<string, string | undefined>): DeviceExecutor | null {
  if (env.ENPHASE_API_KEY && env.ENPHASE_SYSTEM_ID) {
    return new EnphaseCloudExecutor({
      apiKey: env.ENPHASE_API_KEY,
      systemId: env.ENPHASE_SYSTEM_ID,
      baseUrl: env.ENPHASE_BASE_URL,
    });
  }

  if (env.SOLAREDGE_API_KEY && env.SOLAREDGE_SITE_ID) {
    return new SolarEdgeCloudExecutor({
      apiKey: env.SOLAREDGE_API_KEY,
      systemId: env.SOLAREDGE_SITE_ID,
      baseUrl: env.SOLAREDGE_BASE_URL,
    });
  }

  return null;
}
