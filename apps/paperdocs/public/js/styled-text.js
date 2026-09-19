(() => {
    let assetsPromise = null;
    function loadAssets() {
        if (!assetsPromise) {
            assetsPromise = Promise.all([
                fetch('html/styled-text.html').then((r) => r.text()),
                fetch('css/styled-text.css').then((r) => r.text()),
            ]);
        }
        return assetsPromise;
    }

    class StyledTextElement extends HTMLElement {
        static get observedAttributes() {
            return ['size', 'text'];
        }

        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
        }

        async connectedCallback() {
            await this.render();
            this.observer = new MutationObserver(() => this.render());
            this.observer.observe(this, { childList: true, characterData: true, subtree: true });
        }

        disconnectedCallback() {
            if (this.observer) this.observer.disconnect();
        }

        attributeChangedCallback(name, oldVal, newVal) {
            if (oldVal !== newVal && this.shadowRoot) {
                this.render();
            }
        }

        async render() {
            const [rawHtml, css] = await loadAssets();
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

            const padX = Math.ceil(dropBlur * 2 + innerOffset + 15);
            const padY = Math.ceil(dropBlur * 1.8 + innerOffset + 12);

            let textWidth = fontSize * text.length * 0.58;
            let textHeight = fontSize * 1.05;

            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.font = `800 ${fontSize}px 'Nunito', sans-serif`;
                    const m = ctx.measureText(text);
                    if (m.width > 0) {
                        textWidth = m.width;
                    }
                    if (m.actualBoundingBoxAscent && m.actualBoundingBoxDescent) {
                        textHeight = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
                    }
                }
            } catch (e) {}

            const totalW = Math.ceil(textWidth + padX * 2);
            const totalH = Math.ceil(textHeight + padY * 2);
            const minX = -Math.round(totalW / 2);
            const minY = -Math.round(totalH / 2);
            const viewBox = `${minX} ${minY} ${totalW} ${totalH}`;

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

            // The SVG carries shadow bleed on every side of the glyphs. Pull
            // that bleed back out of layout so the host occupies span-like
            // space and left-aligned headings actually sit flush left; the
            // shadow itself is not clipped (overflow stays visible).
            this.style.marginTop = `${-padY}px`;
            this.style.marginBottom = `${-padY}px`;
            this.style.marginLeft = `${-padX}px`;
            this.style.marginRight = `${-padX}px`;

            const refineViewBox = () => {
                const mainText = this.shadowRoot.getElementById('mainText');
                const svg = this.shadowRoot.querySelector('svg');
                if (mainText && svg) {
                    try {
                        const bbox = mainText.getBBox();
                        if (bbox.width > 0 && bbox.height > 0) {
                            const tW = Math.ceil(bbox.width + padX * 2);
                            const tH = Math.ceil(bbox.height + padY * 2);
                            const mX = Math.round(bbox.x - padX);
                            const mY = Math.round(bbox.y - padY);
                            svg.setAttribute('viewBox', `${mX} ${mY} ${tW} ${tH}`);
                            svg.setAttribute('width', tW);
                            svg.setAttribute('height', tH);
                        }
                    } catch (e) {}
                }
            };

            requestAnimationFrame(refineViewBox);
            if (document.fonts && document.fonts.ready) {
                document.fonts.ready.then(refineViewBox);
            }
        }
    }

    customElements.define('styled-text', StyledTextElement);

    function upgradeStyledTextTags(root = document) {
        root.querySelectorAll('StyledText, styledtext').forEach((el) => {
            const replacement = document.createElement('styled-text');
            for (const attr of el.attributes) {
                replacement.setAttribute(attr.name, attr.value);
            }
            replacement.textContent = el.textContent;
            el.replaceWith(replacement);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => upgradeStyledTextTags());
    } else {
        upgradeStyledTextTags();
    }

    const docObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) {
                    if (node.tagName === 'STYLEDTEXT') {
                        upgradeStyledTextTags(node.parentNode || document);
                    } else if (node.querySelectorAll) {
                        upgradeStyledTextTags(node);
                    }
                }
            }
        }
    });
    docObserver.observe(document.body, { childList: true, subtree: true });
})();
