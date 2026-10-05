// manifest honesty (bun test): there is no network egress declaration —
// panels are first-party and the panel CSP is one fixed policy. The install
// path's static hosts (piston-meta/piston-data.mojang.com, fill/fill-data
// .papermc.io, meta.fabricmc.net, api/cdn.modrinth.com) and the player-skin
// hosts (api.mojang.com, sessionserver.mojang.com, textures.minecraft.net)
// are part of the panel's code and store listing, not a manifest allowlist.
import { describe, it, expect } from "bun:test";
import manifest from "../manifest.json";

describe("manifest network", () => {
    it("carries no egress declaration", () => {
        expect((manifest as any).network).toBeUndefined();
    });
});
