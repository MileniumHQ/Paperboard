// The SDK's declared result types match what the daemon resolves with
// (bun test, checked by tsc in the paperapi build). panelsApi.install was
// typed boolean but resolves with the manifest; config.set and
// secretsApi.set were typed void but resolve with true. A wrong type here
// fails `tsc --noEmit` before any test runs.
import { test, expect } from "bun:test";
import { config } from "../src/config";
import { panelsApi, type PanelItem } from "../src/panels";
import { secretsApi } from "../src/secrets";

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Result<F extends (...args: any[]) => Promise<unknown>> = Awaited<ReturnType<F>>;

const installResolvesManifest: Same<Result<typeof panelsApi.install>, PanelItem> = true;
const configSetResolvesTrue: Same<Result<typeof config.set>, true> = true;
const secretsSetResolvesTrue: Same<Result<typeof secretsApi.set>, true> = true;

test("result types name the values the daemon resolves with", () => {
    expect([installResolvesManifest, configSetResolvesTrue, secretsSetResolvesTrue]).toEqual([true, true, true]);
});
