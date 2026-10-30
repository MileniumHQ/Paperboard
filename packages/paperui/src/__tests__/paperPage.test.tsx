import { describe, test, expect } from "vitest";
import { createSignal } from "solid-js";
import { render } from "@solidjs/testing-library";
import { PaperPage } from "../templates/PaperPage";

describe("PaperPage", () => {
    // Its style getter once copied every prop, children included, so each
    // restyle built the contents again. A child that changed state on mount
    // (Game Server's Overview loading config) then remounted itself forever.
    test("restyling the page keeps its children mounted", () => {
        const [gap, setGap] = createSignal<"full" | "half">("full");
        let mounts = 0;
        function Child() {
            mounts++;
            return <span>content</span>;
        }
        const { getByText } = render(() => (
            <PaperPage gap={gap()}>
                <Child />
            </PaperPage>
        ));
        expect(getByText("content")).toBeTruthy();
        setGap("half");
        setGap("full");
        expect(mounts).toBe(1);
    });
});
