import { afterEach, describe, expect, test } from "vitest";
import { dismissToast, showError, shownToasts } from "../utils/toasts";

afterEach(() => {
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
