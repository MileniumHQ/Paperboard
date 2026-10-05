// Local AUR preparation only. AUR git transport is deliberately separate.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, cpSync, openSync, readSync, closeSync, fstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { assetFileName, releaseAssetUrl, isValidVersionSegment, type DlApp } from "./publishLib";

const root = resolve(import.meta.dir, "..");
function sha256(file: string): string {
    const fd = openSync(file, "r");
    try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > 2 * 1024 ** 3) throw new Error(`Not a regular artifact under 2 GiB: ${file}`);
        const hash = createHash("sha256");
        const buffer = Buffer.alloc(1024 * 1024);
        let bytes: number;
        let total = 0;
        while ((bytes = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
            total += bytes;
            if (total > 2 * 1024 ** 3) throw new Error(`Artifact grew beyond 2 GiB: ${file}`);
            hash.update(buffer.subarray(0, bytes));
        }
        return hash.digest("hex");
    } finally { closeSync(fd); }
}
const recipes = [
    { app: "pb" as DlApp, name: "paperboard-bin", command: "paperboard", description: "Run and manage tools locally", depends: ["glibc", "gcc-libs", "alsa-lib", "gtk3", "nss", "libxss", "libxtst", "xdg-utils"], files: ["paperboard", "paperboard.desktop", "paperboard.png", "LICENSE"] },
    { app: "crane" as DlApp, name: "papercrane-bin", command: "papercrane", description: "Paperboard server daemon for headless computers", depends: ["glibc", "gcc-libs"], files: ["papercrane", "papercrane.service", "LICENSE"] },
];

export function prepareAur(options: { version: string; assets: string; output: string; pkgrel?: number }): void {
    const { version, assets, output } = options;
    const pkgrel = options.pkgrel ?? 1;
    if (!isValidVersionSegment(version) || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/.test(version)) throw new Error("AUR requires a semver release version");
    if (!Number.isSafeInteger(pkgrel) || pkgrel < 1) throw new Error("pkgrel must be a positive integer");
    if (existsSync(output)) throw new Error(`Output already exists: ${output}; choose a fresh directory`);
    // Validate all inputs before creating output. Never emit SKIP checksums.
    const prepared = recipes.map(recipe => ({ recipe, sources: ["x64", "arm64"].map(arch => {
        const target = `linux-${arch}` as "linux-x64" | "linux-arm64";
        const file = assetFileName(recipe.app, target);
        return { arch: arch === "x64" ? "x86_64" : "aarch64", file, hash: sha256(join(assets, file)), url: releaseAssetUrl(recipe.app, version, file) };
    }) }));
    mkdirSync(output);
    for (const { recipe, sources } of prepared) {
        const directory = join(output, recipe.name);
        mkdirSync(directory, { recursive: true });
        for (const file of recipe.files) {
            const source = file === "LICENSE" ? join(root, "apps/paperboard/LICENSE") : file === "paperboard.png" ? join(root, "apps/paperboard/resources/icon.png") : join(root, "packaging/aur", file);
            cpSync(source, join(directory, file));
        }
        const quote = (value: string) => `'${value}'`;
        const lines = [
            "# Maintainer: Milenium <contact@paperboard.dev>",
            `pkgname=${recipe.name}`, `pkgver=${version.replaceAll("-", "_")}`, `pkgrel=${pkgrel}`,
            `pkgdesc=${quote(recipe.description)}`, "arch=('x86_64' 'aarch64')", "url='https://paperboard.dev'",
            "license=('custom:PolyForm-Noncommercial-1.0.0')", `depends=(${recipe.depends.map(quote).join(" ")})`,
            `provides=("${recipe.command}=\${pkgver}")`, `conflicts=('${recipe.command}')`, "options=('!strip' '!debug')",
            `source=(${recipe.files.map(quote).join(" ")})`, `sha256sums=(${recipe.files.map(file => quote(sha256(join(directory, file)))).join(" ")})`,
            ...sources.flatMap(source => [`source_${source.arch}=('${version}-${source.file}::${source.url}')`, `sha256sums_${source.arch}=('${source.hash}')`]),
        ];
        if (recipe.app === "pb") {
            lines.push(`noextract=('${version}-paperboard-linux-x64.AppImage' '${version}-paperboard-linux-arm64.AppImage')`, `
prepare() {
    case "$CARCH" in
        x86_64) _artifact="${version}-paperboard-linux-x64.AppImage" ;;
        aarch64) _artifact="${version}-paperboard-linux-arm64.AppImage" ;;
    esac
    chmod +x "$srcdir/$_artifact"
    "$srcdir/$_artifact" --appimage-extract
}

package() {
    install -dm755 "$pkgdir/opt/paperboard"
    cp -a "$srcdir/squashfs-root/." "$pkgdir/opt/paperboard/"
    install -Dm755 "$srcdir/paperboard" "$pkgdir/usr/bin/paperboard"
    install -Dm644 "$srcdir/paperboard.desktop" "$pkgdir/usr/share/applications/paperboard.desktop"
    install -Dm644 "$srcdir/paperboard.png" "$pkgdir/usr/share/icons/hicolor/512x512/apps/paperboard.png"
    install -Dm644 "$srcdir/LICENSE" "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
}`);
        } else {
            lines.push(`
package() {
    case "$CARCH" in
        x86_64) _binary=papercrane-linux-x64 ;;
        aarch64) _binary=papercrane-linux-arm64 ;;
    esac
    install -Dm755 "$srcdir/$_binary" "$pkgdir/usr/lib/papercrane/papercrane"
    install -Dm755 "$srcdir/papercrane" "$pkgdir/usr/bin/papercrane"
    install -Dm644 "$srcdir/papercrane.service" "$pkgdir/usr/lib/systemd/user/papercrane.service"
    install -Dm644 "$srcdir/LICENSE" "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
}`);
        }
        writeFileSync(join(directory, "PKGBUILD"), `${lines.join("\n")}\n`);
        const result = spawnSync("makepkg", ["--printsrcinfo"], { cwd: directory, encoding: "utf8", timeout: 30_000 });
        if (result.error || result.status !== 0) throw new Error(`makepkg --printsrcinfo failed: ${result.error?.message ?? result.stderr}`);
        writeFileSync(join(directory, ".SRCINFO"), result.stdout);
    }
}

export function runAur(args: string[], version: string): void {
    if (args.length === 1 && args[0] === "--help") {
        console.log("Local only: bun scripts/publish.ts aur --assets <release-directory> --output <new-directory> [--pkgrel <n>]");
        return;
    }
    if (args.length > 6) throw new Error("Too many AUR options (see aur --help)");
    const values = new Map<string, string>();
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        const value = args[index + 1];
        if (!["--assets", "--output", "--pkgrel"].includes(key) || !value || value.startsWith("--") || values.has(key)) throw new Error("Expected --assets <directory> --output <new-directory> [--pkgrel <n>]");
        values.set(key, value);
    }
    if (!values.has("--assets") || !values.has("--output")) throw new Error("--assets and --output are required (see aur --help)");
    prepareAur({ version, assets: resolve(values.get("--assets")!), output: resolve(values.get("--output")!), pkgrel: values.has("--pkgrel") ? Number(values.get("--pkgrel")) : 1 });
    console.log(`AUR recipes prepared in ${values.get("--output")}. Nothing was published.`);
}
