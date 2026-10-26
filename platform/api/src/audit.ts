import type { Db } from "./db.js";
import type { Prisma } from "./generated/prisma/client.js";

export interface AuditEvent {
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  requestId?: string;
  ip?: string;
  detail?: Prisma.InputJsonValue;
}

/** Append one row to the append-only audit log (a database trigger forbids edits and deletes). Never throws into callers. */
export async function audit(db: Db, e: AuditEvent, onError?: (err: unknown) => void): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: e.userId ?? null,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        requestId: e.requestId,
        ip: e.ip,
        detail: e.detail,
      },
    });
  } catch (err) {
    onError?.(err);
  }
}
