(() => {
    // The template and its styles ship inside this script so an element
    // renders the moment it upgrades. Fetching them first left every heading
    // blank (its label already hidden) for a network round trip, then popped
    // it in and shifted the page.
    const TEMPLATE = `<svg width="{{totalW}}" height="{{totalH}}" viewBox="{{viewBox}}" preserveAspectRatio="xMidYMid meet">
    <defs>
        <filter id="{{idDrop}}" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="{{dropBlur}}" flood-color="#000000" flood-opacity="0.35" />
        </filter>

        <filter id="{{idInner}}" x="-30%" y="-30%" width="160%" height="160%">
            <feComponentTransfer in="SourceAlpha" result="invertedAlpha">
                <feFuncA type="linear" slope="-1" intercept="1" />
            </feComponentTransfer>
            <feOffset in="invertedAlpha" dx="{{innerOffset}}" dy="{{innerOffset}}" result="shiftedInverted" />
            <feGaussianBlur in="shiftedInverted" stdDeviation="{{innerBlur}}" result="blurredEdge" />
            <feComposite in="blurredEdge" in2="SourceAlpha" operator="in" result="innerEdgeMask" />
            <feFlood style="flood-color: var(--paper-site-accent)" flood-opacity="0.4" result="shadowColor" />
            <feComposite in="shadowColor" in2="innerEdgeMask" operator="in" result="coloredInnerShadow" />
            <feMerge>
                <feMergeNode in="SourceGraphic" />
                <feMergeNode in="coloredInnerShadow" />
            </feMerge>
        </filter>

        <filter id="{{idNoise}}" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="{{noiseFreq}}" numOctaves="3" stitchTiles="stitch" result="noiseOut" />
            <feColorMatrix type="matrix" in="noiseOut" values="
                0 0 0 0 0
                0 0 0 0 0
                0 0 0 0 0
                0.33 0.33 0.33 0 0" result="monoAlpha" />
            <feComponentTransfer in="monoAlpha" result="attenuatedAlpha">
                <feFuncA type="linear" slope="0.10" />
            </feComponentTransfer>
            <feFlood flood-color="#000000" result="blackFlood" />
            <feComposite in="blackFlood" in2="attenuatedAlpha" operator="in" result="coloredNoise" />
            <feComposite in="coloredNoise" in2="SourceAlpha" operator="in" result="noiseInsideText" />
        </filter>
    </defs>

    <g filter="url(#{{idDrop}})">
        <text
            id="mainText"
            x="0"
            y="0"
            text-anchor="middle"
            dominant-baseline="central"
            font-family="'Nunito', sans-serif"
            font-weight="800"
            font-size="{{fontSize}}"
            fill="#FFFFFF"
            letter-spacing="-0.01em"
            filter="url(#{{idInner}})"
        >{{text}}</text>

        <text
            x="0"
            y="0"
            text-anchor="middle"
            dominant-baseline="central"
            font-family="'Nunito', sans-serif"
            font-weight="800"
            font-size="{{fontSize}}"
            fill="#000000"
            letter-spacing="-0.01em"
            filter="url(#{{idNoise}})"
            pointer-events="none"
        >{{text}}</text>
    </g>
</svg>
`;
    const STYLES = `:host {
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

/* Fluid headings size every line of a heading from one font size the page
   sets (the svg box is the font box, 1.364em of Nunito), so wrapped lines
   keep a single type size instead of each shrinking to its own width. */
:host([fluid]) {
    max-width: 100%;
}

:host([fluid]) svg {
    height: 1.364em;
}
`;

    class StyledTextElement extends HTMLElement {
        static get observedAttributes() {
            return ['size', 'text'];
        }

        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
        }

        connectedCallback() {
            this.render();
            this.observer = new MutationObserver(() => this.render());
            this.observer.observe(this, { childList: true, characterData: true, subtree: true });
        }

        disconnectedCallback() {
            if (this.observer) this.observer.disconnect();
        }

        attributeChangedCallback(name, oldVal, newVal) {
            if (oldVal !== newVal && this.isConnected) {
                this.render();
            }
        }

        render() {
            const rawHtml = TEMPLATE;
            const css = STYLES;
            const text = this.getAttribute('text') || this.textContent.trim() || 'PAPERBOARD';
            const fontSize = parseInt(this.getAttribute('size') || '200', 10);

            if (!this._uid) {
                this._uid = Math.random().toString(36).slice(2, 9);
            }
            const idDrop = `st-drop-${this._uid}`;
            const idInner = `st-inner-${this._uid}`;
            const idNoise = `st-noise-${this._uid}`;

            const ratio = fontSize / 200;
            const dropBlur = +(19 * ratio).toFixed(2);
            const innerOffset = +(6 * ratio).toFixed(2);
            const innerBlur = +(2 * ratio).toFixed(2);
            const noiseFreq = +(0.8 * Math.max(0.4, Math.min(3, 200 / fontSize))).toFixed(2);

            // The SVG's box is the text's own box. Its shadows paint outside it
            // (overflow stays visible), so the element occupies span-like space
            // and scales with its text when a narrow screen shrinks it. Bleed
            // used to be built into the box and pulled back out with fixed
            // negative margins, which did not shrink with the SVG: on phones
            // headings collapsed to nothing and overlapped their neighbours.
            let textWidth = fontSize * text.length * 0.58;
            let textHeight = fontSize * 1.05;

            const ctx = document.createElement('canvas').getContext('2d');
            if (ctx) {
                ctx.font = `800 ${fontSize}px 'Nunito', sans-serif`;
                const m = ctx.measureText(text);
                if (m.width > 0) textWidth = m.width;
                if (m.fontBoundingBoxAscent && m.fontBoundingBoxDescent) {
                    textHeight = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
                }
            }

            const totalW = Math.ceil(textWidth);
            const totalH = Math.ceil(textHeight);
            const viewBox = `${-totalW / 2} ${-totalH / 2} ${totalW} ${totalH}`;

            const renderedHtml = rawHtml
                .replaceAll('{{idDrop}}', idDrop)
                .replaceAll('{{idInner}}', idInner)
                .replaceAll('{{idNoise}}', idNoise)
                .replaceAll('{{fontSize}}', fontSize)
                .replaceAll('{{dropBlur}}', dropBlur)
                .replaceAll('{{innerOffset}}', innerOffset)
                .replaceAll('{{innerBlur}}', innerBlur)
                .replaceAll('{{noiseFreq}}', noiseFreq)
                .replaceAll('{{totalW}}', totalW)
                .replaceAll('{{totalH}}', totalH)
                .replaceAll('{{viewBox}}', viewBox)
                .replaceAll('{{text}}', text);

            this.shadowRoot.innerHTML = `<style>${css}</style>${renderedHtml}`;

            // Fit the box to the rendered glyph run once layout (and later the
            // web font) is available. getBBox needs a rendered element; while
            // the host is not rendered the canvas estimate above stays.
            const refineViewBox = () => {
                const mainText = this.shadowRoot.getElementById('mainText');
                const svg = this.shadowRoot.querySelector('svg');
                if (!mainText || !svg || !this.isConnected || !this.getClientRects().length) return;
                const bbox = mainText.getBBox();
                if (bbox.width > 0 && bbox.height > 0) {
                    const tW = Math.ceil(bbox.width);
                    const tH = Math.ceil(bbox.height);
                    svg.setAttribute('viewBox', `${bbox.x} ${bbox.y} ${tW} ${tH}`);
                    svg.setAttribute('width', tW);
                    svg.setAttribute('height', tH);
                }
            };

            // Refine now rather than on the next frame, so the first paint
            // already has the measured box and nothing moves after it.
            refineViewBox();
            if (document.fonts && document.fonts.ready) {
                document.fonts.ready.then(refineViewBox);
            }
        }
    }

    customElements.define('styled-text', StyledTextElement);
})();
