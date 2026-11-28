import { createSignal, onMount, Show } from "solid-js";
import { errorMessage } from "@mileniumhq/paperapi";
import { createPaperCompact, showError } from "@mileniumhq/paperui";
import App from "./App";
import { startShell } from "./startShell";
import MobileWelcome from "./components/computer/MobileWelcome";
import { logToMain, shellApi } from "./lib/shell";

// The desktop app's window, or with `--mobile` its development mock of a
// phone (mobileMock.ts): the phone layout with touch, listing only paired
// computers, on a welcome until one is. A window or browser tab narrower than
// a panel's phone line takes the phone layout too, with a mouse's behavior.
// The shell waits for the launch options: a phone keeps its own Home, and a
// frame is told mobile mode as it loads.
function DesktopShell() {
    const [phone, setPhone] = createSignal<boolean | null>(null);
    const narrow = createPaperCompact();
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
                layout={phone() || narrow() ? "phone" : "desktop"}
                mobileMode={phone() === true}
                hidesThisComputer={phone() === true}
                noComputers={phone() ? MobileWelcome : undefined}
            />
        </Show>
    );
}

startShell(() => <DesktopShell />);
