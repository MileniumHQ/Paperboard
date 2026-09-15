import { describe, test, expect, vi, afterEach } from "vitest";
import { render } from "@solidjs/testing-library";
import { PaperAvatar } from "../components/PaperAvatar";
import { PaperEmptyState } from "../components/PaperEmptyState";
import { PaperKeyValueList, PaperKeyValue } from "../components/PaperKeyValueList";
import { PaperSectionHeader } from "../components/PaperSectionHeader";
import { PaperProse } from "../components/PaperProse";
import { createPolling } from "../utils/polling";

describe("PaperAvatar", () => {
    test("renders the image when a src exists", () => {
        const { container } = render(() => (
            <PaperAvatar src="https://cdn.example/a.png" size="large" alt="Bot" />
        ));
        const img = container.querySelector("img")!;
        expect(img.getAttribute("src")).toBe("https://cdn.example/a.png");
        expect(container.firstElementChild!.className).toContain("large");
    });

    test("falls back to an icon when src is missing", () => {
        const { container } = render(() => (
            <PaperAvatar fallbackIcon="dns" />
        ));
        expect(container.querySelector("img")).toBeNull();
        expect(container.textContent).toContain("dns");
    });
});

describe("PaperEmptyState", () => {
    test("renders title, description, and actions", () => {
        const { getByText } = render(() => (
            <PaperEmptyState icon="search_off" title="No matches" description="Try another filter">
                <button type="button">Reset</button>
            </PaperEmptyState>
        ));
        expect(getByText("No matches")).toBeTruthy();
        expect(getByText("Try another filter")).toBeTruthy();
        expect(getByText("Reset")).toBeTruthy();
    });
});

describe("PaperKeyValueList", () => {
    test("renders labeled rows", () => {
        const { getByText } = render(() => (
            <PaperKeyValueList>
                <PaperKeyValue label="Gateway latency">38 ms</PaperKeyValue>
            </PaperKeyValueList>
        ));
        expect(getByText("Gateway latency")).toBeTruthy();
        expect(getByText("38 ms")).toBeTruthy();
    });
});

describe("PaperSectionHeader", () => {
    test("shows the count and actions", () => {
        const { container, getByText } = render(() => (
            <PaperSectionHeader icon="chat" title="Messages" count={3}>
                <button type="button">Add</button>
            </PaperSectionHeader>
        ));
        expect(getByText("3")).toBeTruthy();
        expect(getByText("Add")).toBeTruthy();
        expect(container.textContent).toContain("chat");
    });
});

describe("PaperProse", () => {
    test("passes sanitized html through", () => {
        const { container } = render(() => (
            <PaperProse innerHTML="<p>hello <code>x</code></p>" />
        ));
        expect(container.querySelector("code")?.textContent).toBe("x");
    });
});

describe("createPolling", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    test("runs immediately when asked and stops on command", async () => {
        vi.useFakeTimers();
        const calls: number[] = [];
        const stop = createPolling(() => void calls.push(Date.now()), 1000, {
            immediate: true,
        });
        expect(calls).toHaveLength(1);
        vi.advanceTimersByTime(3000);
        expect(calls).toHaveLength(4);
        stop();
        vi.advanceTimersByTime(3000);
        expect(calls).toHaveLength(4);
    });

    test("refuses a non-positive interval instead of spinning", () => {
        expect(() => createPolling(() => {}, 0)).toThrow(/positive interval/);
    });
});
