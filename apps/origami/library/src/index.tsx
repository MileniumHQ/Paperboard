import { render } from "solid-js/web";
import { PaperProvider } from "@paperboard-dev/paperui";
import "@paperboard-dev/paperui/style.css";
import PanelLibraryApp from "./App";
import { createLibraryBridge } from "./bridge";
import { createWindowHost } from "./host";

const bridge = createLibraryBridge(createWindowHost());

// The handshake timers and message listener live as long as the document;
// pagehide is the one event that reliably fires for embedded frames too.
window.addEventListener("pagehide", () => bridge.dispose(), { once: true });

render(
    () => (
        <PaperProvider
            theme={bridge.theme()}
            styleBody
            unselectable
            fullWidth
            fullHeight
        >
            <PanelLibraryApp bridge={bridge} />
        </PaperProvider>
    ),
    document.getElementById("root")!,
);
