// spawn helper for detached supervisors
import { spawn } from "child_process";
import { SupervisedProcessClient } from "./supervisor";
import { EmbeddedSupervisor, isEmbeddedHost } from "./embeddedSupervisor";

export interface PreListeners {
    onData?: (data: string) => void;
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
    onExit?: (code: number) => void;
}

export async function spawnSupervisedClient(
    id: string,
    supervisorConfig: any,
    clientsMap: Map<string, any>,
    preListeners?: PreListeners,
): Promise<any> {
    const existing = clientsMap.get(id);
    if (existing) {
        existing.destroy();
        clientsMap.delete(id);
    }

    // embedded host supervises in-process, it cannot spawn itself
    if (isEmbeddedHost()) {
        const embedded = new EmbeddedSupervisor(id, supervisorConfig);
        clientsMap.set(id, embedded);

        if (preListeners?.onData) embedded.on("data", preListeners.onData);
        if (preListeners?.onStdout) embedded.on("stdout", preListeners.onStdout);
        if (preListeners?.onStderr) embedded.on("stderr", preListeners.onStderr);
        if (preListeners?.onExit)
            embedded.on("exit", (code: number) => {
                clientsMap.delete(id);
                preListeners!.onExit!(code);
            });

        await embedded.connect();
        return embedded;
    }

    const execPath = process.execPath;

    const supervisorProc = spawn(execPath, ["--supervise", id], {
        detached: true,
        stdio: ["pipe", "ignore", "ignore"],
        windowsHide: true,
    });

    if (supervisorProc.stdin) {
        supervisorProc.stdin.write(JSON.stringify(supervisorConfig));
        supervisorProc.stdin.end();
    }
    supervisorProc.unref();

    const client = new SupervisedProcessClient(id);
    clientsMap.set(id, client);

    // listeners first so initial output is never missed
    if (preListeners?.onData) client.on("data", preListeners.onData);
    if (preListeners?.onStdout) client.on("stdout", preListeners.onStdout);
    if (preListeners?.onStderr) client.on("stderr", preListeners.onStderr);
    if (preListeners?.onExit) client.on("exit", preListeners.onExit);

    for (let i = 0; i < 40; i++) {
        const connected = await client.connect();
        if (connected) break;
        await new Promise((r) => setTimeout(r, 50));
    }

    return client;
}
