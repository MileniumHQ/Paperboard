// Naming the agent after a character changes the setup itself, not just the
// face: Verity sets herself up in her own voice. Every line of every script
// must be speakable (parse refuses unknown stage directions).
import { describe, expect, it } from "bun:test";
import { scriptFor, type Script } from "../src/onboarding/script";
import { parse } from "../src/onboarding/speech";

const lines = (s: Script, name: string) => [...s.named(name), ...s.signIn, ...s.computer, ...s.later, ...s.install];

describe("the setup script", () => {
    it("is Verity's own when the agent is named Verity, whatever the case or spacing", () => {
        const verity = scriptFor("  vERITY ");
        expect(verity).not.toBe(scriptFor("Pip"));
        expect(verity.named("Verity").join(" ")).toContain("personal helper friend");
        expect(scriptFor("Verity")).toBe(verity);
    });

    it("is the usual one for any other name, and says the name it was given", () => {
        expect(scriptFor("Veritas")).toBe(scriptFor("Pip"));
        expect(scriptFor("Pip").named("Pip")[0]).toContain("**Pip**");
    });

    it("says the sign-in waits for the person's click: nothing opens by itself", () => {
        for (const name of ["Pip", "Verity"]) {
            const said = scriptFor(name).signIn.join(" ");
            expect(said).not.toMatch(/window opens|I'll open|opens? (the|a) (page|browser)/i);
        }
    });

    it("has only lines the speaker can say", () => {
        for (const name of ["Pip", "Verity"]) for (const line of lines(scriptFor(name), name)) expect(() => parse(line)).not.toThrow();
    });
});
