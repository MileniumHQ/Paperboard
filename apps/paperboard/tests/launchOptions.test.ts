// Launch flags (bun test): --no-tutorial turns off tutorials that open by
// themselves, and leaving it out keeps them on; --mobile asks for the phone
// layout, and leaving it out keeps the desktop one.
import { describe, it, expect } from "bun:test";
import { launchOptionsFromArgv } from "../src/shared/launchOptions";

describe("launch options", () => {
    it("reads --no-tutorial from the command line", () => {
        expect(launchOptionsFromArgv(["electron", ".", "--no-tutorial"]).firstOpenTutorials).toBe(false);
        expect(launchOptionsFromArgv(["electron", ".", "--browser"]).firstOpenTutorials).toBe(true);
    });

    it("reads --mobile from the command line", () => {
        expect(launchOptionsFromArgv(["electron", ".", "--mobile"]).mobile).toBe(true);
        expect(launchOptionsFromArgv(["electron", ".", "--browser"]).mobile).toBe(false);
    });
});
