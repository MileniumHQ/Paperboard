(() => {
    function initDotsBar() {
        const dots = document.querySelectorAll('.dots-bar .dot');
        const track = document.querySelector('.card-slides-track');
        const caption = document.querySelector('.card-caption');
        const captionTitle = document.querySelector('.caption-title');
        const captionDesc = document.querySelector('.caption-desc');
        if (!dots.length) return;

        const captions = [
            { title: "Game Server", desc: "Run, and manage Minecraft Servers" },
            { title: "Bot Creator", desc: "Create Discord bots without any coding." },
            { title: "Actions", desc: "Build flows and automate panels to work together." },
            { title: "Expand-ability", desc: "Download more panels from the Panel Library" },
            { title: "Terminal", desc: "Access a PTY from anywhere" }
        ];

        let activeIndex = 0;
        let startTime = null;
        let animId = null;
        let captionTimer = null;
        let paused = true;
        let started = false;
        const DURATION = 3000;

        function setProgress(percent) {
            const activeDot = dots[activeIndex];
            if (!activeDot) return;
            const fill = activeDot.querySelector('.dot-progress');
            if (fill) {
                fill.style.opacity = '1';
                fill.style.width = `${percent.toFixed(2)}%`;
            }
        }

        function updateSlide(newIndex) {
            if (track) {
                track.style.transform = `translateX(-${newIndex * 100}%)`;
            }

            if (caption && captionTitle && captionDesc && captions[newIndex]) {
                clearTimeout(captionTimer);
                caption.classList.add('fade');
                captionTimer = setTimeout(() => {
                    captionTitle.textContent = captions[newIndex].title;
                    captionDesc.textContent = captions[newIndex].desc;
                    caption.classList.remove('fade');
                }, 220);
            }
        }

        // Tell the 3D stage which screen to render (the models mirror the carousel).
        function announce(newIndex) {
            const slide = track ? track.children[newIndex] : null;
            const src = slide ? slide.getAttribute('src') : null;
            if (!src) return;
            document.dispatchEvent(
                new CustomEvent('paperboard:slide', {
                    detail: { index: newIndex, src },
                }),
            );
        }

        function transitionTo(newIndex) {
            if (animId) {
                cancelAnimationFrame(animId);
            }

            const oldDot = dots[activeIndex];
            if (oldDot && oldDot !== dots[newIndex]) {
                const oldFill = oldDot.querySelector('.dot-progress');
                oldDot.classList.remove('active');
                if (oldFill) {
                    oldFill.style.opacity = '0';
                    setTimeout(() => {
                        oldFill.style.width = '0%';
                        oldFill.style.opacity = '1';
                    }, 450);
                }
            }

            activeIndex = newIndex;
            const nextDot = dots[activeIndex];
            if (nextDot) {
                const nextFill = nextDot.querySelector('.dot-progress');
                if (nextFill) {
                    nextFill.style.width = '0%';
                    nextFill.style.opacity = '1';
                }
                nextDot.classList.add('active');
            }

            updateSlide(newIndex);
            announce(newIndex);

            startTime = performance.now();
            if (!paused) {
                animId = requestAnimationFrame(loop);
            }
        }

        function loop(timestamp) {
            if (paused) {
                animId = null;
                return;
            }
            if (!startTime) startTime = timestamp;
            const elapsed = timestamp - startTime;
            const progress = Math.min(1, elapsed / DURATION);
            setProgress(progress * 100);

            if (progress < 1) {
                animId = requestAnimationFrame(loop);
            } else {
                const nextIndex = (activeIndex + 1) % dots.length;
                transitionTo(nextIndex);
            }
        }

        dots.forEach((dot, i) => {
            dot.addEventListener('click', () => {
                transitionTo(i);
            });
        });

        // Autoplay runs only while the card is actually in view, and pauses
        // again when it scrolls away — the peeking sliver at the hero's bottom
        // must not drive the slideshow.
        const previewCard = document.querySelector('.preview-card');
        if (previewCard && 'IntersectionObserver' in window) {
            const io = new IntersectionObserver(
                (entries) => {
                    const visible = entries.some((e) => e.isIntersecting);
                    if (visible) {
                        paused = false;
                        if (!started) {
                            started = true;
                            transitionTo(0);
                        } else {
                            transitionTo(activeIndex);
                        }
                    } else {
                        paused = true;
                        if (animId) {
                            cancelAnimationFrame(animId);
                            animId = null;
                        }
                    }
                },
                { threshold: 0.4 },
            );
            io.observe(previewCard);
        } else {
            paused = false;
            transitionTo(0);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDotsBar);
    } else {
        initDotsBar();
    }
})();
