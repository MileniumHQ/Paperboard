import { describe, expect, test, mock, beforeEach } from "bun:test";

const calls: string[] = [];
let installed = false;
let failDownload = false;

mock.module("@mileniumhq/paperapi", () => ({
    packageApi: {
        isInstalled: async (_id: string) => installed,
        download: async (_id: string, onProgress: (progress: any) => void) => {
            calls.push("download");
            if (failDownload) throw new Error("boom");
            onProgress({ stage: "downloading", percent: 50 });
            onProgress({ stage: "extracting", percent: 25 });
        },
    },
}));

const { ensureJavaRuntime } = await import("../src/lib/ensureJava");

beforeEach(() => {
    calls.length = 0;
    installed = false;
    failDownload = false;
});

describe("ensureJavaRuntime", () => {
    test("skips the download when the runtime is present", async () => {
        installed = true;
        const stages: string[] = [];
        const result = await ensureJavaRuntime("java-21", {
            onDownload: () => stages.push("download"),
            onExtract: () => stages.push("extract"),
        });
        expect(result).toEqual({ downloaded: false });
        expect(calls).toEqual([]);
        expect(stages).toEqual([]);
    });

    test("reports staged progress while downloading", async () => {
        const stages: string[] = [];
        const result = await ensureJavaRuntime("java-21", {
            onDownload: (percent) => stages.push(`download:${percent}`),
            onExtract: (percent) => stages.push(`extract:${percent}`),
        });
        expect(result).toEqual({ downloaded: true });
        expect(calls).toEqual(["download"]);
        expect(stages).toEqual(["download:50", "extract:25"]);
    });

    test("propagates download failures", async () => {
        failDownload = true;
        await expect(ensureJavaRuntime("java-21", {})).rejects.toThrow("boom");
    });
});
