// A Paperboard daemon from this checkout's source, in a process of its own,
// for test/helpers/crane.ts: it serves headless on a free loopback port over
// PAPERBOARD_DIR, says the port over IPC once it listens, issues the panel
// tokens it is asked for, and stops when told or when its parent goes.
//
// The daemon is loaded by a path the typechecker does not follow: it is
// another target's source, typechecked by its own gate step.
import path from "node:path";

interface ServerInstance {
    localPort: number;
    server: { once(event: "close", cb: () => void): void };
    auth: { issuePanelToken(panelId: string): string };
    stop(): void;
}

const entry: string = path.resolve(import.meta.dir, "../../../../apps/paperboard/papercrane/index.ts");
const { startPaperCraneServer } = (await import(entry)) as { startPaperCraneServer(options: Record<string, unknown>): Promise<ServerInstance> };
const instance = await startPaperCraneServer({ host: "127.0.0.1", port: 0, headless: true, advertise: false });

function stop(): void {
    instance.server.once("close", () => process.exit(0));
    instance.stop();
}
process.on("message", (message: any) => {
    if (message?.type === "token") process.send!({ type: "token", id: message.id, token: instance.auth.issuePanelToken(message.panelId) });
    if (message?.type === "stop") stop();
});
process.on("disconnect", stop);
process.send!({ type: "listening", port: instance.localPort });
