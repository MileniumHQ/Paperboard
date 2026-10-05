// Brings a server-rendered BlogCarousel to life: the dots pick a slide, and
// autoplay advances one every SLIDE_MS while the active dot's progress bar
// fills. Autoplay runs only while the carousel is on screen and not hovered or
// focused, never under reduced motion, and stops for good once the reader
// picks a slide themselves. Returns the teardown for its observer and frame.
const SLIDE_MS = 5000;
// a background tab resumes with one frame's worth of progress, not a jump
const MAX_FRAME_MS = 100;

export function startCarousel(root: HTMLElement): () => void {
    const track = root.querySelector<HTMLElement>("[data-carousel-track]");
    const slides = [...root.querySelectorAll<HTMLElement>("[data-carousel-slide]")];
    const dots = [...root.querySelectorAll<HTMLButtonElement>("[data-carousel-dot]")];
    if (!track || slides.length < 2 || dots.length !== slides.length) {
        throw new Error("paperdocs: a carousel needs a track and one dot per slide");
    }

    let active = 0;
    let elapsed = 0;
    let frame = 0;
    let last: number | null = null;
    let autoplay = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = false;
    let hovered = false;
    let focused = false;

    const fill = (index: number) =>
        dots[index].querySelector<HTMLElement>("[data-carousel-progress]");

    function show(index: number) {
        fill(active)?.style.removeProperty("width");
        active = index;
        elapsed = 0;
        track!.style.transform = `translateX(-${index * 100}%)`;
        slides.forEach((slide, i) => {
            slide.inert = i !== index;
            if (i === index) slide.removeAttribute("aria-hidden");
            else slide.setAttribute("aria-hidden", "true");
        });
        dots.forEach((dot, i) => {
            if (i === index) dot.setAttribute("aria-current", "true");
            else dot.removeAttribute("aria-current");
        });
        if (autoplay) fill(index)?.style.setProperty("width", "0%");
    }

    function tick(now: number) {
        frame = 0;
        if (last !== null) elapsed += Math.min(now - last, MAX_FRAME_MS);
        last = now;
        if (elapsed >= SLIDE_MS) show((active + 1) % slides.length);
        fill(active)?.style.setProperty("width", `${(elapsed / SLIDE_MS) * 100}%`);
        sync();
    }

    // one place decides whether a frame is scheduled
    function sync() {
        const running = autoplay && visible && !hovered && !focused;
        if (running && !frame) {
            frame = requestAnimationFrame(tick);
        } else if (!running && frame) {
            cancelAnimationFrame(frame);
            frame = 0;
        }
        if (!running) last = null;
    }

    dots.forEach((dot, index) => {
        dot.addEventListener("click", () => {
            autoplay = false;
            show(index);
            sync();
        });
    });
    root.addEventListener("pointerenter", () => {
        hovered = true;
        sync();
    });
    root.addEventListener("pointerleave", () => {
        hovered = false;
        sync();
    });
    root.addEventListener("focusin", () => {
        focused = true;
        sync();
    });
    root.addEventListener("focusout", (event) => {
        focused = root.contains(event.relatedTarget as Node | null);
        sync();
    });

    const observer = new IntersectionObserver(
        (entries) => {
            visible = entries.some((entry) => entry.isIntersecting);
            sync();
        },
        { threshold: 0.5 },
    );
    observer.observe(root);
    show(0);

    return () => {
        observer.disconnect();
        autoplay = false;
        sync();
    };
}
