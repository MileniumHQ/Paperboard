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

    // Mobile panel: the inline nav is hidden below 900px, so this carries the
    // same links. It closes on link activation, outside click, and Escape.
    const mobileToggle = document.querySelector(".site-topbar__mobile-toggle");
    const mobilePanel = document.getElementById("site-mobile-menu");
    if (mobileToggle && mobilePanel) {
        const setMobile = (open) => {
            mobilePanel.hidden = !open;
            mobileToggle.setAttribute("aria-expanded", String(open));
            mobileToggle.classList.toggle("is-open", open);
            const icon = mobileToggle.querySelector(".icon");
            if (icon) {
                icon.classList.toggle("icon-menu", !open);
                icon.classList.toggle("icon-close", open);
            }
        };
        mobileToggle.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            setMobile(mobilePanel.hidden);
        });
        mobilePanel.addEventListener("click", (event) => {
            if (event.target.closest("a")) setMobile(false);
        });
        document.addEventListener("click", (event) => {
            if (
                !mobilePanel.hidden &&
                !mobilePanel.contains(event.target) &&
                !mobileToggle.contains(event.target)
            ) {
                setMobile(false);
            }
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") setMobile(false);
        });
    }
})();
