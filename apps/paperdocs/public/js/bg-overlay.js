(() => {
    // Shipped inline so the overlay renders as soon as it upgrades.
    const STYLES = `:host {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    mix-blend-mode: overlay;
    opacity: var(--bg-noise-opacity, 0.4);
    z-index: 1;
    display: block;
}

svg {
    width: 100%;
    height: 100%;
    display: block;
}
`;
    const MARKUP = `<svg>
    <defs>
        <filter id="bg-mono-noise" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
                type="fractalNoise"
                baseFrequency="1.3"
                numOctaves="3"
                stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
        </filter>
    </defs>
    <rect width="100%" height="100%" filter="url(#bg-mono-noise)" />
</svg>
`;
    const TEMPLATE = `<style>${STYLES}</style>${MARKUP}`;

    class BgOverlayElement extends HTMLElement {
        static get observedAttributes() {
            return ['opacity'];
        }

        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
        }

        connectedCallback() {
            this.render();
        }

        attributeChangedCallback() {
            this.render();
        }

        render() {
            this.shadowRoot.innerHTML = TEMPLATE;
        }
    }

    customElements.define('bg-overlay', BgOverlayElement);
})();
