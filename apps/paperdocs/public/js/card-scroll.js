(() => {
    function initCardScroll() {
        const card = document.querySelector('.preview-card');
        const showcase = document.querySelector('.showcase-section');
        if (!card || !showcase) return;

        let isAnimating = false;
        let upAccumulator = 0;
        let touchStartY = 0;
        let wheelResetTimer = null;

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

        function smoothScrollTo(targetY, duration = 650, callback) {
            if (isAnimating) return;
            isAnimating = true;

            const startY = window.scrollY || window.pageYOffset;
            const diff = targetY - startY;
            if (Math.abs(diff) < 2) {
                window.scrollTo(0, targetY);
                updateCardTransform();
                isAnimating = false;
                if (callback) callback();
                return;
            }

            const startTime = performance.now();

            function ease(t) {
                return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            }

            function step(now) {
                const elapsed = now - startTime;
                const progress = Math.min(1, elapsed / duration);
                const currentY = startY + diff * ease(progress);

                window.scrollTo(0, currentY);
                updateCardTransform();

                if (progress < 1) {
                    requestAnimationFrame(step);
                } else {
                    window.scrollTo(0, targetY);
                    updateCardTransform();
                    setTimeout(() => {
                        isAnimating = false;
                        upAccumulator = 0;
                        if (callback) callback();
                    }, 50);
                }
            }

            requestAnimationFrame(step);
        }

        function onWheel(e) {
            const scrollY = window.scrollY || window.pageYOffset;
            const targetY = getTargetY();

            if (isAnimating) {
                e.preventDefault();
                return;
            }

            if (scrollY <= 10 && e.deltaY > 0) {
                e.preventDefault();
                smoothScrollTo(targetY);
                return;
            }

            if (scrollY >= targetY - 20 && scrollY <= targetY + 20 && e.deltaY < 0) {
                clearTimeout(wheelResetTimer);
                upAccumulator += Math.abs(e.deltaY);
                if (upAccumulator > 35) {
                    e.preventDefault();
                    smoothScrollTo(0);
                    upAccumulator = 0;
                } else {
                    wheelResetTimer = setTimeout(() => {
                        upAccumulator = 0;
                    }, 250);
                }
            }
        }

        function onTouchStart(e) {
            if (e.touches && e.touches.length) {
                touchStartY = e.touches[0].clientY;
            }
        }

        function onTouchMove(e) {
            if (isAnimating) {
                e.preventDefault();
                return;
            }
            if (!e.touches || !e.touches.length) return;
            const currentY = e.touches[0].clientY;
            const diffY = touchStartY - currentY;
            const scrollY = window.scrollY || window.pageYOffset;
            const targetY = getTargetY();

            if (scrollY <= 10 && diffY > 12) {
                e.preventDefault();
                smoothScrollTo(targetY);
            } else if (scrollY >= targetY - 20 && scrollY <= targetY + 20 && diffY < -40) {
                e.preventDefault();
                smoothScrollTo(0);
            }
        }

        function onKeyDown(e) {
            const scrollY = window.scrollY || window.pageYOffset;
            const targetY = getTargetY();

            if (isAnimating) {
                if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' '].includes(e.key)) {
                    e.preventDefault();
                }
                return;
            }

            if (scrollY <= 10 && ['ArrowDown', 'PageDown', ' '].includes(e.key)) {
                e.preventDefault();
                smoothScrollTo(targetY);
            } else if (scrollY >= targetY - 20 && scrollY <= targetY + 20 && ['ArrowUp', 'PageUp'].includes(e.key)) {
                e.preventDefault();
                smoothScrollTo(0);
            }
        }

        function onScroll() {
            if (!isAnimating) {
                updateCardTransform();
            }
        }

        window.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('touchstart', onTouchStart, { passive: true });
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', updateCardTransform, { passive: true });

        // Tapping the peeking card is the invitation: it scrolls to the showcase.
        card.addEventListener('click', (event) => {
            if ((window.scrollY || 0) < getTargetY() * 0.5) {
                event.preventDefault();
                smoothScrollTo(getTargetY());
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
