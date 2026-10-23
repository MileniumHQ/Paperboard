import { describe, expect, test } from "bun:test";
import type { SetupStep } from "../src/contract";
import { freshSteps, reach, setStep } from "../src/service/setupProgress";

const view = (steps: SetupStep[]) => Object.fromEntries(steps.map((s) => [s.id, [s.status, ...s.parts.map((p) => `${p.id}:${p.status}`)]]));

describe("the setup's parts", () => {
    test("the guest's fetches walk the boot and install parts forward, and finishing boot follows from its setup being read", () => {
        let s = freshSteps();
        for (const id of ["image", "browser", "disk"] as const) s = setStep(s, id, "done", 100);
        s = reach(s, "power");
        expect(view(s).boot).toEqual(["running", "power:running", "debian:waiting", "setup:waiting"]);
        s = reach(s, "setup"); // the meta-data fetch: Debian is up
        expect(view(s).boot).toEqual(["running", "power:done", "debian:done", "setup:running"]);
        s = reach(s, "packages"); // the user-data fetch
        expect(view(s).boot).toEqual(["done", "power:done", "debian:done", "setup:done"]);
        expect(view(s).install).toEqual(["running", "packages:running", "hands:waiting", "browser:waiting", "desktop:waiting"]);
        s = reach(s, "browser");
        expect(view(s).install).toEqual(["running", "packages:done", "hands:done", "browser:running", "desktop:waiting"]);
    });

    test("a late or repeated fetch never moves progress back, and a finished or failed step is left alone", () => {
        let s = reach(reach(freshSteps(), "power"), "packages");
        s = reach(s, "browser");
        expect(reach(s, "hands")).toBe(s);
        expect(reach(s, "browser")).toBe(s);
        const failed = setStep(s, "install", "failed", null);
        expect(view(failed).install).toEqual(["failed", "packages:done", "hands:done", "browser:failed", "desktop:waiting"]);
        expect(reach(failed, "desktop")).toBe(failed);
        const done = setStep(s, "install", "done", 100);
        expect(view(done).install.slice(1).every((p) => String(p).endsWith(":done"))).toBe(true);
    });
});
