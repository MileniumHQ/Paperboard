(() => {
    let assetsPromise = null;
    function loadAssets() {
        if (!assetsPromise) {
            assetsPromise = Promise.all([
                fetch('html/paper-button.html').then((r) => r.text()),
                fetch('css/paper-button.css').then((r) => r.text()),
            ]);
        }
        return assetsPromise;
    }

    class PaperButtonElement extends HTMLElement {
        static get observedAttributes() {
            return ['variant', 'size', 'disabled', 'href', 'target', 'rel'];
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
            const [rawHtml, css] = await loadAssets();
            const variant = this.getAttribute('variant') || 'brand';
            const size = this.getAttribute('size') || 'medium';
            const disabled = this.hasAttribute('disabled');
            const href = this.getAttribute('href');
            const target = this.getAttribute('target');
            const rel = this.getAttribute('rel');

            const tag = href ? 'a' : 'button';
            const hrefAttr = href ? `href="${href}"` : '';
            const targetAttr = href && target ? `target="${target}"` : '';
            const relAttr = href && rel ? `rel="${rel}"` : '';
            const disabledAttr = disabled ? 'disabled' : '';
            const variantClass = `variant-${variant}`;
            const sizeClass = `size-${size}`;
            const disabledClass = disabled ? 'disabled' : '';

            const renderedHtml = rawHtml
                .replaceAll('{{tag}}', tag)
                .replaceAll('{{hrefAttr}}', hrefAttr)
                .replaceAll('{{targetAttr}}', targetAttr)
                .replaceAll('{{relAttr}}', relAttr)
                .replaceAll('{{disabledAttr}}', disabledAttr)
                .replaceAll('{{variantClass}}', variantClass)
                .replaceAll('{{sizeClass}}', sizeClass)
                .replaceAll('{{disabledClass}}', disabledClass);

            this.shadowRoot.innerHTML = `<style>${css}</style>${renderedHtml}`;
        }
    }

    customElements.define('paper-button', PaperButtonElement);

    function upgradePaperButtonTags(root = document) {
        root.querySelectorAll('PaperButton, paperbutton').forEach((el) => {
            const replacement = document.createElement('paper-button');
            for (const attr of el.attributes) {
                replacement.setAttribute(attr.name, attr.value);
            }
            replacement.innerHTML = el.innerHTML;
            el.replaceWith(replacement);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => upgradePaperButtonTags());
    } else {
        upgradePaperButtonTags();
    }

    const paperBtnObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) {
                    if (node.tagName === 'PAPERBUTTON') {
                        upgradePaperButtonTags(node.parentNode || document);
                    } else if (node.querySelectorAll) {
                        upgradePaperButtonTags(node);
                    }
                }
            }
        }
    });
    paperBtnObserver.observe(document.body, { childList: true, subtree: true });
})();
