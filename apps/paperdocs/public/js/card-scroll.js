(() => {
    function initCardScroll() {
        const card = document.querySelector('.preview-card');
        const showcase = document.querySelector('.showcase-section');
        if (!card || !showcase) return;

        function getTargetY() {
            return window.innerHeight;
        }

        function updateCardTransform() {
            const scrollY = window.scrollY || window.pageYOffset;
            const targetY = getTargetY();
            // past the showcase the flight owns the card
            if (scrollY > targetY) return;
            const progress = targetY > 0 ? Math.min(1, Math.max(0, scrollY / targetY)) : 1;

            const cardTopInSection = card.offsetTop;
            // The card rests poking out of the hero's bottom edge, inviting the
            // scroll down; it settles into the showcase as you scroll. No scale,
            // so the rounded corners never appear to morph.
            const peekAmount = 120;
            const startOffset = -(cardTopInSection + peekAmount);

            const currentOffset = startOffset * (1 - progress);
            card.style.transform = `translate3d(0, ${currentOffset.toFixed(2)}px, 0)`;
        }

        // Scroll stays native: the card follows the user's scroll, it
        // never drives it.
        window.addEventListener('scroll', updateCardTransform, { passive: true });
        window.addEventListener('resize', updateCardTransform, { passive: true });

        // Tapping the peeking card is the invitation: it scrolls to the showcase.
        card.addEventListener('click', (event) => {
            if ((window.scrollY || 0) < getTargetY() * 0.5) {
                event.preventDefault();
                window.scrollTo({ top: getTargetY(), behavior: 'smooth' });
            }
        });

        // Measure again once layout, fonts and the placeholder image have
        // settled, so the card does not jump on the first scroll or click.
        updateCardTransform();
        requestAnimationFrame(updateCardTransform);
        window.addEventListener('load', updateCardTransform);
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(updateCardTransform);
        }
        // The card is flex-centred, so a sibling (dots bar, copy) changing
        // height re-centres it without changing the card's own size. Observe
        // the siblings too, or the peek drifts until the next scroll and jumps.
        if ('ResizeObserver' in window) {
            const observer = new ResizeObserver(updateCardTransform);
            observer.observe(card);
            const dots = document.querySelector('.dots-bar');
            if (dots) observer.observe(dots);
            const content = document.querySelector('.showcase-content');
            if (content) observer.observe(content);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCardScroll);
    } else {
        initCardScroll();
    }
})();
