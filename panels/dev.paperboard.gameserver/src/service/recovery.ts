import { serverLocal } from "./scope";
import type { ServiceContext } from "./api";
import { recoverInterruptedInstall } from "../games/minecraft/softwareInstall";
import { liveRecoveryDeps } from "./softwareInstallDeps";
import { recoverInterruptedModpack } from "./modpacks";
import { liveModpackRecoveryDeps } from "./modpackDeps";
import { setRecoveryBlock } from "./recoveryState";
import { appendCapped, type GameServerState } from "./types";

const local = serverLocal(() => ({ settling: null as Promise<boolean> | null }));

type Recovered = { committed: unknown[]; rolledBack: unknown[]; discarded: unknown[] };

export interface RecoverySteps {
    install(): Promise<Recovered>;
    modpack(): Promise<Recovered>;
}

const liveSteps: RecoverySteps = {
    install: () => recoverInterruptedInstall(liveRecoveryDeps()),
    modpack: () => recoverInterruptedModpack(liveModpackRecoveryDeps()),
};

/**
 * Settles what an interrupted install and then an interrupted modpack
 * change left in the server folder. A step that fails blocks starting the
 * server and every install (recoveryState) and shows the reason in state
 * until a retry succeeds; the modpack step waits for the install step, as
 * a pack change may depend on it. Resolves true when everything is settled.
 */
export function settleInterruptedWork(
    ctx: ServiceContext<GameServerState>,
    steps: RecoverySteps = liveSteps,
): Promise<boolean> {
    if (local().settling) return local().settling!;
    local().settling = run(ctx, steps).finally(() => {
        local().settling = null;
    });
    return local().settling!;
}

async function run(ctx: ServiceContext<GameServerState>, steps: RecoverySteps): Promise<boolean> {
    for (const [what, step] of [
        ["install", steps.install],
        ["modpack change", steps.modpack],
    ] as const) {
        try {
            const recovered = await step();
            if (recovered.committed.length || recovered.rolledBack.length || recovered.discarded.length) {
                console.log(`[gameserver] settled interrupted ${what}:`, JSON.stringify(recovered));
            }
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            console.error(`[gameserver] interrupted ${what} could not be settled:`, reason);
            setRecoveryBlock(`${what}: ${reason}`);
            ctx.setState({
                recoveryBlock: `An interrupted ${what} could not be cleaned up: ${reason}`,
                serverEntries: appendCapped(ctx.state.serverEntries, {
                    type: "error",
                    content: `[Server] An interrupted ${what} could not be cleaned up: ${reason}`,
                }),
            });
            return false;
        }
    }
    setRecoveryBlock(null);
    if (ctx.state.recoveryBlock !== null) ctx.setState({ recoveryBlock: null });
    return true;
}
