(() => {
    const menus = [...document.querySelectorAll("[data-topbar-menu]")];
    if (!menus.length) return;

    const closeAll = (except) => {
        for (const menu of menus) {
            if (menu === except) continue;
            menu.classList.remove("is-open");
            menu.querySelector(".site-topbar__trigger").setAttribute(
                "aria-expanded",
                "false",
            );
        }
    };

    const setOpen = (menu, open) => {
        menu.classList.toggle("is-open", open);
        menu.querySelector(".site-topbar__trigger").setAttribute(
            "aria-expanded",
            String(open),
        );
    };

    menus.forEach((menu) => {
        const trigger = menu.querySelector(".site-topbar__trigger");
        let closeTimer = null;
        trigger.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const open = !menu.classList.contains("is-open");
            closeAll(menu);
            setOpen(menu, open);
        });
        menu.addEventListener("pointerenter", () => {
            clearTimeout(closeTimer);
            closeAll(menu);
            setOpen(menu, true);
        });
        menu.addEventListener("pointerleave", () => {
            clearTimeout(closeTimer);
            closeTimer = setTimeout(() => setOpen(menu, false), 140);
        });
    });

    document.addEventListener("click", () => closeAll(null));
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeAll(null);
    });
})();
