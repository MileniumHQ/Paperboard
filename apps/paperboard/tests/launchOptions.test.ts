// Launch flags (bun test): --no-tutorial turns off tutorials that open by
// themselves, and leaving it out keeps them on.
import { describe, it, expect } from "bun:test";
import { launchOptionsFromArgv } from "../src/shared/launchOptions";

describe("launch options", () => {
    it("reads --no-tutorial from the command line", () => {
        expect(launchOptionsFromArgv(["electron", ".", "--no-tutorial"]).firstOpenTutorials).toBe(false);
        expect(launchOptionsFromArgv(["electron", ".", "--browser"]).firstOpenTutorials).toBe(true);
    });
});
