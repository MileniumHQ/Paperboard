import { afterEach, describe, expect, test } from "vitest";
import { installPageZoomLock, lockedViewport } from "../utils/pageZoom";

// Inventory: the document never zooms under a pinch, and the lock leaves cleanly.
describe("page zoom lock", () => {
    afterEach(() => document.head.querySelector('meta[name="viewport"]')?.remove());

    test("a viewport keeps its own terms and gains the zoom lock", () => {
        expect(lockedViewport("width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes")).toBe(
            "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
        );
    });

    test("installing locks the page's viewport and root, and uninstalling restores both", () => {
        const meta = document.createElement("meta");
        meta.name = "viewport";
        meta.content = "width=device-width, initial-scale=1";
        document.head.append(meta);

        const uninstall = installPageZoomLock();
        expect(meta.content).toBe("width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no");
        expect(document.documentElement.style.touchAction).toBe("pan-x pan-y");

        uninstall();
        expect(meta.content).toBe("width=device-width, initial-scale=1");
        expect(document.documentElement.style.touchAction).toBe("");
    });
});
