// npm install -g @mileniumhq/paperboard installs Paperboard itself, with the
// same script `curl -fsSL https://i.paperboard.dev | sh` runs. Installing
// the package is the consent.
//
// It does nothing when:
//   - npx is the one installing the package (npm_command "exec"): plain
//     `npx @mileniumhq/paperboard` asks before it installs anything, and
//     `npx @mileniumhq/paperboard install` installs when it runs;
//   - the package isn't in a node_modules folder: that's this repository's
//     own workspace, where `bun install` must never install Paperboard.
//
// A failed install fails `npm install`, with the installer's own message.
import { spawnSync } from "node:child_process";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
if (process.env.npm_command === "exec" || !here.split(sep).includes("node_modules")) process.exit(0);

const windows = process.platform === "win32";
const [command, args] = windows
    ? ["powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "install.ps1")]]
    : ["sh", [join(here, "install.sh")]];
const run = spawnSync(command, args, { stdio: "inherit" });
if (run.error) {
    console.error(`Paperboard was not installed: could not run ${command} (${run.error.message}).`);
    process.exit(1);
}
process.exit(run.status ?? 1);
