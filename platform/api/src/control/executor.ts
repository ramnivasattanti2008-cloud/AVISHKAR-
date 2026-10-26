/**
 * The seam between a decision and a device (spec section 46). AVISHKAR is connected to no inverter, battery, charger or smart
 * appliance, so the only executor shipped declines, and says so. A real integration is a drop-in replacement behind this interface;
 * it must be able to undo what it applied, because "rollback where possible" is part of the contract.
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
    return { applied: false, message: "No device is connected to AVISHKAR, so nothing was changed. Your approval is recorded." };
  }
  async revert(): Promise<ExecutionResult> {
    return { applied: false, message: "Nothing had been applied to any device, so there is nothing to undo." };
  }
}
