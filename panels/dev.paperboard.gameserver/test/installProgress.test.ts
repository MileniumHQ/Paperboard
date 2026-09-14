import { describe, expect, test } from "bun:test";
import {
    toInstallProgress,
    shouldRelayInstallProgress,
} from "../src/service/installProgress";

describe("toInstallProgress", () => {
    test("passes downloading percent through, clamped and rounded", () => {
        expect(toInstallProgress({ stage: "downloading", percent: 42.6 })).toEqual({
            stage: "downloading",
            percent: 43,
        });
        expect(toInstallProgress({ stage: "downloading", percent: 150 })).toEqual({
            stage: "downloading",
            percent: 100,
        });
        expect(toInstallProgress({ stage: "downloading", percent: -3 })).toEqual({
            stage: "downloading",
            percent: 0,
        });
    });

    test("keeps the actionable stages, drops the rest", () => {
        expect(toInstallProgress({ stage: "verifying", percent: 99 })).toEqual({
            stage: "verifying",
            percent: 99,
        });
        expect(toInstallProgress({ stage: "completed", percent: 100 })).toEqual({
            stage: "completed",
            percent: 100,
        });
        expect(toInstallProgress({ stage: "error", percent: 0 })).toEqual({
            stage: "error",
            percent: 0,
        });
        expect(toInstallProgress({ stage: "starting", percent: 0 })).toBeNull();
        expect(toInstallProgress({ stage: "checking", percent: 0 })).toBeNull();
        expect(toInstallProgress({ stage: "nope", percent: 10 })).toBeNull();
    });

    test("non-numeric percent becomes 0 instead of poisoning state", () => {
        expect(toInstallProgress({ stage: "downloading", percent: "half" })).toEqual({
            stage: "downloading",
            percent: 0,
        });
        expect(toInstallProgress({ stage: "downloading" })).toEqual({
            stage: "downloading",
            percent: 0,
        });
    });
});

describe("shouldRelayInstallProgress", () => {
    test("first event always relays", () => {
        expect(
            shouldRelayInstallProgress(null, { stage: "downloading", percent: 0 }),
        ).toBe(true);
    });

    test("stage flips always relay", () => {
        expect(
            shouldRelayInstallProgress(
                { stage: "downloading", percent: 99 },
                { stage: "verifying", percent: 99 },
            ),
        ).toBe(true);
        expect(
            shouldRelayInstallProgress(
                { stage: "verifying", percent: 99 },
                { stage: "completed", percent: 100 },
            ),
        ).toBe(true);
    });

    test("in-stage percent must move at least a point", () => {
        const prev = { stage: "downloading", percent: 42 } as const;
        expect(
            shouldRelayInstallProgress(prev, { stage: "downloading", percent: 42 }),
        ).toBe(false);
        expect(
            shouldRelayInstallProgress(prev, { stage: "downloading", percent: 43 }),
        ).toBe(true);
    });
});
