import { createIconPlay, defineMarketingText, type IconPlay } from "@mileniumhq/paperui/marketing/elements";

// The marketing pages' elements (vite.site.elements.config.ts): defined at
// once, from the head, then the landing's outro playground once the page is
// parsed.
defineMarketingText();

// Phones have no room around the copy for a toy, and reduced motion asks for
// none: style.css sets the icons in a still row under the same query.
const STILL_QUERY = "(max-width: 600px), (prefers-reduced-motion: reduce)";

function startOutro() {
    const field = document.querySelector<HTMLElement>("[data-play-field]");
    if (!field) return;
    const icons = [...field.querySelectorAll<HTMLImageElement>(".play-icon")];
    const copy = () => [...field.querySelectorAll(".outro-copy .marketing-heading-lines, .outro-copy .download-cta")];
    const still = matchMedia(STILL_QUERY);
    let play: IconPlay | null = null;
    // crossing into the still row hands the icons back to the page's styles;
    // crossing out of it scatters them again
    const apply = () => {
        if (still.matches) {
            play?.stop();
            play = null;
            field.dataset.playState = "still";
            return;
        }
        if (play) return;
        const current = createIconPlay(field, icons, { size: 84, avoid: copy, reduceMotion: false });
        play = current;
        current.ready.catch((error: unknown) => {
            // quiet: the field says the toy is unavailable, and style.css hides the icons
            console.error("Icon playground unavailable", error);
        });
    };
    still.addEventListener("change", apply);
    apply();
    window.addEventListener(
        "pagehide",
        () => {
            still.removeEventListener("change", apply);
            play?.stop();
        },
        { once: true },
    );
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startOutro, { once: true });
else startOutro();
