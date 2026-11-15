// The onboarding speaker: a newer line, or leaving, interrupts what is being
// said, and whoever waited on it hears so. A scene that waits (the face
// shaking while the computer step waits) runs its tidy-up only on that answer.
import { expect, mock, test } from "bun:test";
import { createRoot } from "solid-js";
import type { FaceController } from "../src/face/controller";

// paced speech, as a person who hasn't asked for reduced motion hears it
(globalThis as { window?: unknown }).window = { matchMedia: () => ({ matches: false }) };
// PaperUI's page side can't load outside a page; the speaker only taps with it
mock.module("@mileniumhq/paperui", () => ({ haptic() {} }));
const { createSpeaker } = await import("../src/onboarding/speech");

const face = { talk() {}, express() {}, bounce() {} } as unknown as FaceController;

test("a wait or a line interrupted by a newer line answers false", async () => {
    await createRoot(async (dispose) => {
        const speaker = createSpeaker(face);
        const waited = speaker.wait(60_000);
        const said = speaker.say(["A long line that takes a while to type out."]);
        const next = speaker.say(["[pause 1]Hi."]);
        expect(await waited).toBe(false);
        expect(await said).toBe(false);
        expect(await next).toBe(true);
        dispose();
    });
});

test("leaving interrupts what was being said", async () => {
    let said: Promise<boolean> | undefined;
    createRoot((dispose) => {
        said = createSpeaker(face).say(["A long line that takes a while to type out."]);
        dispose();
    });
    expect(await said).toBe(false);
});
