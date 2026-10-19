// Tutorial declarations: the one rule the daemon's manifest validator and the
// packer share. A manifest that breaks it is refused, never trimmed.
import { describe, it, expect } from "bun:test";
import { MAX_TUTORIAL_STEPS, tutorialImagePaths, validateTutorialDeclaration } from "../src/tutorialManifest";

const step = { icon: "terminal", title: "Tabs stay open", body: "Close the window; the shell keeps running." };

describe("validateTutorialDeclaration", () => {
    it("treats a missing field as no tutorial", () => {
        expect(validateTutorialDeclaration(undefined)).toEqual([]);
    });

    it("keeps valid steps and trims their text", () => {
        expect(validateTutorialDeclaration([{ ...step, title: "  Tabs stay open " }])).toEqual([step]);
    });

    it("refuses shapes and bounds it cannot honor", () => {
        expect(() => validateTutorialDeclaration({})).toThrow(/array/);
        expect(() => validateTutorialDeclaration([])).toThrow(/1 to/);
        expect(() => validateTutorialDeclaration(Array(MAX_TUTORIAL_STEPS + 1).fill(step))).toThrow(/1 to/);
        expect(() => validateTutorialDeclaration([{ ...step, title: "" }])).toThrow(/title/);
        expect(() => validateTutorialDeclaration([{ ...step, body: "x".repeat(401) }])).toThrow(/body/);
        expect(() => validateTutorialDeclaration([{ ...step, icon: "<b>" }])).toThrow(/icon/);
    });
});

describe("tutorial images", () => {
    const image = { light: "./tutorial/1-light.webp", dark: "./tutorial/1-dark.webp", alt: "Three open tabs" };

    it("keeps an image inside the build and lists its files once", () => {
        const steps = validateTutorialDeclaration([{ ...step, image }, { ...step, image: { light: "./tutorial/1-light.webp", alt: "Again" } }]);
        expect(steps[0].image).toEqual(image);
        expect(tutorialImagePaths(steps)).toEqual(["./tutorial/1-light.webp", "./tutorial/1-dark.webp"]);
    });

    it("refuses paths that leave the build, other file types and missing alt text", () => {
        for (const light of ["../secret.png", "/etc/x.png", "./a/../../x.png", "./tutorial/1.svg", "https://x.dev/a.png"]) {
            expect(() => validateTutorialDeclaration([{ ...step, image: { ...image, light } }])).toThrow(/image paths/);
        }
        expect(() => validateTutorialDeclaration([{ ...step, image: { light: image.light } }])).toThrow(/alt/);
    });
});
