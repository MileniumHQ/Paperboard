// An event that didn't reach Blocks is said where the person looks: what
// they built on it didn't run, and the server's console says why.
import { expect, test } from "bun:test";
import type { BackupEnded, BlocksProjectHandle } from "@mileniumhq/paperapi";
import { fireBackupEnded, fireTrigger } from "../src/service/blocks";
import { TRIGGER_IDS } from "../src/service/contract";

const refusing = { fire: () => Promise.reject(new Error("Blocks is not running")) } as unknown as BlocksProjectHandle;

test("a trigger or a backup's end that Blocks refused reaches the server's failure report", async () => {
    const said: string[] = [];
    const failed = (what: string, err: unknown) => said.push(`${what}: ${(err as Error).message}`);
    fireTrigger(refusing, TRIGGER_IDS.serverStarted, undefined, failed);
    fireBackupEnded(refusing, { ok: false, error: "disk full" } as BackupEnded, failed);
    await Promise.resolve();
    await Promise.resolve();
    expect(said).toEqual([
        `${TRIGGER_IDS.serverStarted} did not reach Blocks: Blocks is not running`,
        expect.stringMatching(/did not reach Blocks: Blocks is not running$/),
    ]);
});
