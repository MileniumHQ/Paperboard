// A browser on a system that won't let it sandbox itself (Ubuntu 24.04's
// AppArmor rule): Chromium says so on stderr and exits. It logs its argv.
import fs from "node:fs";
import path from "node:path";
fs.appendFileSync(path.join(process.env.FAKE_DIR, "helium.jsonl"), JSON.stringify(process.argv.slice(2)) + "\n");
process.stderr.write("[0101/000000.000000:FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox! Update your kernel or see https://chromium.googlesource.com/chromium/src/+/main/docs/linux/suid_sandbox_development.md for more information on developing with the SUID sandbox. If you want to live dangerously and need an immediate workaround, you can try using --no-sandbox.\n");
process.exit(1);
