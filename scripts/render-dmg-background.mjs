// With preview-dmg-background.mjs running, export the real components in Chrome.
// Run: node scripts/render-dmg-background.mjs [--headless]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const docsRequire = createRequire(new URL('../apps/paperdocs/package.json', import.meta.url));
const { chromium } = docsRequire('playwright');
const browser = await chromium.launch({
    channel: 'chrome',
    headless: process.argv.includes('--headless'),
});
try {
    const page = await browser.newPage({ viewport: { width: 540, height: 380 }, deviceScaleFactor: 1 });
    for (const scale of [1, 2]) {
        await page.setViewportSize({ width: 540 * scale, height: 380 * scale });
        await page.goto(`http://127.0.0.1:8791/?scale=${scale}`);
        await page.waitForFunction(() => {
            const heading = document.querySelector('.marketing-heading styled-text');
            return heading?.shadowRoot?.querySelector('#mainText')
                && [...document.fonts].some(f => f.family === 'Material Symbols Rounded' && f.status === 'loaded')
                && [...document.fonts].some(f => f.family === 'Nunito' && f.status === 'loaded');
        });
        const facts = await page.evaluate(async () => {
            await document.fonts.ready;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const heading = document.querySelector('.marketing-heading styled-text');
            const arrow = document.querySelector('.dmg-arrow');
            const bounds = document.querySelector('.dmg-canvas').getBoundingClientRect();
            return {
                headingSize: heading.getAttribute('size'),
                text: heading.shadowRoot.querySelector('#mainText').textContent.trim(),
                arrow: arrow.textContent,
                arrowFont: getComputedStyle(arrow).fontFamily,
                dimensions: [bounds.width, bounds.height],
                filters: heading.shadowRoot.querySelectorAll('filter').length,
            };
        });
        assert.equal(facts.headingSize, '64');
        assert.equal(facts.text, 'Paperboard');
        assert.equal(facts.filters, 3);
        assert.equal(facts.arrow, 'arrow_forward');
        assert.match(facts.arrowFont, /Material Symbols Rounded/);
        assert.deepEqual(facts.dimensions, [540 * scale, 380 * scale]);
        const path = fileURLToPath(new URL(`../apps/paperboard/build/background${scale === 2 ? '@2x' : ''}.png`, import.meta.url));
        await page.screenshot({ path });
        console.log(`Verified and exported ${path}`);
    }
} finally {
    await browser.close();
}
