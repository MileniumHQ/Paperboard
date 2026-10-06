// Browser regression fixture: serve the app root with Vite and open
// /tests/fixtures/computerHeader.html. Failed assertions appear in #result.
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import ComputerHeader from "../../src/renderer/src/components/computer/ComputerHeader";

const [tab, setTab] = createSignal("library");
const dispose = render(() => (
    <PaperProvider>
        <div style={{ width: "var(--paper-size-sidebar)" }}>
            <ComputerHeader
                computer={{
                    id: "local", name: "My Computer", host: "127.0.0.1", port: 0,
                    os: "linux", distroId: "ubuntu", osVersion: "24.04",
                    status: { connected: true, isRemote: false, host: "127.0.0.1", port: 0 },
                }}
                selectedTab={tab()}
                onSelectTab={setTab}
            />
        </div>
    </PaperProvider>
), document.getElementById("root")!);
window.addEventListener("pagehide", dispose, { once: true });

const result = document.createElement("output");
result.id = "result";
document.body.append(result);
try {
    const row = document.querySelector<HTMLLabelElement>('label[data-value="settings"]');
    if (!row) throw new Error("Computer info must be a selectable PaperList item");
    if (!row.textContent?.includes("My Computer") || !row.textContent.includes("Ubuntu 24.04")) {
        throw new Error("Computer name and OS must be inside the info item");
    }
    if (row.querySelector('[class*="listIcon"]')) throw new Error("Computer item must have no icon");
    if (document.querySelectorAll('label').length !== 2 || document.body.textContent?.includes("Computer Info")) {
        throw new Error("The separate header and info tab must be merged");
    }
    row.click();
    if (tab() !== "settings" || !row.querySelector<HTMLInputElement>('input[type="radio"]')?.checked) {
        throw new Error("Selecting the computer must open its info view");
    }
    if (!getComputedStyle(row).backgroundImage.includes("linear-gradient")) {
        throw new Error("The selected computer item must retain its CSS gradient");
    }
    document.querySelector<HTMLLabelElement>('label[data-value="library"]')!.click();
    if (tab() !== "library") throw new Error("Library navigation must still work");
    result.textContent = "PASS: merged computer navigation, selection, CSS gradient, and library navigation";
} catch (error) {
    result.textContent = `FAIL: ${String(error)}`;
    throw error;
}
