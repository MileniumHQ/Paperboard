// The desktop app's supervisor (supervisorLaunch.ts): the app's own binary
// runs this file in node mode, detached, so the workload outlives the app.
import { runSupervisor } from "./supervisor";

// node mode is how this process was started, not something its workload
// inherits: an Electron app started from a terminal would run as node
delete process.env.ELECTRON_RUN_AS_NODE;

const at = process.argv.indexOf("--supervise");
const id = at === -1 ? undefined : process.argv[at + 1];
if (!id) {
    console.error("[supervisor] started without --supervise <id>");
    process.exit(1);
}
runSupervisor(id).catch((err) => {
    console.error(`[supervisor] ${id} failed:`, err);
    process.exit(1);
});
