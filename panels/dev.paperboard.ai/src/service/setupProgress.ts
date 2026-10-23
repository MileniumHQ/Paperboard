// The setup's progress as the host can see it. The long steps (starting the
// VM, installing in it) are split into parts, each begun by something the
// host observes: QEMU running, the guest fetching from the first-boot seed,
// and one ping the guest sends once its browser is installed. A part only
// moves forward, so a late or repeated request never sets progress back.

import { SETUP_PARTS, SETUP_STEPS, type SetupPartId, type SetupStep, type SetupStepId, type StepStatus } from "../contract";

/** The seed paths the guest fetches in order during its first boot, and the part each one begins. */
export const SEED_PARTS: Readonly<Record<string, SetupPartId>> = {
    "/meta-data": "setup",
    "/user-data": "packages",
    "/agent.py": "hands",
    "/helium.deb": "browser",
    "/progress/browser": "desktop",
};

export function freshSteps(): SetupStep[] {
    return SETUP_STEPS.map((id) => ({ id, status: "waiting", percent: null, parts: SETUP_PARTS[id].map((p) => ({ id: p, status: "waiting" })) }));
}

const stepOf = (part: SetupPartId): SetupStepId => SETUP_STEPS.find((s) => SETUP_PARTS[s].includes(part))!;

/** A whole step's new status; its parts follow (done: all done; failed: the one under way failed). */
export function setStep(steps: SetupStep[], id: SetupStepId, status: StepStatus, percent: number | null): SetupStep[] {
    return steps.map((s) => {
        if (s.id !== id) return s;
        const parts =
            status === "done"
                ? s.parts.map((p) => ({ ...p, status: "done" as const }))
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
        return { ...s, status: "running", parts: s.parts.map((p, j) => ({ ...p, status: j < k ? "done" : j === k ? "running" : "waiting" })) };
    });
}
