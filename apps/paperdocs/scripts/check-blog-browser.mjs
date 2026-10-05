import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Runs against the distributed documents served by check-learn-browser, so the
// real markdown -> static page -> client script path is what gets checked. It
// uses the first built post with both a captioned figure and a carousel of at
// least three slides; a site with none of either fails rather than passing
// unchecked. A fake clock drives the autoplay frames.
async function findPost(dist) {
    const blog = join(dist, 'blog');
    for (const entry of (await readdir(blog, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory()) continue;
        const html = await readFile(join(blog, entry.name, 'index.html'), 'utf8');
        const first = html.split('data-carousel ')[1]?.split('</section>')[0] ?? '';
        if ((first.match(/data-carousel-slide/g) ?? []).length >= 3 && /<figure(?![^>]*data-carousel-slide)[^>]*>/.test(html))
            return `/blog/${entry.name}/`;
    }
    throw new Error('No built blog post has a captioned figure and a 3+ slide carousel to check');
}

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

export async function checkBlog(browser, origin, dist) {
    const POST = await findPost(dist);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.clock.install();
        await page.goto(`${origin}${POST}`);

        const figure = page.locator('main figure:not([data-carousel-slide])').first();
        assert.ok(await figure.locator('img').getAttribute('alt'), 'A captioned figure keeps its alt text');
        assert.ok((await figure.locator('figcaption').innerText()).trim(), 'A titled lone image shows its caption');

        const carousel = page.getByRole('region', { name: 'Image carousel' }).first();
        assert.equal(await carousel.getAttribute('aria-roledescription'), 'carousel');
        const count = await carousel.locator('[data-carousel-slide]').count();
        assert.equal(await carousel.locator('figcaption').count(), count, 'Every slide has a caption');
        assert.equal(await carousel.getByRole('button', { name: /^Show slide \d+$/ }).count(), count);

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

        // a pointer resting over the carousel never pauses it: that read as
        // a randomly broken carousel
        await carousel.hover();
        await page.clock.runFor(5000);
        assert.equal((await state(carousel)).active, 2, 'Hover does not pause autoplay');

        await carousel.getByRole('button', { name: `Show slide ${count}`, exact: true }).click();
        now = await state(carousel);
        assert.deepEqual([now.active, now.shown], [count - 1, [count - 1]], 'A dot picks its slide');
        // the click's scroll-into-view reaches the IntersectionObserver in a
        // later real frame, which the fake clock does not advance
        await page.waitForTimeout(300);
        await page.clock.runFor(2500);
        assert.ok((await state(carousel)).fill > 0.3, 'Autoplay keeps running after a mouse click on a dot');
        await page.clock.runFor(3000);
        assert.equal((await state(carousel)).active, 0, 'Autoplay continues from the picked slide');

        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        assert.ok(await carousel.locator('[data-carousel-dot]:focus-visible').count(), 'A dot holds keyboard focus');
        const paused = (await state(carousel)).active;
        await page.clock.runFor(12000);
        assert.equal((await state(carousel)).active, paused, 'Keyboard focus on a dot pauses autoplay');
        // leave the dots without Tab, which could scroll the carousel away
        await carousel.locator('[data-carousel-dot]:focus').evaluate(dot => dot.blur());
        await page.clock.runFor(5500);
        assert.notEqual((await state(carousel)).active, paused, 'Leaving the dots resumes autoplay');

        assert.ok(
            await page.locator('main figure img').evaluateAll(images => images.every(image => getComputedStyle(image).borderTopStyle === 'solid' && parseFloat(getComputedStyle(image).borderTopWidth) > 0)),
            'Post figures and slides have a border',
        );
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }

    const reduced = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    try {
        const page = await reduced.newPage();
        await page.clock.install();
        await page.goto(`${origin}${POST}`);
        const carousel = page.getByRole('region', { name: 'Image carousel' }).first();
        await carousel.scrollIntoViewIfNeeded();
        await page.clock.runFor(12000);
        assert.equal((await state(carousel)).active, 0, 'Reduced motion never autoplays');
        await carousel.getByRole('button', { name: 'Show slide 2', exact: true }).click();
        assert.deepEqual((await state(carousel)).shown, [1], 'The dots still work under reduced motion');
    } finally {
        await reduced.close();
    }
}
