// Sets the app's version family: the app, its daemon's User-Agent (and the
// gameserver panel's, which identifies the app), the shared libraries and the
// registry. First-party panel manifests version independently and are bumped
// on their own. Only the version text changes; each file keeps its formatting.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

const JSON_VERSION = /("version"\s*:\s*")([^"]*)(")/;
const USER_AGENT = /(MileniumHQ\/Paperboard\/)([^ "]+)( )/;

const targets: Array<{ file: string; pattern: RegExp }> = [
  { file: "package.json", pattern: JSON_VERSION },
  { file: "apps/paperboard/package.json", pattern: JSON_VERSION },
  { file: "apps/paperboard/papercrane/userAgent.ts", pattern: USER_AGENT },
  { file: "apps/paperdocs/package.json", pattern: JSON_VERSION },
  { file: "apps/origami/package.json", pattern: JSON_VERSION },
  { file: "apps/origami/library/package.json", pattern: JSON_VERSION },
  { file: "packages/paperapi/package.json", pattern: JSON_VERSION },
  { file: "packages/paperui/package.json", pattern: JSON_VERSION },
  { file: "packages/create-panel/package.json", pattern: JSON_VERSION },
  { file: "panels/dev.paperboard.gameserver/src/lib/userAgent.ts", pattern: USER_AGENT },
];

const versionArg = process.argv.find((a) => a.startsWith("--version="));
if (!versionArg) {
  console.error("usage: bun scripts/sync-versions.ts --version=0.2.0");
  process.exit(1);
}
const version = versionArg.slice("--version=".length);
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`invalid version string: ${version}`);
  process.exit(1);
}

for (const target of targets) {
  const abs = resolve(root, target.file);
  const text = readFileSync(abs, "utf8");
  const found = target.pattern.exec(text);
  if (!found) {
    console.error(`✗ ${target.file} has no version to set`);
    process.exit(1);
  }
  if (found[2] === version) {
    console.log(`ℹ ${target.file} already ${version}`);
    continue;
  }
  writeFileSync(abs, text.replace(target.pattern, `$1${version}$3`));
  console.log(`✓ ${target.file} ${found[2]} → ${version}`);
}
