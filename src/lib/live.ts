// In-process change notifications, one channel per tenant. Messages carry no data: listeners re-read
// their own tenant-scoped state, so nothing from another tenant can ever reach them.
// ponytail: single Node process (the office PC). Several app instances would need Postgres LISTEN/NOTIFY.
import "server-only";
import { EventEmitter } from "node:events";

const g = globalThis as unknown as { liveBus?: EventEmitter };
const bus = (g.liveBus ??= new EventEmitter().setMaxListeners(0));

export const publish = (tenantId: string) => {
  bus.emit(`tenant:${tenantId}`);
};

export function subscribe(tenantId: string, onChange: () => void) {
  bus.on(`tenant:${tenantId}`, onChange);
  return () => {
    bus.off(`tenant:${tenantId}`, onChange);
  };
}
