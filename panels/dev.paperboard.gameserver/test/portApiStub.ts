// portApi for suites that mock the whole SDK: every port is free, so a
// claim keeps the number asked for. The registry itself is tested against
// the daemon's real one in ports.test.ts.
import type { PortClaim, PortRequest } from "@mileniumhq/paperapi";

export function portApiStub() {
    const claims = new Map<string, PortClaim>();
    return {
        claim: async (panelId: string, request: PortRequest): Promise<PortClaim> => {
            const claim = { panelId, name: request.name, label: request.label, protocol: request.protocol, port: request.preferred };
            claims.set(`${panelId}:${request.name}`, claim);
            return claim;
        },
        prepare: async (panelId: string, name: string): Promise<PortClaim> => {
            const claim = claims.get(`${panelId}:${name}`);
            if (!claim) throw new Error(`No port named "${name}" is claimed; claim it first.`);
            return claim;
        },
        release: async (panelId: string, name: string): Promise<void> => {
            claims.delete(`${panelId}:${name}`);
        },
        list: async (panelId: string): Promise<PortClaim[]> => [...claims.values()].filter((c) => c.panelId === panelId),
    };
}
