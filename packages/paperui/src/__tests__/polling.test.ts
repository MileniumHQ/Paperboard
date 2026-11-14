import { createRoot } from "solid-js";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createPolling } from "../utils/polling";

afterEach(() => {
    vi.useRealTimers();
});

describe("createPolling", () => {
    test("skips a tick while the previous call is still running", async () => {
        vi.useFakeTimers();
        let calls = 0;
        let finish = () => {};
        const dispose = createRoot((dispose) => {
            createPolling(() => {
                calls++;
                return new Promise<void>((resolve) => (finish = resolve));
            }, 100);
            return dispose;
        });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(calls).toBe(1);
        finish();
        await vi.advanceTimersByTimeAsync(100);
        expect(calls).toBe(2);
        dispose();
        finish();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(calls).toBe(2);
    });
});
