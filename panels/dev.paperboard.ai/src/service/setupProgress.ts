// The setup's progress as the host can see it. The long steps (starting the
// VM, installing in it) are split into parts, each begun by something the
// host observes: QEMU running, milestones on the guest's serial console
// (the kernel, systemd, cloud-init's stages, apt's output), the guest's
// fetches from the first-boot seed, and one ping once its browser is in.
// apt's output also gives the package installs a real percentage. A part
// only moves forward, so a late or repeated sign never sets progress back.

import { SETUP_PARTS, SETUP_STEPS, type SetupPartId, type SetupStep, type SetupStepId, type StepStatus } from "../contract";

/** The seed paths the guest fetches in order during its first boot, and the part each one begins. */
export const SEED_PARTS: Readonly<Record<string, SetupPartId>> = {
    "/meta-data": "setup",
    "/user-data": "lists",
    "/agent.py": "hands",
    "/helium.deb": "browser",
    "/progress/browser": "desktop",
};

export function freshSteps(): SetupStep[] {
    return SETUP_STEPS.map((id) => ({ id, status: "waiting", percent: null, parts: SETUP_PARTS[id].map((p) => ({ id: p, status: "waiting", percent: null })) }));
}

const stepOf = (part: SetupPartId): SetupStepId => SETUP_STEPS.find((s) => SETUP_PARTS[s].includes(part))!;

/** A whole step's new status; its parts follow (done: all done; failed: the one under way failed). */
export function setStep(steps: SetupStep[], id: SetupStepId, status: StepStatus, percent: number | null): SetupStep[] {
    return steps.map((s) => {
        if (s.id !== id) return s;
        const parts =
            status === "done"
                ? s.parts.map((p) => ({ ...p, status: "done" as const, percent: p.percent === null ? null : 100 }))
                : status === "failed"
                  ? s.parts.map((p) => (p.status === "running" ? { ...p, status: "failed" as const } : p))
                  : s.parts;
        return { ...s, status, percent, parts };
    });
}

/**
 * `part` has begun: the parts before it are done, and so is a step still
 * running before its own (the guest fetching its setup means it booted).
 * Nothing moves back, and a finished or failed step is left as it is.
 */
export function reach(steps: SetupStep[], part: SetupPartId): SetupStep[] {
    const id = stepOf(part);
    const at = SETUP_STEPS.indexOf(id);
    const own = steps.find((s) => s.id === id);
    if (!own || own.status === "done" || own.status === "failed") return steps;
    const k = SETUP_PARTS[id].indexOf(part);
    if (own.parts.some((p, i) => i >= k && p.status !== "waiting")) return steps; // already here or past it
    return steps.map((s) => {
        const i = SETUP_STEPS.indexOf(s.id);
        if (i < at && s.status === "running") return setStep([s], s.id, "done", 100)[0]!;
        if (s.id !== id) return s;
        return {
            ...s,
            status: "running",
            parts: s.parts.map((p, j) => (j < k ? { ...p, status: "done", percent: p.percent === null ? null : 100 } : j === k ? { ...p, status: "running" } : p)),
        };
    });
}

/** How far a running part is; only forward, and only while it runs. */
export function progress(steps: SetupStep[], part: SetupPartId, percent: number): SetupStep[] {
    const id = stepOf(part);
    const p = steps.find((s) => s.id === id)?.parts.find((x) => x.id === part);
    const pct = Math.max(0, Math.min(100, Math.floor(percent)));
    if (!p || p.status !== "running" || (p.percent !== null && pct <= p.percent)) return steps;
    return steps.map((s) => (s.id !== id ? s : { ...s, parts: s.parts.map((x) => (x.id === part ? { ...x, percent: pct } : x)) }));
}

export type ConsoleSign = { reach: SetupPartId } | { progress: SetupPartId; percent: number };

/** a console line longer than this is cut: the guest's console is not trusted to be tidy */
const LINE_MAX = 4096;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** how much of an apt install's percentage is the download: from a second to half a minute on first boots seen, while dpkg takes about half a minute */
const DOWNLOAD_SHARE = 0.35;

/**
 * Reads the guest's serial console as it's written and says what it shows. Boot milestones begin the boot's
 * parts. apt-get update's download (dlstatus, before any install) is the package lists' percentage. Each apt
 * install starts with "N newly installed" and then reports its own progress (it runs with
 * APT::Status-Fd on the console): dlstatus for the download, pmstatus for dpkg. The first install is the
 * desktop's packages, a later one is Helium's.
 */
export class ConsoleReader {
    private partial = "";
    private apt: SetupPartId | null = null;
    private installs = 0;

    feed(text: string): ConsoleSign[] {
        const lines = (this.partial + text).split(/\r?\n/);
        this.partial = (lines.pop() ?? "").slice(-LINE_MAX);
        return lines.flatMap((l) => this.line(l.slice(0, LINE_MAX).replace(ANSI, "")));
    }

    private line(l: string): ConsoleSign[] {
        if (/\] Linux version /.test(l)) return [{ reach: "linux" }];
        if (/systemd\[1\]: Detected virtualization/.test(l)) return [{ reach: "services" }];
        if (/running 'init-local'/.test(l)) return [{ reach: "network" }];
        if (/cloud-init\[\d+\]: \d+ upgraded, \d+ newly installed/.test(l)) {
            const part: SetupPartId = this.installs++ === 0 ? "packages" : "browser";
            this.apt = part;
            return part === "packages" ? [{ reach: "packages" }, { progress: part, percent: 0 }] : [{ progress: part, percent: 0 }];
        }
        const s = /cloud-init\[\d+\]: (dl|pm)status:[^:]*:([\d.]+):/.exec(l);
        if (!s) return [];
        const pct = Math.min(100, Number(s[2]));
        if (!Number.isFinite(pct)) return [];
        if (!this.apt) return s[1] === "dl" ? [{ progress: "lists", percent: pct }] : [];
        // dpkg's progress means the download is done, even when nothing had to be downloaded
        const percent = s[1] === "dl" ? pct * DOWNLOAD_SHARE : 100 * DOWNLOAD_SHARE + pct * (1 - DOWNLOAD_SHARE);
        return [{ progress: this.apt, percent }];
    }
}
