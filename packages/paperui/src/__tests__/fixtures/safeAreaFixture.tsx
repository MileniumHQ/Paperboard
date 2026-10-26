import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { PaperProvider, PaperSlidePage, PaperModal } from "../../index";
import "../../styles/styles.css";
const [modal, setModal] = createSignal(false);
const results = { checks: {} as Record<string, unknown>, error: "" };
try {
    document.body.style.margin = "0";
    document.documentElement.style.setProperty("--paper-safe-area-top", "60px");
    document.documentElement.style.setProperty("--paper-safe-area-bottom", "34px");
    render(() => <PaperProvider>
        <PaperSlidePage enabled open position="fixed" title="Page" onBack={() => {}}>
            <PaperSlidePage enabled open title="Nested" onBack={() => {}}>Content</PaperSlidePage>
        </PaperSlidePage>
        <PaperModal open={modal()} title="Safe modal" onClose={() => setModal(false)}>Content</PaperModal>
    </PaperProvider>, document.getElementById("app")!);
    const headers = document.querySelectorAll("header");
    results.checks.outerHeaderHeight = headers[0]!.getBoundingClientRect().height;
    results.checks.nestedHeaderHeight = headers[1]!.getBoundingClientRect().height;
    results.checks.controlsBelowStatusBar = headers[0]!.querySelector("button")!.getBoundingClientRect().top >= 60;
    setModal(true);
    const dialog = document.querySelector('[role="dialog"]')!.getBoundingClientRect();
    results.checks.modalInsideSafeArea = dialog.top >= 60 && dialog.bottom <= innerHeight - 34;
} catch (error) { results.error = String(error); }
document.getElementById("results")!.textContent = `RESULT:${btoa(JSON.stringify(results))}`;
