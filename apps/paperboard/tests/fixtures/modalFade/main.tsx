// The shell's stay-mounted modals on real PaperUI, closed and reopened the
// way a person does: what was showing stays while the modal fades out, and
// a wizard starts over when its modal opens again. The results are posted
// back to the test.
import { createSignal, onMount, Show } from "solid-js";
import { render } from "solid-js/web";
import { PaperModal, PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "../../../src/renderer/src/shell.css";
import TutorialDialog, { type OpenTutorial } from "../../../src/renderer/src/components/layout/TutorialDialog";
import AppSettings, { APP_SETTINGS_DEFAULTS } from "../../../src/renderer/src/components/settings/AppSettings";
import { createShownWhileClosing } from "../../../src/renderer/src/lib/openings";

const out = { checks: {} as Record<string, unknown>, error: "" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const tutorial: OpenTutorial = {
    name: "Fixture",
    steps: [
        { title: "First step", body: "Where it starts." },
        { title: "Second step", body: "Where it ends.", image: { light: "/second-step-picture.png", alt: "Second step picture" } },
    ],
    imageSrc: (path) => path,
};
const [openTutorial, setOpenTutorial] = createSignal<OpenTutorial | null>(null);

// the setup wizard's form: a stay-mounted modal whose content is keyed on
// each opening, so it mounts fresh every time the modal opens
const [setupOpen, setSetupOpen] = createSignal(false);
let setupMounts = 0;
function SetupProbe() {
    onMount(() => setupMounts++);
    return <p>Setup content</p>;
}
function SetupModal() {
    const shown = createShownWhileClosing(setupOpen);
    return (
        <PaperModal open={setupOpen()} aria-label="Setup probe" onClose={() => setSetupOpen(false)} noHeader>
            <Show when={shown()} keyed>
                <SetupProbe />
            </Show>
        </PaperModal>
    );
}

const root = document.getElementById("app")!;
render(() => (
    <PaperProvider fullWidth fullHeight>
        <TutorialDialog tutorial={openTutorial()} theme="light" onDone={() => setOpenTutorial(null)} />
        <SetupModal />
        <AppSettings settings={APP_SETTINGS_DEFAULTS} onChange={() => undefined} onShowTutorial={() => undefined} computers={[]} />
    </PaperProvider>
), root);

const dialog = (label: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((d) =>
        d.getAttribute("aria-label") === label || d.textContent?.includes(label));

async function run() {
    const c = out.checks;
    await sleep(100);

    // a tutorial closed on its second step still shows that step as it fades
    setOpenTutorial(tutorial);
    await sleep(100);
    const tutorialBox = dialog("Welcome to Fixture");
    if (!tutorialBox) throw new Error("the tutorial dialog did not open");
    const next = [...tutorialBox.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim().startsWith("Next"));
    if (!next) throw new Error(`the tutorial has no Next button: ${tutorialBox.textContent}`);
    // every step's picture is asked for as the tutorial opens, not when its step arrives
    c.tutorialPicturesLoadAhead = performance.getEntriesByType("resource").some((entry) => entry.name.endsWith("/second-step-picture.png"));
    // a step change crossfades: the step leaving stays, fading, over the one
    // arriving, so the frame between them is never empty
    next.click();
    await sleep(30);
    const leaving = [...tutorialBox.querySelectorAll<HTMLElement>("form > div:first-child > *")].find((step) => step.textContent?.includes("First step"));
    c.tutorialStepsCrossfade = Boolean(leaving && tutorialBox.textContent?.includes("Second step") && Number(getComputedStyle(leaving).opacity) > 0);
    await sleep(400);
    c.tutorialOnSecondStep = Boolean(tutorialBox.textContent?.includes("Second step")) && !tutorialBox.textContent?.includes("First step");
    setOpenTutorial(null);
    await sleep(20);
    c.tutorialFadesWithItsStep = Boolean(tutorialBox.textContent?.includes("Second step"));
    c.tutorialKeepsItsName = tutorialBox.getAttribute("aria-label") === "Welcome to Fixture";
    await sleep(600);

    // reopened, the same tutorial starts from its first step
    setOpenTutorial(tutorial);
    await sleep(100);
    const reopened = dialog("Welcome to Fixture");
    c.tutorialStartsOver = Boolean(reopened?.textContent?.includes("First step"))
        && !reopened?.textContent?.includes("Second step");
    setOpenTutorial(null);
    await sleep(600);

    // the setup wizard stays through its fade and mounts fresh on each open
    setSetupOpen(true);
    await sleep(100);
    const setupBox = dialog("Setup probe");
    if (!setupBox) throw new Error("the setup modal did not open");
    setSetupOpen(false);
    await sleep(20);
    c.setupFadesWithItsContent = Boolean(setupBox.textContent?.includes("Setup content"));
    await sleep(600);
    setSetupOpen(true);
    await sleep(100);
    c.setupMounts = setupMounts;

    // a license closed from its modal stays, title and text, as it fades
    const mit = document.querySelector<HTMLButtonElement>('button[aria-label="View MIT license"]');
    if (!mit) throw new Error("App Settings has no MIT license button");
    mit.click();
    await sleep(100);
    const licenseBox = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
        .find((d) => d.getAttribute("aria-modal") === "true" && d.textContent?.includes("Permission is hereby granted"));
    if (!licenseBox) throw new Error("the MIT license did not open");
    const titleOf = () => document.getElementById(licenseBox.getAttribute("aria-labelledby") ?? "")?.textContent ?? "";
    const close = licenseBox.querySelector<HTMLButtonElement>('[aria-label="Close modal"]');
    if (!close) throw new Error("the license modal has no close button");
    close.click();
    await sleep(20);
    c.licenseFadesWithItsText = Boolean(licenseBox.textContent?.includes("Permission is hereby granted"));
    c.licenseKeepsItsTitle = titleOf();
}

void run()
    .catch((err) => { out.error = err instanceof Error ? `${err.message}\n${err.stack}` : String(err); })
    .finally(() => void fetch("/results", { method: "POST", body: JSON.stringify(out) }));
