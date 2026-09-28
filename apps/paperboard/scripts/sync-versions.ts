import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

const targets: Array<{ file: string; path: string }> = [
  { file: "apps/paperboard/package.json", path: "version" },
  { file: "packages/paperapi/package.json", path: "version" },
  { file: "packages/paperui/package.json", path: "version" },
  { file: "panels/dev.paperboard.actions/manifest.json", path: "version" },
  { file: "panels/dev.paperboard.botcreator/manifest.json", path: "version" },
  { file: "panels/dev.paperboard.gameserver/manifest.json", path: "version" },
  { file: "panels/dev.paperboard.terminal/manifest.json", path: "version" },
];

const versionArg = process.argv.find((a) => a.startsWith("--version="));
if (!versionArg) {
  console.error("usage: bun scripts/sync-versions.ts --version=0.1.0");
  process.exit(1);
}
const version = versionArg.slice("--version=".length);
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`invalid version string: ${version}`);
  process.exit(1);
}

for (const target of targets) {
  const abs = resolve(root, target.file);
  const json = JSON.parse(readFileSync(abs, "utf8"));
  if (json[target.path] === version) {
    console.log(`ℹ ${target.file} already ${version}`);
    continue;
  }
  json[target.path] = version;
  writeFileSync(abs, `${JSON.stringify(json, null, 4)}\n`);
  console.log(`✓ ${target.file} → ${version}`);
}