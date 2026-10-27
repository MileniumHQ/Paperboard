// Scratch dev helper: replace the guest agent in the running VM and restart it.
//   bun computer/host/push.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const state = JSON.parse(readFileSync(process.env.PB_COMPUTER_STATE ?? "/var/tmp/pb-computer/vm/state.json", "utf8"));
const source = readFileSync(resolve(import.meta.dir, "../guest/agent.py")).toString("base64");
const call = (tool: string, args: object) =>
    fetch(`http://127.0.0.1:${state.port}/call`, {
        method: "POST",
        headers: { Authorization: `Bearer ${state.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tool, args }),
        signal: AbortSignal.timeout(30_000),
    }).then((r) => r.json());

// write, then exit the service a moment later so systemd restarts it on the new code
// $PPID is the agent itself (the shell's parent); systemd restarts it on the new code
const res = await call("shell", {
    command: `echo '${source}' | base64 -d > /opt/paperboard/agent.py.new && python3 -m py_compile /opt/paperboard/agent.py.new && mv /opt/paperboard/agent.py.new /opt/paperboard/agent.py && { (sleep 0.5; kill $PPID) >/dev/null 2>&1 & } && echo staged`,
});
console.log(res);
for (let i = 0; i < 30; i++) {
    await Bun.sleep(1000);
    const ok = await fetch(`http://127.0.0.1:${state.port}/health`, { headers: { Authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);
    if (ok && i > 1) {
        console.log("agent restarted");
        process.exit(0);
    }
}
throw new Error("agent did not come back");
