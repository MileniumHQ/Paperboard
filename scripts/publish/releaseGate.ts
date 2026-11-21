// releaseGate: a release builds only a commit the whole gate passed
// (publishLib.ts releaseGateProblem). Publish binaries asks it before it
// starts the release workflow, and the workflow asks it again before it
// builds, since a run can be started by hand.
//
//   bun scripts/publish/releaseGate.ts <commit>
//
// Needs gh signed in, or GH_TOKEN with actions: read. Loads nothing the
// workspace installs, so the workflow runs it before `bun install`.
import { commitShaProblem, GH_REPO, releaseGateProblem, type GateRun } from "./publishLib";

// The Gate workflow's runs at exactly this commit, newest first.
export async function gateRuns(commit: string): Promise<GateRun[]> {
    const proc = Bun.spawn(
        ["gh", "api", `repos/${GH_REPO}/actions/workflows/gate.yml/runs?head_sha=${commit}&per_page=100`, "--jq", ".workflow_runs"],
        { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
    );
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) throw new Error(`Couldn't list the Gate runs of ${commit} (gh exited ${code}): ${err.trim()}`);
    return JSON.parse(out) as GateRun[];
}

export async function releaseGateCheck(commit: string): Promise<string | null> {
    // before gateRuns: nothing unchecked goes into the API's URL
    const sha = commitShaProblem(commit);
    if (sha) return sha;
    return releaseGateProblem(commit, await gateRuns(commit));
}

if (import.meta.main) {
    const commit = process.argv[2];
    if (!commit) {
        console.error("usage: bun scripts/publish/releaseGate.ts <commit>");
        process.exit(2);
    }
    const problem = await releaseGateCheck(commit);
    if (problem) {
        console.error(`Refusing to release: ${problem}`);
        process.exit(1);
    }
    console.log(`${commit} passed a full Gate run.`);
}
