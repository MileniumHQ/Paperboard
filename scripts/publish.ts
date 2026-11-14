#!/usr/bin/env bun
/**
 * publish.ts: interactive build & publish console for Paperboard.
 *
 *   bun scripts/publish.ts                            # interactive menu (needs a TTY)
 *   bun scripts/publish.ts ci-build --target <t>      # the release workflow's build
 *   bun scripts/publish.ts republish-index [--yes]    # re-index a public release
 *
 * Nothing leaves the machine except through the publish flows, and each one
 * asks before anything uploads: Publish binaries asks twice (build in the
 * release workflow, then make the draft public), the others once. Pure
 * release-math (tags, asset names, URLs, latest.yml, KV merges) lives in
 * publishLib.ts, tested in publishLib.test.ts; the flows live in publish/:
 *   binaries.ts  Build binaries, ci-build
 *   release.ts   Publish binaries, republish-index
 *   panels.ts    Publish panels, Unlist panels
 *   packages.ts  Publish packages
 *
 * Auth is the operator's own sign-in, per run, never stored by this script:
 *   Cloudflare (KV, R2, the panel registry) … wrangler login
 *   GitHub (releases, the release workflow) … gh auth login
 *   npm (packages) ……………………………………… npm login
 * There are no key files. .dev.vars / R2_* env keys are gone on purpose.
 */

import * as p from "@clack/prompts";
import { readFileSync } from "fs";
import { join } from "path";
import { bunPinMismatch } from "./publishLib";
import { flowBuildBinaries, flowCiBuild } from "./publish/binaries";
import { cancelled, checkCancel } from "./publish/common";
import { flowPublishPackages } from "./publish/packages";
import { flowPublishPanels, flowUnlistPanels } from "./publish/panels";
import { flowPublishBinaries, flowRepublishIndex } from "./publish/release";

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const rootPackage = JSON.parse(
        readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
    ) as { packageManager?: unknown };
    const bunMismatch = bunPinMismatch(rootPackage.packageManager, Bun.version);
    if (bunMismatch) {
        console.error(bunMismatch);
        process.exit(1);
    }
    if (argv[0] === "ci-build") {
        await flowCiBuild(argv.slice(1));
        return;
    }
    if (argv[0] === "republish-index") {
        await flowRepublishIndex(argv.includes("--yes"));
        return;
    }
    if (argv.length > 0) {
        console.error(`publish.ts: unknown subcommand "${argv[0]}". Run it with no arguments for the menu, or with ci-build or republish-index.`);
        process.exit(2);
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error("publish.ts is interactive — run it in a terminal (or `bun scripts/publish.ts republish-index --yes` headless).");
        process.exit(1);
    }

    p.intro("Paperboard publisher");
    const choice = checkCancel(
        await p.select({
            message: "What would you like to do?",
            options: [
                { value: "build", label: "Build binaries", hint: "local only — pick app/server targets" },
                { value: "publish-bin", label: "Publish binaries", hint: "release workflow builds all, confirm twice, go live" },
                { value: "panels", label: "Publish panels", hint: "pick panels, pack, upload to registry" },
                { value: "unlist", label: "Unlist panels", hint: "take panels off the store, keep their records" },
                { value: "packages", label: "Publish packages", hint: "pick npm packages, build, npm publish" },
            ],
        }),
    );

    switch (choice) {
        case "build":
            await flowBuildBinaries();
            break;
        case "publish-bin":
            await flowPublishBinaries();
            break;
        case "panels":
            await flowPublishPanels();
            break;
        case "unlist":
            await flowUnlistPanels();
            break;
        case "packages":
            await flowPublishPackages();
            break;
        default:
            cancelled();
    }
}

main().catch((err) => {
    console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
