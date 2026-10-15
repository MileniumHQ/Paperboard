#!/usr/bin/env bun
// Builds the API Demo fixture (dev/api-demo) and installs it into a
// Paperboard data dir: a panel that exercises exporting and importing
// files and backups.
//
//   bun scripts/install-api-demo.ts --dir /tmp/pb-dev     install or replace
//   bun scripts/install-api-demo.ts --dir /tmp/pb-dev --remove
import { resolve } from "node:path";
import { installDevPanel } from "./devPanel";

await installDevPanel({
    source: resolve(import.meta.dir, "../dev/api-demo"),
    pages: ["panel.ts"],
    service: "service.ts",
    html: ["index.html"],
});
