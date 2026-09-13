import { invoke } from "./ipc";

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
    set: (name: string, value: string, panelId: string): Promise<void> => {
        assertVaultArg(name, "secret name");
        assertVaultArg(panelId, "panelId");
        if (typeof value !== "string") {
            throw new Error("[paperapi] secrets API requires a string secret value");
        }
        return invoke<void>("secrets-set", { name, value, panelId });
    },

    get: (name: string, panelId: string): Promise<{ found: boolean; value: string | null }> => {
        assertVaultArg(name, "secret name");
        assertVaultArg(panelId, "panelId");
        return invoke<{ found: boolean; value: string | null }>("secrets-get", { name, panelId });
    },

    delete: (name: string, panelId: string): Promise<boolean> => {
        assertVaultArg(name, "secret name");
        assertVaultArg(panelId, "panelId");
        return invoke<boolean>("secrets-delete", { name, panelId });
    },

    list: (panelId?: string, includeOtherPanels?: boolean): Promise<string[]> => {
        if (panelId !== undefined) assertVaultArg(panelId, "panelId");
        return invoke<string[]>("secrets-list", { panelId, includeOtherPanels: includeOtherPanels === true });
    },

    purge: (panelId: string): Promise<number> => {
        assertVaultArg(panelId, "panelId");
        return invoke<number>("secrets-purge", { panelId });
    },
};

export const secrets = secretsApi;
