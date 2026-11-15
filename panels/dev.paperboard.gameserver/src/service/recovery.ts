import type { Server } from "./server";
import { errorMessage } from "@mileniumhq/paperapi";
import { minecraftOf } from "../games/minecraft/state";
import { recoverInterruptedInstall } from "../games/minecraft/softwareInstall";
import { liveRecoveryDeps } from "./softwareInstallDeps";
import { recoverInterruptedModpack } from "./modpacks";
import { liveModpackRecoveryDeps } from "./modpackDeps";
import { appendCapped } from "./types";

type Recovered = { committed: unknown[]; rolledBack: unknown[]; discarded: unknown[] };

export interface RecoverySteps {
    install(): Promise<Recovered>;
    modpack(): Promise<Recovered>;
}

const liveSteps = (ctx: Server): RecoverySteps => ({
    install: () => recoverInterruptedInstall(liveRecoveryDeps(ctx)),
    modpack: () => recoverInterruptedModpack(liveModpackRecoveryDeps(ctx)),
});

/**
 * Settles what an interrupted install and then an interrupted modpack
 * change left in the server folder. A step that fails blocks starting the
 * server and every install (assertRecoverySettled) and shows the reason in state
 * until a retry succeeds; the modpack step waits for the install step, as
 * a pack change may depend on it. Resolves true when everything is settled.
 */
export function settleInterruptedWork(
    ctx: Server,
    steps: RecoverySteps = liveSteps(ctx),
): Promise<boolean> {
    const state = minecraftOf(ctx);
    state.settling ??= run(ctx, steps).finally(() => {
        state.settling = null;
    });
    return state.settling;
}

async function run(ctx: Server, steps: RecoverySteps): Promise<boolean> {
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
            const reason = errorMessage(err);
            console.error(`[gameserver] interrupted ${what} could not be settled:`, reason);
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
    if (ctx.state.recoveryBlock !== null) ctx.setState({ recoveryBlock: null });
    return true;
}
