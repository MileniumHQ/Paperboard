(() => {
    let assetsPromise = null;
    function loadAssets() {
        if (!assetsPromise) {
            assetsPromise = Promise.all([
                fetch('/html/bg-overlay.html').then((r) => r.text()),
                fetch('/css/bg-overlay.css').then((r) => r.text()),
            ]).then(([html, css]) => `<style>${css}</style>${html}`);
        }
        return assetsPromise;
    }

    class BgOverlayElement extends HTMLElement {
        static get observedAttributes() {
            return ['opacity'];
        }

        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
        }

        async connectedCallback() {
            await this.render();
        }

        attributeChangedCallback() {
            this.render();
        }

        async render() {
            const template = await loadAssets();
            this.shadowRoot.innerHTML = template;
        }
    }

    customElements.define('bg-overlay', BgOverlayElement);

    function upgradeBgOverlayTags(root = document) {
        root.querySelectorAll('BgOverlay, bgoverlay').forEach((el) => {
            const replacement = document.createElement('bg-overlay');
            for (const attr of el.attributes) {
                replacement.setAttribute(attr.name, attr.value);
            }
            replacement.textContent = el.textContent;
            el.replaceWith(replacement);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => upgradeBgOverlayTags());
    } else {
        upgradeBgOverlayTags();
    }

    const bgObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) {
                    if (node.tagName === 'BGOVERLAY') {
                        upgradeBgOverlayTags(node.parentNode || document);
                    } else if (node.querySelectorAll) {
                        upgradeBgOverlayTags(node);
                    }
                }
            }
        }
    });
    bgObserver.observe(document.body, { childList: true, subtree: true });
})();
