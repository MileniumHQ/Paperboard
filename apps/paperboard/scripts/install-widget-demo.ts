#!/usr/bin/env bun
// Builds the Widget Demo fixture (dev/widget-demo) and installs it into a
// Paperboard data dir, so Home has widgets to test against without a
// released panel.
//
//   bun scripts/install-widget-demo.ts --dir /tmp/pb-dev     install or replace
//   bun scripts/install-widget-demo.ts --dir /tmp/pb-dev --remove
import { resolve } from "node:path";
import { installDevPanel } from "./devPanel";

await installDevPanel({
    source: resolve(import.meta.dir, "../dev/widget-demo"),
    pages: ["panel.ts", "widgets.ts"],
    service: "service.ts",
    html: ["index.html", "widget.html"],
});
