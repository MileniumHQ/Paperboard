import { describe, expect, test } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { createPageCrumb, pageCrumbs } from "../utils/pageCrumbs";

describe("page crumbs", () => {
    test("what a crumb's `active` reads changing without closing it keeps the crumbs in the order the pages opened", () => {
        const [width, setWidth] = createSignal(1200);
        const dispose = createRoot((dispose) => {
            // the outer page's `active` reads more than whether it is open, as PaperSlidePage's does
            createPageCrumb(() => width() > 0, () => "Server");
            createPageCrumb(() => true, () => "Overview");
            return dispose;
        });
        expect(pageCrumbs()).toEqual(["Server", "Overview"]);

        setWidth(390);
        expect(pageCrumbs()).toEqual(["Server", "Overview"]);
        dispose();
        expect(pageCrumbs()).toEqual([]);
    });
});
