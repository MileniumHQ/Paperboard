// Learn-page screenshots open full screen in the page's one modal <dialog>.
// Without this script each screenshot is a plain link to its image file.
(() => {
    const dialog = document.querySelector(".learn-lightbox");
    const image = dialog?.querySelector(".learn-lightbox-image");
    if (!dialog || !image || typeof dialog.showModal !== "function") return;
    const links = document.querySelectorAll("[data-lightbox]");
    for (const link of links) link.setAttribute("aria-haspopup", "dialog");
    let opener = null;

    document.addEventListener("click", (event) => {
        const link = event.target instanceof Element && event.target.closest("[data-lightbox]");
        // Modified clicks keep their browser meaning (new tab, download).
        if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const source = link.querySelector("img");
        if (!source) return;
        event.preventDefault();
        opener = link;
        image.src = link.href;
        image.alt = source.alt;
        dialog.setAttribute("aria-label", source.alt || "Screenshot");
        dialog.showModal();
    });

    // Any click inside closes it: the backdrop, the image, or the close
    // button. Escape closes it natively.
    dialog.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
        image.removeAttribute("src");
        opener?.focus();
        opener = null;
    });
})();
