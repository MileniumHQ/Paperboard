import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SetupStep } from "../src/contract";
import { tailFile } from "../src/service/computer";
import { ConsoleReader, freshSteps, progress, reach, setStep, type ConsoleSign } from "../src/service/setupProgress";
import { until } from "./fakeHost";

const view = (steps: SetupStep[]) => Object.fromEntries(steps.map((s) => [s.id, [s.status, ...s.parts.map((p) => `${p.id}:${p.status}${p.percent === null ? "" : `@${p.percent}`}`)]]));

describe("the setup's parts", () => {
    test("signs walk the boot and install parts forward, and finishing boot follows from its setup being read", () => {
        let s = freshSteps();
        for (const id of ["image", "browser", "disk"] as const) s = setStep(s, id, "done", 100);
        s = reach(s, "power");
        s = reach(s, "services"); // the kernel's line was missed: the parts before are done anyway
        expect(view(s).boot).toEqual(["running", "power:done", "linux:done", "services:running", "network:waiting", "setup:waiting"]);
        s = reach(s, "lists"); // the user-data fetch
        expect(view(s).boot[0]).toBe("done");
        expect(view(s).install).toEqual(["running", "lists:running", "packages:waiting", "hands:waiting", "browser:waiting", "desktop:waiting"]);
        s = progress(reach(s, "packages"), "packages", 41.7);
        expect(view(s).install.slice(1, 3)).toEqual(["lists:done", "packages:running@41"]);
        s = reach(s, "hands");
        expect(view(s).install.slice(2, 4)).toEqual(["packages:done@100", "hands:running"]);
    });

    test("nothing moves back, and a finished or failed step is left alone", () => {
        let s = progress(reach(reach(freshSteps(), "power"), "packages"), "packages", 50);
        expect(progress(s, "packages", 30)).toBe(s);
        expect(progress(s, "browser", 10)).toBe(s); // not running yet
        s = reach(s, "browser");
        expect(reach(s, "hands")).toBe(s);
        const failed = setStep(s, "install", "failed", null);
        expect(view(failed).install).toEqual(["failed", "lists:done", "packages:done@100", "hands:done", "browser:failed", "desktop:waiting"]);
        expect(reach(failed, "desktop")).toBe(failed);
    });
});

// the shapes of a real first boot's serial console, colour codes and all
const ci = (t: string) => `[   75.04] cloud-init[568]: ${t}`;
const BOOT = [
    "SeaBIOS (version 1.16.3)",
    "[    0.000000] Linux version 6.12.113+deb13-cloud-amd64 (debian-kernel@lists.debian.org)",
    "[    2.429981] systemd[1]: Detected virtualization kvm.",
    "         Starting \x1b[0;1;39mcloud-init-local.service\x1b[0m …-init: Local Stage (pre-network)...",
    "[    3.621420] cloud-init[568]: Cloud-init v. 25.1.4 running 'init-local' at Thu, 22 Oct 2026. Up 3.61 seconds.",
    ci("Get:7 https://deb.debian.org/debian trixie/main Sources [10.5 MB]"), // apt-get update: not a package
];
// an apt install run with APT::Status-Fd=1: its download, then dpkg, each in its own percentages
const install = (dl: number[], pm: number[]) => [
    ci("0 upgraded, 4 newly installed, 0 to remove and 3 not upgraded."),
    ci("Get:1 https://deb.debian.org/debian trixie/main amd64 p0 amd64 1.0 [1 kB]"), // printed as it starts, not as it ends
    ...dl.map((p) => ci(`dlstatus:3:${p}:Retrieving file 3 of 4 (2s remaining)`)),
    ...pm.map((p) => `\x1b[0m${ci(`pmstatus:p0:${p}:Installing p0 (amd64)`)}`),
];

describe("reading the guest's console", () => {
    test("boot milestones begin their parts, even split mid-line across reads", () => {
        const r = new ConsoleReader();
        const text = BOOT.join("\r\n") + "\r\n";
        const signs: ConsoleSign[] = [];
        for (let i = 0; i < text.length; i += 17) signs.push(...r.feed(text.slice(i, i + 17)));
        expect(signs).toEqual([{ reach: "linux" }, { reach: "services" }, { reach: "network" }]);
    });

    test("each apt install is a percentage, a share for the download and the rest for dpkg: the first is the desktop's packages, the next Helium's", () => {
        const r = new ConsoleReader();
        const signs = r.feed([...BOOT, ...install([0, 50, 100], [0, 40.5, 100]), ...install([], [20, 100])].join("\n") + "\n");
        const pct = (part: string) => signs.filter((s): s is { progress: never; percent: number } => "progress" in s && s.progress === part).map((s) => Math.floor(s.percent));
        expect(signs).toContainEqual({ reach: "packages" });
        expect(pct("packages")).toEqual([0, 0, 17, 35, 35, 61, 100]);
        // nothing to download (all cached): dpkg's progress starts past the download's half
        expect(pct("browser")).toEqual([0, 48, 100]);
    });

    test("apt-get update's download is the package lists' percentage; malformed status lines say nothing", () => {
        const r = new ConsoleReader();
        expect(r.feed([ci("dlstatus:1:12.5:Retrieving file 1 of 9"), ci("pmstatus:x:50:y"), ci("dlstatus:x:NaN:y"), ci("dlstatus:x::y")].join("\n") + "\n")).toEqual([
            { progress: "lists", percent: 12.5 },
        ]);
    });

    test("a runaway line is cut, not buffered without end", () => {
        const r = new ConsoleReader();
        r.feed("x".repeat(1_000_000));
        expect(r.feed("\n[    0.000000] Linux version 6\n")).toEqual([{ reach: "linux" }]);
    });

    test("following the console file delivers what's appended, and stops for good", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-tail-"));
        const file = path.join(dir, "console.log");
        let got = "";
        const stop = tailFile(file, (t) => (got += t), 10);
        try {
            fs.writeFileSync(file, "one\n");
            await until(() => got === "one\n");
            fs.appendFileSync(file, "two ü\n");
            await until(() => got === "one\ntwo ü\n");
            stop();
            fs.appendFileSync(file, "three\n");
            await new Promise((ok) => setTimeout(ok, 50));
            expect(got).toBe("one\ntwo ü\n");
        } finally {
            stop();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
