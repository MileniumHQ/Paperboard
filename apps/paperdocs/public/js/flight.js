(() => {
    // scroll choreography, card rises out while the aio descends in
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const V = () => window.innerHeight || 1;
    const lerp = (a, b, t) => a + (b - a) * t;
    // Section boundaries, read from layout because the later sections can be
    // taller than the viewport. The hero/showcase pair is left to card-scroll.
    const sectionTop = (selector, fallbackVh) => {
        const el = document.querySelector(selector);
        return el ? el.offsetTop : fallbackVh * V();
    };
    const ctaTop = () => sectionTop(".cta-section", 4);
    const closingTop = () => sectionTop(".outro-section", 5);
    const snapStops = () => [0, V(), 2 * V(), ctaTop(), closingTop()];
    const stopIndex = () => {
        const y = window.scrollY || 0;
        const list = snapStops();
        const tolerance = 0.07 * V();
        for (let i = 0; i < list.length; i++) {
            if (Math.abs(y - list[i]) < tolerance) return i;
        }
        return -1;
    };

    const canvas = document.getElementById("aio-stage");
    const card = document.querySelector(".preview-card");
    const frame = document.querySelector(".card-image-frame");
    const showcaseEl = document.querySelector(".showcase-section");
    const mainEl = document.querySelector(".page-layout");
    // rest pose of the frame, measured while nothing is pinned.
    // layout values only, so instant scroll jumps can't poison them
    let restDocLeft = 0;
    let restDocTop = 0;
    let restFw = 0;
    let restFh = 0;
    function measureRest() {
        if (!mainEl || !showcaseEl || !frame || !card) return;
        if (card.classList.contains("pinned")) return;
        // full offsetParent chain, will-change makes the card a level
        restDocLeft =
            mainEl.offsetLeft + showcaseEl.offsetLeft + card.offsetLeft + frame.offsetLeft;
        restDocTop =
            mainEl.offsetTop + showcaseEl.offsetTop + card.offsetTop + frame.offsetTop;
        restFw = frame.offsetWidth;
        restFh = frame.offsetHeight;
    }
    measureRest();
    window.addEventListener("load", measureRest);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureRest);
    // screen 3.6x2.7 at local (0, 2.49, 1.68), camera solved per frame.
    // match-cut nudge in screen px, pure translation, never tilts.
    // rest framing lives in aio-stage, the rest pose here follows it
    const NUDGE_X = 0;
    const NUDGE_Y = 0;
    const START_Y = 1.2;
    let restQuat = null;
    let identQuat = null;
    let fmx = 0;
    let fmy = 0;
    let fmz = 10;
    let haveFrozen = false;
    const chrome = [
        document.querySelector(".dots-bar"),
        document.querySelector(".showcase-content"),
    ].filter(Boolean);
    const dotsBar = document.querySelector(".dots-bar");
    const stageCopy = document.querySelector(".stage-copy");
    const dashEl = document.querySelector(".stage-dash");

    // snap between showcase and stage, scrub stays native
    let snapping = false;
    let upAcc = 0;
    let upTimer = null;
    let touchY = 0;

    function smoothScrollTo(target, dur = 650) {
        if (snapping) return;
        snapping = true;
        const y0 = window.scrollY || 0;
        const dy = target - y0;
        if (Math.abs(dy) < 2) {
            window.scrollTo(0, target);
            snapping = false;
            return;
        }
        const t0 = performance.now();
        function step(n) {
            const p = Math.min(1, (n - t0) / dur);
            window.scrollTo(0, y0 + dy * ease(p));
            if (p < 1) {
                requestAnimationFrame(step);
            } else {
                window.scrollTo(0, target);
                setTimeout(() => {
                    snapping = false;
                    upAcc = 0;
                }, 50);
            }
        }
        requestAnimationFrame(step);
    }

    function onWheel(e) {
        if (snapping) {
            e.preventDefault();
            return;
        }
        const index = stopIndex();
        if (index === -1) return;
        const stops = snapStops();
        if (e.deltaY > 0 && index >= 1 && index < stops.length - 1) {
            e.preventDefault();
            smoothScrollTo(stops[index + 1], 1100);
        } else if (e.deltaY < 0 && index >= 2) {
            clearTimeout(upTimer);
            upAcc += Math.abs(e.deltaY);
            if (upAcc > 35) {
                e.preventDefault();
                smoothScrollTo(stops[index - 1], 1100);
                upAcc = 0;
            } else {
                upTimer = setTimeout(() => {
                    upAcc = 0;
                }, 250);
            }
        }
    }

    function onTouchStart(e) {
        if (e.touches && e.touches.length) touchY = e.touches[0].clientY;
    }

    function onTouchMove(e) {
        if (snapping) {
            e.preventDefault();
            return;
        }
        if (!e.touches || !e.touches.length) return;
        const index = stopIndex();
        if (index === -1) return;
        const stops = snapStops();
        const diff = touchY - e.touches[0].clientY;
        if (diff > 12 && index >= 1 && index < stops.length - 1) {
            e.preventDefault();
            smoothScrollTo(stops[index + 1], 1100);
        } else if (diff < -40 && index >= 2) {
            e.preventDefault();
            smoothScrollTo(stops[index - 1], 1100);
        }
    }

    function onKeyDown(e) {
        const navDown = ["ArrowDown", "PageDown", " "].includes(e.key);
        const navUp = ["ArrowUp", "PageUp"].includes(e.key);
        if (snapping) {
            if (navDown || navUp) e.preventDefault();
            return;
        }
        const index = stopIndex();
        if (index === -1) return;
        const stops = snapStops();
        if (navDown && index >= 1 && index < stops.length - 1) {
            e.preventDefault();
            smoothScrollTo(stops[index + 1], 1100);
        } else if (navUp && index >= 2) {
            e.preventDefault();
            smoothScrollTo(stops[index - 1], 1100);
        }
    }

    let flightRaf = 0;
    let lastState = '';
    const nextFrame = () => { flightRaf = requestAnimationFrame(loop); };
    function loop() {
        const stageState = window.__aioStage;
        const state = [window.scrollY, innerWidth, innerHeight, stageState?.layoutVersion,
            stageState?.groupHover, ...(stageState?.companions || []).map(entry => entry.obj.rotation.y)].join(',');
        if (state === lastState || document.hidden) { nextFrame(); return; }
        lastState = state;
        window.__flight.ticks++;
        const vh = V();
        const W = window.innerWidth || 1;
        const s = (window.scrollY || 0) / vh;
        const stage = window.__aioStage;

        // The 3D lives for the showcase and stage; it fades out again before
        // the developer section so the lineup does not sit behind that card.
        const stageFade = Math.min(
            clamp01((s - 1) / 0.25),
            1 - clamp01((s - 2.4) / 0.4),
        );
        if (canvas) {
            canvas.style.opacity = String(stageFade);
        }

        // card held with fixed positioning while it fades.
        // sticky can't hold here, the section never scrolls internally.
        // dots keep a margin so nothing below jumps when the card leaves flow
        if (card) {
            const wantPin = s >= 1 && s < 1.25;
            const pinned = card.classList.contains("pinned");
            if (wantPin && !pinned) {
                // Drop card-scroll's transform before measuring, then pin to
                // the s=1 handoff pose. Measuring the live rect baked its
                // scaled width and a mid-flight top into inline styles, which
                // shrank the card and pushed it down into the dots bar.
                card.style.transform = "";
                const r = card.getBoundingClientRect();
                const top = r.top + (window.scrollY - window.innerHeight);
                card.style.position = "fixed";
                card.style.top = `${top.toFixed(1)}px`;
                card.style.left = `${r.left.toFixed(1)}px`;
                card.style.width = `${r.width.toFixed(1)}px`;
                card.classList.add("pinned");
                // Taking the card out of flow drops its box and the flex gap
                // that followed it; reserve both so the dots bar does not move.
                if (dotsBar) {
                    const gap = showcaseEl
                        ? parseFloat(getComputedStyle(showcaseEl).rowGap) || 0
                        : 0;
                    dotsBar.style.marginTop = `${(r.height + gap).toFixed(1)}px`;
                }
            } else if (!wantPin && pinned) {
                card.classList.remove("pinned");
                card.style.position = "";
                card.style.top = "";
                card.style.left = "";
                card.style.width = "";
                if (dotsBar) dotsBar.style.marginTop = "";
            }
            if (s >= 1 && card.classList.contains("pinned")) {
                card.style.transform = "";
            }
            if (s > 1 && s < 1.2) {
                card.style.opacity = String(1 - (s - 1) / 0.2);
            } else if (s >= 1.2) {
                card.style.opacity = "0";
            } else {
                card.style.opacity = "";
            }
        }
        const chromeQ = clamp01((s - 1.0) / 0.06);
        chrome.forEach((el) => {
            el.style.opacity = s > 1 ? String(1 - chromeQ) : "";
        });

        if (stageCopy) {
            stageCopy.style.opacity = s > 1.7 ? String(clamp01((s - 1.7) / 0.3)) : "0";
        }

        // glued while the card is visible, then one straight descent.
        // camera frozen at the handoff, so the path never bends mid-flight
        if (stage && s >= 0.9) {
            const cam = stage.camera;
            const g = stage.group;
            const RP = stage.REST_POS;
            const RL = stage.REST_LOOK;
            const tan = Math.tan(((cam.fov || 38) * Math.PI) / 360);
            const bufH = (canvas && canvas.clientHeight) || vh;
            const refX =
                (document.documentElement && document.documentElement.clientWidth) || W;
            const aspect = W / vh;
            const home = stage.home || { x: -5.5, y: 0, scale: 0.4, rot: 0.9 };
            const turn = stage.hoverTurn !== undefined ? stage.hoverTurn : 0.65;
            const q = ease(clamp01((s - 1.0) / 1.0));
            const S = lerp(1, home.scale, q);
            g.scale.setScalar(S);
            g.position.set(lerp(0, home.x, q), lerp(START_Y, home.y, q), 0);
            g.rotation.y = home.rot * q * (1 - turn * (stage.groupHover || 0));
            if (q === 1) stage.applyHomePose();

            // Wait for the moving all-in-one to reach its packed footprint.
            // The same bounds used by layout guard the transition as well.
            const fq = stage.companionsClear?.() ? clamp01((q - 0.985) / 0.015) : 0;
            if (stage.companions) {
                stage.companions.forEach((c) => {
                    c.obj.visible = c.enabled !== false && fq > 0.001;
                    c.mats.forEach((m) => {
                        m.opacity = (m.userData.baseOpacity || 1) * fq;
                    });
                });
            }

            // match solved once against the card at rest, never tracked.
            // the card detaches the instant scrolling starts
            const MS = 1;
            const rect = frame ? frame.getBoundingClientRect() : null;
            if (s > 0.9 && s <= 1 && rect && rect.height > 1) {
                const d = ((2.7 * MS) * bufH) / (2 * rect.height * tan);
                const wpp = (2 * d * tan) / bufH;
                const fx = rect.left + rect.width / 2 + NUDGE_X;
                const fy = rect.top + rect.height / 2 + NUDGE_Y;
                fmx = 0 - (fx - refX / 2) * (wpp * aspect);
                fmy = START_Y + 2.49 * MS + (fy - bufH / 2) * wpp;
                fmz = 1.68 * MS + d;
                haveFrozen = true;
            } else if (!haveFrozen) {
                // jumped straight past the handoff, use measured rest pose
                if (restFh > 1) {
                    const fx = restDocLeft + restFw / 2 + NUDGE_X;
                    const fy = restDocTop + restFh / 2 - vh + NUDGE_Y;
                    const d = ((2.7 * MS) * bufH) / (2 * restFh * tan);
                    const wpp = (2 * d * tan) / bufH;
                    fmx = 0 - (fx - refX / 2) * (wpp * aspect);
                    fmy = START_Y + 2.49 * MS + (fy - bufH / 2) * wpp;
                    fmz = 1.68 * MS + d;
                    haveFrozen = true;
                } else {
                    fmx = RP[0];
                    fmy = RP[1];
                    fmz = RP[2];
                }
            }

            if (s <= 1) {
                cam.position.set(fmx, fmy, fmz);
                cam.rotation.set(0, 0, 0);
            } else {
                const q2 = ease(clamp01((s - 1.0) / 1.0));
                cam.position.set(
                    fmx + (RP[0] - fmx) * q2,
                    fmy + (RP[1] - fmy) * q2,
                    fmz + (RP[2] - fmz) * q2
                );
                const T = stage.THREE;
                if (T) {
                    if (!restQuat) {
                        const m = new T.Matrix4().lookAt(
                            new T.Vector3(RP[0], RP[1], RP[2]),
                            new T.Vector3(RL[0], RL[1], RL[2]),
                            new T.Vector3(0, 1, 0)
                        );
                        restQuat = new T.Quaternion().setFromRotationMatrix(m);
                        identQuat = new T.Quaternion();
                    }
                    cam.quaternion.slerpQuaternions(identQuat, restQuat, q2);
                }
            }
            cam.updateProjectionMatrix();

            // dom dash tracks the layout's data run, resolved in screen space
            // from the projected model boxes so it never clips into a machine
            if (dashEl && stage.THREE) {
                const dash = stage.dash;
                if (!dash || !dash.enabled || !dash.from || !dash.to) {
                    dashEl.style.visibility = "hidden";
                } else {
                    const THREE = stage.THREE;
                    const cw = canvas.clientWidth || 1;
                    const chh = canvas.clientHeight || 1;
                    // project() needs a current inverse; the renderer would only
                    // refresh it later this frame.
                    cam.updateMatrixWorld();
                    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
                    const projectBox = (obj) => {
                        const box = new THREE.Box3().setFromObject(obj);
                        let minX = Infinity;
                        let maxX = -Infinity;
                        let minY = Infinity;
                        let maxY = -Infinity;
                        for (const x of [box.min.x, box.max.x]) {
                            for (const y of [box.min.y, box.max.y]) {
                                for (const z of [box.min.z, box.max.z]) {
                                    const v = new THREE.Vector3(x, y, z).project(cam);
                                    const px = (v.x * 0.5 + 0.5) * cw;
                                    const py = (-v.y * 0.5 + 0.5) * chh;
                                    minX = Math.min(minX, px);
                                    maxX = Math.max(maxX, px);
                                    minY = Math.min(minY, py);
                                    maxY = Math.max(maxY, py);
                                }
                            }
                        }
                        return { minX, maxX, minY, maxY };
                    };
                    const fromBoxes = dash.from.map(projectBox);
                    const toBox = projectBox(dash.to);
                    const x0 = Math.max(...fromBoxes.map(box => box.maxX)) + 2;
                    const x1 = toBox.minX - 2;
                    const y0 = (toBox.minY + toBox.maxY) / 2;
                    // Grow by width, not scaleX: scaling the element stretched
                    // the repeating dash pattern until it "normalised".
                    dashEl.style.left = `${x0.toFixed(1)}px`;
                    dashEl.style.top = `${y0.toFixed(1)}px`;
                    dashEl.style.width = `${(Math.max(0, x1 - x0) * fq).toFixed(1)}px`;
                    dashEl.style.visibility = fq > 0.01 ? "visible" : "hidden";
                    dashEl.style.opacity = String(stageFade);
                    dashEl.style.transform = "none";
                }
            }
        }

        nextFrame();
    }

    window.__flight = { ticks: 0, error: null };
    window.addEventListener("error", (e) => {
        if (e.filename && e.filename.includes("flight.js")) {
            window.__flight.error = e.message;
        }
    });
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    if (canvas && card) nextFrame();
    window.addEventListener('pagehide', () => cancelAnimationFrame(flightRaf), { once: true });
})();
