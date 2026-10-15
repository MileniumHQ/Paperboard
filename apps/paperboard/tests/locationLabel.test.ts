import { expect, test } from "bun:test";
import { uniqueLocationLabel } from "../src/renderer/src/components/backups/locationLabel";

test("an unnamed location takes the provider's name, numbered past the names already used", () => {
    expect(uniqueLocationLabel("Google Drive", ["This computer"])).toBe("Google Drive");
    expect(uniqueLocationLabel("Google Drive", ["Google Drive"])).toBe("Google Drive 2");
    expect(uniqueLocationLabel("Google Drive", ["Google Drive", "Google Drive 2", "Google Drive 4"])).toBe("Google Drive 3");
});
