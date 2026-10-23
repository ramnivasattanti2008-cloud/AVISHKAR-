/**
 * The seam between a decision and a device (spec section 46).
 *
 * Provides the DeviceExecutor interface and implementations:
 * 1. NoDeviceExecutor: Default safe executor when no hardware is connected.
 * 2. HomeAssistantExecutor: Dispatches REST service calls to Home Assistant entities.
 * 3. MqttDeviceExecutor: Publishes JSON control events to MQTT broker topics.
 */

export interface ExecutorProposal {
  id: string;
  propertyId: string;
  kind: "BATTERY_CHARGE" | "BATTERY_DISCHARGE" | "APPLIANCE_RUN" | "EV_CHARGE";
  startsAt: Date;
  endsAt: Date;
  command: Record<string, unknown>;
}

export interface ExecutionResult {
  /** True only when a device was really changed. */
  applied: boolean;
  message: string;
  revertData?: Record<string, unknown>;
}

export interface DeviceExecutor {
  readonly name: string;
  /** Whether any device is connected at all. AUTOMATE cannot be chosen without it. */
  readonly available: boolean;
  apply(p: ExecutorProposal): Promise<ExecutionResult>;
  /** Undo a move that was applied. Called only for a proposal whose apply() returned applied: true. */
  revert(p: ExecutorProposal): Promise<ExecutionResult>;
}

/** No device is connected: nothing is ever changed, and every answer says so. */
export class NoDeviceExecutor implements DeviceExecutor {
  readonly name = "none";
  readonly available = false;

  async apply(): Promise<ExecutionResult> {
    return {
      applied: false,
      message: "No device is connected to AVISHKAR, so nothing was changed. Your approval is recorded.",
    };
  }

  async revert(): Promise<ExecutionResult> {
    return {
      applied: false,
      message: "Nothing had been applied to any device, so there is nothing to undo.",
    };
  }
}

/** Home Assistant REST API executor for smart switches, inverters, and battery storage entities. */
export class HomeAssistantExecutor implements DeviceExecutor {
  readonly name = "home-assistant";
  readonly available = true;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async callService(domain: string, service: string, serviceData: Record<string, unknown>): Promise<void> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/api/services/${domain}/${service}`;
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(serviceData),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Home Assistant API returned HTTP ${res.status}: ${errText.slice(0, 150)}`);
    }
  }

  async apply(p: ExecutorProposal): Promise<ExecutionResult> {
    try {
      const entityId = (p.command.entityId as string) || (p.command.entity_id as string);
      if (!entityId) {
        return { applied: false, message: "Proposal missing required entityId in command parameters." };
      }

      if (p.kind === "APPLIANCE_RUN" || p.kind === "EV_CHARGE") {
        await this.callService("switch", "turn_on", { entity_id: entityId });
        return { applied: true, message: `Dispatched turn_on to Home Assistant entity ${entityId}.` };
      }

      if (p.kind === "BATTERY_CHARGE" || p.kind === "BATTERY_DISCHARGE") {
        const targetPower = typeof p.command.powerKw === "number" ? p.command.powerKw : 0;
        await this.callService("number", "set_value", { entity_id: entityId, value: targetPower });
        return { applied: true, message: `Updated battery power target to ${targetPower} kW on ${entityId}.` };
      }

      return { applied: false, message: `Unsupported proposal kind ${p.kind} for Home Assistant.` };
    } catch (err) {
      return { applied: false, message: `Home Assistant dispatch failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async revert(p: ExecutorProposal): Promise<ExecutionResult> {
    try {
      const entityId = (p.command.entityId as string) || (p.command.entity_id as string);
      if (!entityId) {
        return { applied: false, message: "Proposal missing required entityId for revert." };
      }

      if (p.kind === "APPLIANCE_RUN" || p.kind === "EV_CHARGE") {
        await this.callService("switch", "turn_off", { entity_id: entityId });
        return { applied: true, message: `Reverted Home Assistant entity ${entityId} to off state.` };
      }

      if (p.kind === "BATTERY_CHARGE" || p.kind === "BATTERY_DISCHARGE") {
        await this.callService("number", "set_value", { entity_id: entityId, value: 0 });
        return { applied: true, message: `Reset battery power to 0 kW on entity ${entityId}.` };
      }

      return { applied: false, message: "Revert operation completed." };
    } catch (err) {
      return { applied: false, message: `Home Assistant revert failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}

/** MQTT message publisher function signature. */
export type MqttPublishFn = (topic: string, message: string) => Promise<void>;

/** MQTT broker executor for SunSpec Modbus bridges, Zigbee2MQTT relays, and IoT gateways. */
export class MqttDeviceExecutor implements DeviceExecutor {
  readonly name = "mqtt";
  readonly available = true;

  constructor(
    private readonly publishFn: MqttPublishFn,
    private readonly topicPrefix: string = "urjasetu",
  ) {}

  async apply(p: ExecutorProposal): Promise<ExecutionResult> {
    try {
      const topic = `${this.topicPrefix}/${p.propertyId}/${p.kind.toLowerCase()}/apply`;
      const payload = JSON.stringify({
        action: "APPLY",
        proposalId: p.id,
        kind: p.kind,
        startsAt: p.startsAt.toISOString(),
        endsAt: p.endsAt.toISOString(),
        command: p.command,
      });

      await this.publishFn(topic, payload);
      return { applied: true, message: `Published ${p.kind} dispatch to MQTT topic ${topic}.` };
    } catch (err) {
      return { applied: false, message: `MQTT dispatch failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async revert(p: ExecutorProposal): Promise<ExecutionResult> {
    try {
      const topic = `${this.topicPrefix}/${p.propertyId}/${p.kind.toLowerCase()}/revert`;
      const payload = JSON.stringify({
        action: "REVERT",
        proposalId: p.id,
        kind: p.kind,
        command: p.command,
      });

      await this.publishFn(topic, payload);
      return { applied: true, message: `Published revert signal to MQTT topic ${topic}.` };
    } catch (err) {
      return { applied: false, message: `MQTT revert failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}

/** Factory to resolve the active executor from environment variables. */
export function resolveExecutorFromEnv(env: NodeJS.ProcessEnv = process.env): DeviceExecutor {
  if (env.HASS_URL && env.HASS_TOKEN) {
    return new HomeAssistantExecutor(env.HASS_URL, env.HASS_TOKEN);
  }
  return new NoDeviceExecutor();
}
