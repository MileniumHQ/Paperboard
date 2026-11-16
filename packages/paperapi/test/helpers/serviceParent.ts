// Stands in for a daemon that dies with its services running: it spawns
// test/helpers/panelService.ts with the process channel the daemon gives a
// service, prints the service's pid once the service is ready, and then
// waits to be killed.
import { spawn } from "node:child_process";
import { SERVICE_SCRIPT } from "./daemon";

const child = spawn(process.execPath, [SERVICE_SCRIPT], { env: process.env, stdio: ["ignore", "pipe", "inherit", "ipc"] });
child.stdout!.on("data", (chunk: Buffer) => {
    if (chunk.toString().includes("READY")) process.stdout.write(`SERVICE ${child.pid}\n`);
});
child.once("exit", (code) => {
    process.stderr.write(`the service exited (${code}) while its parent was alive\n`);
    process.exit(1);
});
