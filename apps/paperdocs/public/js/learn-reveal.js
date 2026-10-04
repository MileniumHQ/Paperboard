// Content stays visible with no JS, reduced motion, or unsupported observers.
(() => {
    const sections = [...document.querySelectorAll(".learn-page [data-reveal]")];
    if (
        !("IntersectionObserver" in window) ||
        matchMedia("(prefers-reduced-motion: reduce)").matches
    )
        return;
    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                entry.target.classList.remove("is-pending");
                observer.unobserve(entry.target);
            }
        },
        { threshold: 0.12 },
    );
    for (const section of sections) {
        if (section.getBoundingClientRect().top > innerHeight) section.classList.add("is-pending");
        observer.observe(section);
    }
    addEventListener("pagehide", () => observer.disconnect(), { once: true });
})();
