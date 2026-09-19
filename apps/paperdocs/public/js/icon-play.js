(() => {
    const field = document.querySelector("[data-play-field]");
    if (!field) return;
    const icons = [...field.querySelectorAll(".play-icon")];
    if (!icons.length) return;

    const SIZE = 84;
    const DAMPING = 0.99;
    const RESTITUTION = 0.86;
    const STOP_SPEED = 5;
    const ANG_DAMPING = 0.985;
    const ANG_STOP = 0.05;
    const MAX_TILT = 0.5;
    const EDGE_INSET = 78;
    const MAX_SPEED = 1800;
    const CANDIDATES = 32;
    const reduceMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const items = [];
    let W = 0;
    let H = 0;
    let running = false;
    let raf = 0;
    let last = 0;

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    function measure() {
        const rect = field.getBoundingClientRect();
        W = rect.width;
        H = rect.height;
    }

    // Resting lean follows horizontal position: right of centre leans right,
    // left of centre leans left — and the rule reverses on the bottom half, so
    // the scatter reads as a gentle swirl rather than all leaning one way.
    function tiltFor(item) {
        const travel = Math.max(1, W - item.size);
        const nx = (item.x / travel) * 2 - 1;
        const bottom = item.y + item.size / 2 > H / 2;
        return (bottom ? -1 : 1) * nx * MAX_TILT;
    }

    function setTransform(item) {
        item.el.style.transform = `translate3d(${item.x.toFixed(1)}px, ${item.y.toFixed(1)}px, 0) rotate(${item.angle.toFixed(3)}rad)`;
    }

    function atRest(item) {
        return (
            !item.dragging &&
            !item.vx &&
            !item.vy &&
            !item.av &&
            Math.abs(item.angle - tiltFor(item)) < 0.002
        );
    }

    // Bands around a central exclusion, themselves inset from the section
    // edges so icons do not spawn hugging the frame.
    function bands() {
        const exW = W * 0.62;
        const exH = H * 0.4;
        const exX = (W - exW) / 2;
        const exY = (H - exH) / 2;
        return [
            { x: EDGE_INSET, y: EDGE_INSET, w: W - EDGE_INSET * 2, h: exY - EDGE_INSET },
            {
                x: EDGE_INSET,
                y: exY + exH,
                w: W - EDGE_INSET * 2,
                h: H - EDGE_INSET - (exY + exH),
            },
            { x: EDGE_INSET, y: exY, w: exX - EDGE_INSET, h: exH },
            { x: exX + exW, y: exY, w: W - EDGE_INSET - (exX + exW), h: exH },
        ].filter((band) => band.w >= SIZE && band.h >= SIZE);
    }

    function scatter() {
        measure();
        const regions = bands();
        items.length = 0;
        const placed = [];

        icons.forEach((el) => {
            const item = {
                el,
                size: SIZE,
                x: 0,
                y: 0,
                vx: 0,
                vy: 0,
                angle: 0,
                av: 0,
                dragging: false,
                pointerId: null,
                grabX: 0,
                grabY: 0,
                lastT: 0,
                moved: false,
                downX: 0,
                downY: 0,
            };
            el.style.width = `${SIZE}px`;
            el.style.height = `${SIZE}px`;

            // Mitchell's best-candidate: sample points and keep the one that is
            // furthest from everything already placed, so the scatter reads as
            // even and never self-overlaps.
            let best = { x: 0, y: 0 };
            let bestDistance = -1;
            for (let attempt = 0; attempt < CANDIDATES; attempt += 1) {
                const band = regions.length
                    ? regions[Math.floor(Math.random() * regions.length)]
                    : {
                          x: EDGE_INSET,
                          y: EDGE_INSET,
                          w: W - EDGE_INSET * 2,
                          h: H - EDGE_INSET * 2,
                      };
                const candidate = {
                    x: band.x + Math.random() * Math.max(0, band.w - SIZE),
                    y: band.y + Math.random() * Math.max(0, band.h - SIZE),
                };
                let nearest = Infinity;
                for (const other of placed) {
                    nearest = Math.min(
                        nearest,
                        Math.hypot(candidate.x - other.x, candidate.y - other.y),
                    );
                }
                if (nearest > bestDistance) {
                    bestDistance = nearest;
                    best = candidate;
                }
            }
            item.x = best.x;
            item.y = best.y;
            item.angle = tiltFor(item);
            placed.push({ x: item.x, y: item.y });
            items.push(item);
            setTransform(item);
        });
    }

    function clampAll() {
        measure();
        for (const item of items) {
            item.x = clamp(item.x, 0, Math.max(0, W - item.size));
            item.y = clamp(item.y, 0, Math.max(0, H - item.size));
            setTransform(item);
        }
    }

    function step(now) {
        const dt = last ? Math.min(0.033, (now - last) / 1000) : 0.016;
        last = now;
        let moving = false;
        for (const item of items) {
            if (item.dragging) {
                moving = true;
                continue;
            }
            const flat = item.vx === 0 && item.vy === 0;

            if (!flat) {
                item.x += item.vx * dt;
                item.y += item.vy * dt;
                const maxX = Math.max(0, W - item.size);
                const maxY = Math.max(0, H - item.size);
                if (item.x <= 0) {
                    item.x = 0;
                    item.vx = Math.abs(item.vx) * RESTITUTION;
                } else if (item.x >= maxX) {
                    item.x = maxX;
                    item.vx = -Math.abs(item.vx) * RESTITUTION;
                }
                if (item.y <= 0) {
                    item.y = 0;
                    item.vy = Math.abs(item.vy) * RESTITUTION;
                } else if (item.y >= maxY) {
                    item.y = maxY;
                    item.vy = -Math.abs(item.vy) * RESTITUTION;
                }
                item.vx *= DAMPING;
                item.vy *= DAMPING;
                if (Math.hypot(item.vx, item.vy) < STOP_SPEED) {
                    item.vx = 0;
                    item.vy = 0;
                }
            }

            if (item.av !== 0) {
                item.angle += item.av * dt;
                item.av *= ANG_DAMPING;
                if (Math.abs(item.av) < ANG_STOP) item.av = 0;
            } else {
                // settle back to the position-matched lean, never upside down
                const tilt = tiltFor(item);
                item.angle += (tilt - item.angle) * 0.08;
                if (Math.abs(tilt - item.angle) < 0.002) item.angle = tilt;
            }

            if (!atRest(item)) moving = true;
            setTransform(item);
        }
        if (moving) {
            raf = requestAnimationFrame(step);
        } else {
            running = false;
        }
    }

    function start() {
        if (running) return;
        running = true;
        last = 0;
        raf = requestAnimationFrame(step);
    }

    function stop() {
        running = false;
        cancelAnimationFrame(raf);
    }

    function spin(item, strength) {
        item.av = (Math.random() < 0.5 ? -1 : 1) * strength;
        start();
    }

    function onPointerDown(event) {
        const item = items.find((candidate) => candidate.el === event.currentTarget);
        if (!item) return;
        event.preventDefault();
        item.dragging = true;
        item.pointerId = event.pointerId;
        const rect = field.getBoundingClientRect();
        item.grabX = event.clientX - rect.left - item.x;
        item.grabY = event.clientY - rect.top - item.y;
        item.lastT = event.timeStamp;
        item.downX = event.clientX;
        item.downY = event.clientY;
        item.moved = false;
        item.vx = 0;
        item.vy = 0;
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch (e) {}
        event.currentTarget.classList.add("is-dragging");
    }

    function onPointerMove(event) {
        const item = items.find(
            (candidate) => candidate.dragging && candidate.pointerId === event.pointerId,
        );
        if (!item) return;
        if (
            Math.hypot(event.clientX - item.downX, event.clientY - item.downY) > 4
        ) {
            item.moved = true;
        }
        const rect = field.getBoundingClientRect();
        const nextX = clamp(
            event.clientX - rect.left - item.grabX,
            0,
            Math.max(0, W - item.size),
        );
        const nextY = clamp(
            event.clientY - rect.top - item.grabY,
            0,
            Math.max(0, H - item.size),
        );
        const dt = Math.max(0.008, (event.timeStamp - item.lastT) / 1000);
        item.vx = clamp((nextX - item.x) / dt, -MAX_SPEED, MAX_SPEED);
        item.vy = clamp((nextY - item.y) / dt, -MAX_SPEED, MAX_SPEED);
        item.x = nextX;
        item.y = nextY;
        item.lastT = event.timeStamp;
        setTransform(item);
    }

    function onPointerUp(event) {
        const item = items.find(
            (candidate) => candidate.dragging && candidate.pointerId === event.pointerId,
        );
        if (!item) return;
        item.dragging = false;
        item.pointerId = null;
        item.el.classList.remove("is-dragging");
        try {
            if (item.el.hasPointerCapture(event.pointerId)) {
                item.el.releasePointerCapture(event.pointerId);
            }
        } catch (e) {}

        if (!item.moved) {
            // a click, not a drag: give it a playful spin in place
            item.vx = 0;
            item.vy = 0;
            if (!reduceMotion) spin(item, 2 + Math.random() * 3);
            return;
        }

        const speed = Math.hypot(item.vx, item.vy);
        if (speed > MAX_SPEED) {
            item.vx *= MAX_SPEED / speed;
            item.vy *= MAX_SPEED / speed;
        }
        if (reduceMotion) {
            item.vx = 0;
            item.vy = 0;
            return;
        }
        spin(item, clamp(speed / 320, 0.8, 6));
    }

    for (const icon of icons) {
        icon.addEventListener("pointerdown", onPointerDown);
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("resize", clampAll);

    // Scatter only once the section is actually on screen, so the StyledText
    // (async custom element) has finished laying out and the CTA's real bounds
    // are known — otherwise the first scatter plants icons over the heading.
    let scattered = false;
    const place = () => {
        if (scattered) return;
        scattered = true;
        scatter();
    };

    if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    place();
                    if (items.some((item) => !atRest(item))) start();
                } else {
                    stop();
                }
            },
            { threshold: 0 },
        );
        observer.observe(field);
    } else {
        place();
    }
})();
