// The desktop app's side of starting a workload, run by the real Electron
// binary in node mode (tests/desktopSupervisor.test.ts). Bundled next to the
// supervisor entry the way electron-vite bundles the app's main process.
import { spawnSupervisedClient } from "../../papercrane/engineSupervisor";

const [id, command, out] = process.argv.slice(2);
(async () => {
    await spawnSupervisedClient(id!, {
        id,
        type: "child_process",
        command,
        args: ["-e", `require("fs").writeFileSync(${JSON.stringify(out)}, JSON.stringify({ pid: process.pid, runAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null })); setInterval(() => {}, 1000);`],
    }, new Map());
    console.log("started");
    // stays up like the app does, until the test kills it
    setInterval(() => undefined, 1000);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
