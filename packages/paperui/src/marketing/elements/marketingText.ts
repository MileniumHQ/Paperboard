// <marketing-text>: Paperboard's display lettering as a custom element, so a
// page that never runs a framework (the prerendered site) draws it the
// moment the parser reaches it, and MarketingText wraps the same element for
// Solid. White Nunito pressed into the page with an accent-tinted inner edge,
// a soft drop and the paper grain. The element's own text is slotted into a
// hidden label, so screen readers and search read the words once.
//
//   <marketing-text size="48" text="Paperboard">Paperboard</marketing-text>
//
// Attributes: `text` (the words; the element's own text when unset), `size`
// (font size in px, which the shadows and grain scale with), and `fluid`
// (the page sets the font size, so a heading's wrapped lines share one size).

export const MARKETING_TEXT_TAG = "marketing-text";

// Nunito 800's average advance per character, in em: the first guess at the
// width before the canvas or the rendered glyphs say better.
const ADVANCE = 0.58;

const STYLES = `
:host {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    max-width: 95vw;
    line-height: 1;
}
svg {
    display: block;
    width: auto;
    max-width: 100%;
    height: auto;
    overflow: visible;
}
/* Fluid lettering takes its size from the page (the svg box is the font box,
   1.364em of Nunito), so a heading's wrapped lines keep one type size
   instead of each shrinking to its own width. */
:host([fluid]) {
    max-width: 100%;
}
:host([fluid]) svg {
    height: 1.364em;
}
text {
    font-family: "Nunito", sans-serif;
    font-weight: 800;
    letter-spacing: -0.01em;
}
.label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
.face {
    fill: var(--paper-on-color);
}
.grain {
    fill: var(--paper-marketing-ink);
    pointer-events: none;
}
.drop {
    flood-color: var(--paper-marketing-ink);
}
.inner {
    flood-color: var(--marketing-accent);
}
.ink {
    flood-color: var(--paper-marketing-ink);
}
`;

const escape = (value: string) =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const round = (value: number) => +value.toFixed(2);

function drawing(id: string, text: string, size: number, width: number, height: number): string {
    const ratio = size / 200;
    const words = escape(text);
    const glyphs = (className: string, filter: string) =>
        `<text class="${className}" x="0" y="0" text-anchor="middle" dominant-baseline="central" font-size="${size}" filter="url(#${id}-${filter})">${words}</text>`;
    // the text attribute alone still names it, through the slot's fallback
    return `<span class="label"><slot>${words}</slot></span><svg aria-hidden="true" width="${width}" height="${height}" viewBox="${-width / 2} ${-height / 2} ${width} ${height}" preserveAspectRatio="xMidYMid meet">
    <defs>
        <filter id="${id}-drop" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow class="drop" dx="0" dy="0" stdDeviation="${round(19 * ratio)}" flood-opacity="0.35" />
        </filter>
        <filter id="${id}-inner" x="-30%" y="-30%" width="160%" height="160%">
            <feComponentTransfer in="SourceAlpha" result="inverted"><feFuncA type="linear" slope="-1" intercept="1" /></feComponentTransfer>
            <feOffset in="inverted" dx="${round(6 * ratio)}" dy="${round(6 * ratio)}" result="shifted" />
            <feGaussianBlur in="shifted" stdDeviation="${round(2 * ratio)}" result="blurred" />
            <feComposite in="blurred" in2="SourceAlpha" operator="in" result="edge" />
            <feFlood class="inner" flood-opacity="0.4" result="tint" />
            <feComposite in="tint" in2="edge" operator="in" result="tinted" />
            <feMerge><feMergeNode in="SourceGraphic" /><feMergeNode in="tinted" /></feMerge>
        </filter>
        <filter id="${id}-grain" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="${round(0.8 * Math.max(0.4, Math.min(3, 200 / size)))}" numOctaves="3" stitchTiles="stitch" result="noise" />
            <feColorMatrix type="matrix" in="noise" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.033 0.033 0.033 0 0" result="speckle" />
            <feFlood class="ink" result="ink" />
            <feComposite in="ink" in2="speckle" operator="in" result="inkSpeckle" />
            <feComposite in="inkSpeckle" in2="SourceAlpha" operator="in" />
        </filter>
    </defs>
    <g filter="url(#${id}-drop)">
        ${glyphs("face", "inner")}
        ${glyphs("grain", "grain")}
    </g>
</svg>`;
}

/** Defines <marketing-text> once; a page or bundle that calls it again changes nothing. */
export function defineMarketingText(): void {
    if (typeof customElements === "undefined" || customElements.get(MARKETING_TEXT_TAG)) return;

    let next = 0;

    class MarketingTextElement extends HTMLElement {
        static observedAttributes = ["size", "text", "fluid"];
        readonly #id = `marketing-text-${++next}`;
        // late answers lose: a font load for words that have since changed is dropped
        #version = 0;
        #observer: MutationObserver | undefined;

        constructor() {
            super();
            this.attachShadow({ mode: "open" });
        }

        connectedCallback() {
            this.#render();
            this.#observer = new MutationObserver(() => this.#render());
            this.#observer.observe(this, { childList: true, characterData: true, subtree: true });
        }

        disconnectedCallback() {
            this.#observer?.disconnect();
            this.#version++;
        }

        attributeChangedCallback(_name: string, before: string | null, after: string | null) {
            if (before !== after && this.isConnected) this.#render();
        }

        #render() {
            const root = this.shadowRoot;
            if (!root) throw new Error("marketing-text: its shadow root is missing");
            const text = this.getAttribute("text") ?? this.textContent?.trim() ?? "";
            const size = Number(this.getAttribute("size")) || 200;

            // The svg's box is the words' own box; shadows paint outside it, so
            // the element takes span-like room and shrinks with its words.
            let width = size * text.length * ADVANCE;
            let height = size * 1.05;
            const context = document.createElement("canvas").getContext("2d");
            if (context) {
                context.font = `800 ${size}px "Nunito", sans-serif`;
                const metrics = context.measureText(text);
                if (metrics.width > 0) width = metrics.width;
                if (metrics.fontBoundingBoxAscent && metrics.fontBoundingBoxDescent) {
                    height = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
                }
            }
            root.innerHTML = `<style>${STYLES}</style>${drawing(this.#id, text, size, Math.ceil(width), Math.ceil(height))}`;

            // Fit the box to the rendered glyphs now, so the first paint has it,
            // and again once the web font is in.
            const version = ++this.#version;
            this.#fit();
            void document.fonts?.ready.then(() => {
                if (version === this.#version) this.#fit();
            });
        }

        // getBBox needs a rendered element: hidden, the estimate stays
        #fit() {
            const root = this.shadowRoot;
            const face = root?.querySelector<SVGTextElement>("text.face");
            const svg = root?.querySelector("svg");
            if (!face || !svg || !this.isConnected || !this.getClientRects().length) return;
            const box = face.getBBox();
            if (!box.width || !box.height) return;
            const width = Math.ceil(box.width);
            const height = Math.ceil(box.height);
            svg.setAttribute("viewBox", `${box.x} ${box.y} ${width} ${height}`);
            svg.setAttribute("width", String(width));
            svg.setAttribute("height", String(height));
        }
    }

    customElements.define(MARKETING_TEXT_TAG, MarketingTextElement);
}
