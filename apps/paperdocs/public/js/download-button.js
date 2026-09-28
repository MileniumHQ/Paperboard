// Autodetects the visitor's platform and points the landing's big download
// buttons at the matching versionless alias. Unknown platforms keep the
// default href, which goes to the downloads page, so the button is never a
// dead end.
(() => {
    const targets = {
        windows: { label: "Windows", file: "paperboard-windows-x64-setup.exe" },
        macosArm: {
            label: "Mac (Apple Silicon)",
            file: "paperboard-macos-arm64.zip",
        },
        macosIntel: { label: "Mac (Intel)", file: "paperboard-macos-x64.zip" },
        linuxX64: { label: "Linux (x64)", file: "paperboard-linux-x64.AppImage" },
        linuxArm: {
            label: "Linux (ARM64)",
            file: "paperboard-linux-arm64.AppImage",
        },
    };

    function fromUserAgent() {
        const ua = navigator.userAgent || "";
        const platform =
            (navigator.userAgentData && navigator.userAgentData.platform) ||
            navigator.platform ||
            "";
        const arm =
            /aarch64|arm64|armv8|armv7/i.test(ua) || /arm/i.test(platform);

        if (/windows/i.test(platform) || /windows/i.test(ua)) {
            return targets.windows;
        }
        if (/mac/i.test(platform) || /mac os x|macintosh/i.test(ua)) {
            // Safari and Firefox report Intel on Apple Silicon, so assume the
            // common case; Chromium refines this with high-entropy hints.
            return targets.macosArm;
        }
        if (/linux|x11/i.test(platform) || /linux/i.test(ua)) {
            return arm ? targets.linuxArm : targets.linuxX64;
        }
        return null;
    }

    async function detect() {
        const data = navigator.userAgentData;
        if (data && typeof data.getHighEntropyValues === "function") {
            try {
                const values = await data.getHighEntropyValues([
                    "architecture",
                    "bitness",
                ]);
                const arch = values.architecture || "";
                const platform = data.platform || "";
                if (/windows/i.test(platform)) return targets.windows;
                if (/mac/i.test(platform)) {
                    return /arm/i.test(arch)
                        ? targets.macosArm
                        : targets.macosIntel;
                }
                if (/linux|chrome os/i.test(platform)) {
                    return /arm/i.test(arch)
                        ? targets.linuxArm
                        : targets.linuxX64;
                }
            } catch (error) {
                // High-entropy hints are optional; the user agent still works.
            }
        }
        return fromUserAgent();
    }

    function apply(target) {
        for (const button of document.querySelectorAll(
            "[data-download-button]",
        )) {
            const label = button.querySelector(".download-label");
            if (target) {
                button.setAttribute(
                    "href",
                    `https://i.paperboard.dev/pb/latest/${target.file}`,
                );
                if (label) {
                    label.textContent = `Download for ${target.label}`;
                }
            } else if (label) {
                label.textContent = "Download";
            }
        }
    }

    detect().then(apply);
})();
