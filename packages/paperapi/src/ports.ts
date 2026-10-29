// Network ports a panel's program opens on the computer. A panel claims a
// port by a name of its own ("java", "bedrock") and Paperboard decides the
// number: never one another claim holds, never one another program on the
// computer is using. When the number asked for is taken, the user's setting
// decides: refuse with an error that says who has it, or give the next free
// port. Write the number you get into your program's config; never assume
// the one you asked for.
import { invokeIn } from "./ipc";
import { requirePanelId } from "./panelIdentity";

export type PortProtocol = "tcp" | "udp" | "tcp+udp";
/** what Paperboard does when the port asked for is taken; the user's setting */
export type PortPolicy = "refuse" | "next-free";

export interface PortClaim {
    panelId: string;
    /** the panel's own name for the port, unique per panel */
    name: string;
    /** who holds it, for people: "Game Server (Java)" */
    label: string;
    protocol: PortProtocol;
    port: number;
}

export interface PortRequest {
    /** lowercase letters, digits and dashes, up to 32 */
    name: string;
    /** up to 80 characters; shown in errors and in Paperboard's settings */
    label: string;
    protocol: PortProtocol;
    /** the number the panel would like; a held claim keeps it as it is */
    preferred: number;
}

export const portApi = {
    /** gives the port a number, or keeps the one it has when `preferred`
     * matches it. Throws when the port is taken and the policy refuses. */
    claim: (appId: string, request: PortRequest, scope?: string): Promise<PortClaim> =>
        invokeIn<PortClaim>(scope, "ports-claim", { panelId: requirePanelId(appId), ...request }),

    /** call right before your program opens the port: checks the computer
     * again and, as the policy says, refuses or moves it. Write the number
     * it returns into your program's config before starting it. */
    prepare: (appId: string, name: string, scope?: string): Promise<PortClaim> =>
        invokeIn<PortClaim>(scope, "ports-prepare", { panelId: requirePanelId(appId), name }),

    /** gives the port back; releasing one not held does nothing */
    release: (appId: string, name: string, scope?: string): Promise<void> =>
        invokeIn<void>(scope, "ports-release", { panelId: requirePanelId(appId), name }),

    list: (appId: string, scope?: string): Promise<PortClaim[]> =>
        invokeIn<PortClaim[]>(scope, "ports-list", { panelId: requirePanelId(appId) }),
};

/** Paperboard's own settings: every claim on the computer and the policy.
 * These need the host's credential; a panel's is refused. */
export const portSettingsApi = {
    all: (scope?: string): Promise<{ claims: PortClaim[]; policy: PortPolicy }> => invokeIn(scope, "ports-all"),
    setPolicy: (policy: PortPolicy, scope?: string): Promise<PortPolicy> => invokeIn<PortPolicy>(scope, "ports-policy-set", { policy }),
};
