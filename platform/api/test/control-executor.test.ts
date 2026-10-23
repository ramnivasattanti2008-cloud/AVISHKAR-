import { describe, expect, it, vi } from "vitest";
import {
  HomeAssistantExecutor,
  MqttDeviceExecutor,
  NoDeviceExecutor,
  resolveExecutorFromEnv,
  type ExecutorProposal,
} from "../src/control/executor.js";

const mockProposal: ExecutorProposal = {
  id: "prop-123",
  propertyId: "p-456",
  kind: "APPLIANCE_RUN",
  startsAt: new Date("2026-06-01T10:00:00Z"),
  endsAt: new Date("2026-06-01T12:00:00Z"),
  command: { entityId: "switch.washing_machine" },
};

const mockBatteryProposal: ExecutorProposal = {
  id: "prop-batt",
  propertyId: "p-456",
  kind: "BATTERY_CHARGE",
  startsAt: new Date("2026-06-01T12:00:00Z"),
  endsAt: new Date("2026-06-01T14:00:00Z"),
  command: { entityId: "number.battery_charge_rate", powerKw: 3.5 },
};

describe("NoDeviceExecutor", () => {
  it("declines apply and revert gracefully", async () => {
    const ex = new NoDeviceExecutor();
    expect(ex.available).toBe(false);
    expect(ex.name).toBe("none");

    const res = await ex.apply();
    expect(res.applied).toBe(false);
    expect(res.message).toContain("No device is connected");

    const rev = await ex.revert();
    expect(rev.applied).toBe(false);
  });
});

describe("HomeAssistantExecutor", () => {
  it("dispatches turn_on service to Home Assistant", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    const ex = new HomeAssistantExecutor("http://hass.local:8123", "test-token", mockFetch as unknown as typeof fetch);
    expect(ex.available).toBe(true);
    expect(ex.name).toBe("home-assistant");

    const res = await ex.apply(mockProposal);
    expect(res.applied).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://hass.local:8123/api/services/switch/turn_on",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
        body: JSON.stringify({ entity_id: "switch.washing_machine" }),
      }),
    );
  });

  it("dispatches set_value for battery power target", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    const ex = new HomeAssistantExecutor("http://hass.local:8123", "test-token", mockFetch as unknown as typeof fetch);
    const res = await ex.apply(mockBatteryProposal);
    expect(res.applied).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://hass.local:8123/api/services/number/set_value",
      expect.objectContaining({
        body: JSON.stringify({ entity_id: "number.battery_charge_rate", value: 3.5 }),
      }),
    );
  });

  it("handles revert cleanly", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    const ex = new HomeAssistantExecutor("http://hass.local:8123", "test-token", mockFetch as unknown as typeof fetch);
    const res = await ex.revert(mockProposal);
    expect(res.applied).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://hass.local:8123/api/services/switch/turn_off",
      expect.objectContaining({
        body: JSON.stringify({ entity_id: "switch.washing_machine" }),
      }),
    );
  });
});

describe("MqttDeviceExecutor", () => {
  it("publishes apply payload to correct MQTT topic", async () => {
    const mockPublish = vi.fn().mockResolvedValue(undefined);
    const ex = new MqttDeviceExecutor(mockPublish, "urjasetu");
    expect(ex.available).toBe(true);
    expect(ex.name).toBe("mqtt");

    const res = await ex.apply(mockProposal);
    expect(res.applied).toBe(true);
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith(
      "urjasetu/p-456/appliance_run/apply",
      expect.stringContaining('"action":"APPLY"'),
    );
  });

  it("publishes revert payload", async () => {
    const mockPublish = vi.fn().mockResolvedValue(undefined);
    const ex = new MqttDeviceExecutor(mockPublish, "urjasetu");

    const res = await ex.revert(mockProposal);
    expect(res.applied).toBe(true);
    expect(mockPublish).toHaveBeenCalledWith(
      "urjasetu/p-456/appliance_run/revert",
      expect.stringContaining('"action":"REVERT"'),
    );
  });
});

describe("resolveExecutorFromEnv", () => {
  it("returns NoDeviceExecutor when env is empty", () => {
    const ex = resolveExecutorFromEnv({});
    expect(ex.name).toBe("none");
  });

  it("returns HomeAssistantExecutor when HASS credentials are set", () => {
    const ex = resolveExecutorFromEnv({
      HASS_URL: "http://192.168.1.50:8123",
      HASS_TOKEN: "abc-def",
    });
    expect(ex.name).toBe("home-assistant");
    expect(ex.available).toBe(true);
  });
});
