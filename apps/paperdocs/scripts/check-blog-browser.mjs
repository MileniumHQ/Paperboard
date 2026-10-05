import assert from 'node:assert/strict';

// Runs against the distributed documents served by check-learn-browser. The
// ring-navigation post carries a captioned figure and a carousel, so the real
// markdown -> static page -> client script path is what gets checked. A fake
// clock drives the autoplay frames.
const POST = '/blog/ring-navigation/';

async function state(carousel) {
    return carousel.evaluate(root => {
        const slides = [...root.querySelectorAll('[data-carousel-slide]')];
        const dots = [...root.querySelectorAll('[data-carousel-dot]')];
        const active = dots.findIndex(dot => dot.getAttribute('aria-current') === 'true');
        const fill = dots[active].querySelector('[data-carousel-progress]');
        return {
            active,
            current: dots.filter(dot => dot.getAttribute('aria-current') === 'true').length,
            shown: slides.filter(slide => !slide.inert && !slide.hasAttribute('aria-hidden')).map(slide => slides.indexOf(slide)),
            fill: fill.getBoundingClientRect().width / dots[active].getBoundingClientRect().width,
        };
    });
}

export async function checkBlog(browser, origin) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.clock.install();
        await page.goto(`${origin}${POST}`);

        const figure = page.locator('main figure:not([data-carousel-slide])');
        assert.equal(await figure.count(), 1, 'A titled lone image is one figure');
        assert.equal(await figure.locator('img').getAttribute('alt'), 'The Panel Library, before the rings');
        assert.equal(await figure.locator('figcaption').innerText(), 'The Panel Library, back when it had a sidebar.');

        const carousel = page.getByRole('region', { name: 'Image carousel' });
        assert.equal(await carousel.getAttribute('aria-roledescription'), 'carousel');
        assert.equal(await carousel.locator('[data-carousel-slide]').count(), 4);
        assert.equal(await carousel.locator('figcaption').first().innerText(), 'Game Server: 12 rings, all of them in the lava.');
        assert.equal(await carousel.getByRole('button', { name: 'Show slide 3' }).count(), 1);

        await carousel.scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        await page.clock.runFor(2500);
        let now = await state(carousel);
        assert.deepEqual([now.active, now.current, now.shown], [0, 1, [0]]);
        assert.ok(now.fill > 0.3 && now.fill < 0.7, `The progress bar fills over the slide's time (at ${now.fill})`);

        await page.clock.runFor(3000);
        now = await state(carousel);
        assert.deepEqual([now.active, now.shown], [1, [1]], 'Autoplay advances to the next slide');
        assert.ok(now.fill < 0.3, 'The next slide starts with an empty bar');

        await carousel.hover();
        await page.clock.runFor(8000);
        assert.equal((await state(carousel)).active, 1, 'Hovering pauses autoplay');

        await carousel.getByRole('button', { name: 'Show slide 4' }).click();
        await page.mouse.move(0, 0);
        await page.clock.runFor(12000);
        now = await state(carousel);
        assert.deepEqual([now.active, now.shown], [3, [3]], 'Picking a slide stops autoplay');
        assert.ok(now.fill > 0.99, 'A stopped carousel shows the active dot full');
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }

    const reduced = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    try {
        const page = await reduced.newPage();
        await page.clock.install();
        await page.goto(`${origin}${POST}`);
        const carousel = page.getByRole('region', { name: 'Image carousel' });
        await carousel.scrollIntoViewIfNeeded();
        await page.clock.runFor(12000);
        assert.equal((await state(carousel)).active, 0, 'Reduced motion never autoplays');
        await carousel.getByRole('button', { name: 'Show slide 2' }).click();
        assert.deepEqual((await state(carousel)).shown, [1], 'The dots still work under reduced motion');
    } finally {
        await reduced.close();
    }
}
