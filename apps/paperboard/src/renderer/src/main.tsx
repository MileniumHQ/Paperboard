// startShell comes before App so PaperUI's base styles load before the shell's CSS modules.
import { startShell } from "./startShell";

import { createSignal, onMount, Show } from "solid-js";
import { errorMessage } from "@mileniumhq/paperapi";
import { showError } from "@mileniumhq/paperui";
import App from "./App";
import MobileWelcome from "./components/computer/MobileWelcome";
import { isBrowserShell, logToMain, shellApi } from "./lib/shell";

// This entry outside Electron is browser mode (`bun run dev:browser`). Hosts
// that place the shell themselves have entries of their own.
if (isBrowserShell()) {
    console.warn(
        "Paperboard browser mode has no sign-in. THIS IS A DEV TOOL AND SHOULD NOT BE USED " +
            "outside development on a trusted machine, and never exposed on a network.",
    );
}

// The desktop app's window, or with `--mobile` its development mock of a
// phone (mobileMock.ts): the phone layout with touch, listing only paired
// computers, on a welcome until one is. The shell waits for the launch
// options: a phone keeps its own Home, and a frame is told mobile mode as it
// loads.
function DesktopShell() {
    const [phone, setPhone] = createSignal<boolean | null>(null);
    onMount(() => {
        shellApi.getLaunchOptions().then(
            (options) => setPhone(options.mobile),
            (err) => {
                logToMain("error", "Couldn't read the launch options; the layout is the desktop one until restart:", err);
                setPhone(false);
                showError("Couldn't read how Paperboard was started", `The desktop layout shows until Paperboard restarts. ${errorMessage(err)}`);
            },
        );
    });
    return (
        <Show when={phone() !== null}>
            <App
                layout={phone() ? "phone" : "desktop"}
                mobileMode={phone() === true}
                hidesThisComputer={phone() === true}
                noComputers={phone() ? MobileWelcome : undefined}
            />
        </Show>
    );
}

startShell(() => <DesktopShell />);
