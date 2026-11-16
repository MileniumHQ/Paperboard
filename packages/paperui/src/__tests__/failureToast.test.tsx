import { createRoot, createSignal } from "solid-js";
import { afterEach, describe, expect, test } from "vitest";
import { createRead } from "../utils/read";
import { createFailureToast, dismissToast, showError, shownToasts } from "../utils/toasts";

// lets every already-queued promise reaction run
async function flush(): Promise<void> {
    for (let i = 0; i < 20; i++) await Promise.resolve();
}

const roots: (() => void)[] = [];
function inRoot<T>(fn: () => T): T {
    return createRoot((dispose) => {
        roots.push(dispose);
        return fn();
    });
}
afterEach(() => {
    for (const dispose of roots.splice(0)) dispose();
    for (const toast of [...shownToasts()]) dismissToast(toast.id);
});

const shown = () => shownToasts().map((t) => ({ title: t.title, message: t.message, variant: t.variant, action: t.action?.label }));

describe("showError", () => {
    test("says whatever was caught in words, once per title, with the newest reason, and Try again calls retry", () => {
        let retries = 0;
        showError("Couldn't save the server", new Error("EACCES: permission denied"), { retry: () => retries++ });
        showError("Couldn't save the server", "Disk full");
        showError("Couldn't start", { code: 7 }, { key: "start" });
        expect(shown()).toEqual([
            { title: "Couldn't save the server", message: "Disk full", variant: "danger", action: undefined },
            { title: "Couldn't start", message: "[object Object]", variant: "danger", action: undefined },
        ]);
        showError("Couldn't save the server", new Error("EACCES"), { retry: () => retries++ });
        shownToasts()[0].action!.onClick();
        expect(retries).toBe(1);
    });

    test("a reason's first line is the message and the lines after it are the details, kept whole", () => {
        showError("Couldn't update the server", new Error("SteamCMD exited with code 8\nLogging in anonymously...\nERROR! Failed to install app '2394010' (Disk write failure)\n"));
        expect(shownToasts().map((t) => [t.message, t.details])).toEqual([
            ["SteamCMD exited with code 8", "Logging in anonymously...\nERROR! Failed to install app '2394010' (Disk write failure)"],
        ]);
        // one line has no details, and given details are kept
        showError("Couldn't start", "The port is taken", { details: "listen EADDRINUSE :::25565" });
        expect(shownToasts()[1]).toMatchObject({ message: "The port is taken", details: "listen EADDRINUSE :::25565" });
    });
});

describe("createFailureToast", () => {
    test("a standing failure is one danger toast that follows its words, and closes when it clears or its owner goes", () => {
        const [failure, setFailure] = createSignal<unknown>(null);
        inRoot(() => createFailureToast(failure, { title: "Couldn't load the worlds" }));
        expect(shown()).toEqual([]);

        setFailure("The server is offline");
        expect(shown()).toEqual([{ title: "Couldn't load the worlds", message: "The server is offline", variant: "danger", action: undefined }]);
        const first = shownToasts()[0];
        // newer words land in the same toast, never a second one
        setFailure("Permission denied");
        expect(shownToasts()).toHaveLength(1);
        expect(shownToasts()[0]).toBe(first);
        expect(first.message).toBe("Permission denied");

        setFailure(null);
        expect(shown()).toEqual([]);

        // whatever was caught, in words
        setFailure(new Error("Gone again"));
        expect(shown().map((t) => t.message)).toEqual(["Gone again"]);
        for (const dispose of roots.splice(0)) dispose();
        expect(shown()).toEqual([]);
    });

    test("a toast the person closed stays closed until the words change, or the failure clears and comes back", () => {
        const [failure, setFailure] = createSignal<string | null>("Disk full");
        inRoot(() => createFailureToast(failure, { title: "Couldn't save" }));
        dismissToast(shownToasts()[0].id);
        expect(shown()).toEqual([]);

        // the same failure said again is still the one closed
        setFailure("Disk full");
        expect(shown()).toEqual([]);

        setFailure("Read-only file system");
        expect(shown().map((t) => t.message)).toEqual(["Read-only file system"]);

        dismissToast(shownToasts()[0].id);
        setFailure(null);
        setFailure("Read-only file system");
        expect(shown().map((t) => t.message)).toEqual(["Read-only file system"]);
    });
});

describe("createRead's failure", () => {
    test("a failed read toasts its words, closes while a read is out, comes back if that fails too, and clears on an answer", async () => {
        let answer: () => Promise<string> = () => Promise.reject(new Error("ECONNREFUSED"));
        const read = inRoot(() => createRead(() => answer(), { failure: { title: "Couldn't load the worlds", retry: true } }));
        await flush();
        expect(shown()).toEqual([{ title: "Couldn't load the worlds", message: "ECONNREFUSED", variant: "danger", action: "Try again" }]);

        // its button reads again: the toast goes while that read is out
        let settle!: (value: string) => void;
        let refuse!: (err: Error) => void;
        answer = () => new Promise<string>((resolve, reject) => ((settle = resolve), (refuse = reject)));
        shownToasts()[0].action!.onClick();
        expect(read.loading()).toBe(true);
        expect(shown()).toEqual([]);
        refuse(new Error("ECONNREFUSED"));
        await flush();
        expect(shown().map((t) => t.message)).toEqual(["ECONNREFUSED"]);

        void read.reload();
        settle("worlds");
        await flush();
        expect(read.value()).toBe("worlds");
        expect(shown()).toEqual([]);
    });

    test("without it a failed read shows nothing of its own", async () => {
        const read = inRoot(() => createRead(() => Promise.reject(new Error("ECONNREFUSED"))));
        await flush();
        expect(read.error()).toBe("ECONNREFUSED");
        expect(shown()).toEqual([]);
    });
});
