(() => {
    const section = document.querySelector(".cta-section");
    if (!section) return;

    const reveal = () => section.classList.add("is-visible");
    if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    reveal();
                    observer.disconnect();
                }
            },
            { threshold: 0.25 },
        );
        observer.observe(section);
    } else {
        reveal();
    }
})();
