import { RPC_ROUTES } from "./ipc";

function assertVaultArg(value: unknown, what: string): asserts value is string {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`[paperapi] secrets API requires a non-empty string ${what}`);
    }
}

// daemon secret vault access. panelId is required everywhere —
// no hostname or env fallback, credentials always carry explicit identity.
// Arguments are validated here, at the client-owned boundary, so a missing
// argument fails loudly instead of riding the wire as `undefined`.
export const secretsApi = {
    /** resolves with true once the secret is stored; a refused one rejects */
    set: (name: string, value: string, panelId: string): Promise<true> => {
        assertVaultArg(name, "secret name");
        assertVaultArg(panelId, "panelId");
        if (typeof value !== "string") {
            throw new Error("[paperapi] secrets API requires a string secret value");
        }
        return RPC_ROUTES["secrets-set"].call(undefined, { name, value, panelId });
    },

    get: (name: string, panelId: string): Promise<{ found: boolean; value: string | null }> => {
        assertVaultArg(name, "secret name");
        assertVaultArg(panelId, "panelId");
        return RPC_ROUTES["secrets-get"].call(undefined, { name, panelId });
    },

    delete: (name: string, panelId: string): Promise<boolean> => {
        assertVaultArg(name, "secret name");
        assertVaultArg(panelId, "panelId");
        return RPC_ROUTES["secrets-delete"].call(undefined, { name, panelId });
    },

    // names only, never values, and only the calling panel's keys: there
    // is no cross-panel widening flag on the wire
    list: (panelId: string): Promise<string[]> => {
        assertVaultArg(panelId, "panelId");
        return RPC_ROUTES["secrets-list"].call(undefined, { panelId });
    },

    purge: (panelId: string): Promise<number> => {
        assertVaultArg(panelId, "panelId");
        return RPC_ROUTES["secrets-purge"].call(undefined, { panelId });
    },
};

export const secrets = secretsApi;
