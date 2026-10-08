import type { ServerSoftwareType } from "./catalog";
import type { SoftwareProvider } from "./types";
import { vanillaProvider } from "./providers/vanilla";
import { paperProvider } from "./providers/paper";
import { fabricProvider } from "./providers/fabric";
import { neoforgeProvider } from "./providers/neoforge";
import { forgeProvider } from "./providers/forge";

// one provider per catalog id; the Record type refuses a missing one
export const SOFTWARE_PROVIDERS: Readonly<Record<ServerSoftwareType, SoftwareProvider>> = {
    vanilla: vanillaProvider,
    paper: paperProvider,
    fabric: fabricProvider,
    neoforge: neoforgeProvider,
    forge: forgeProvider,
};

export function providerFor(id: ServerSoftwareType): SoftwareProvider {
    return SOFTWARE_PROVIDERS[id];
}
