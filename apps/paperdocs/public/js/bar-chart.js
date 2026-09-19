(() => {
    // Horizontal bar chart. Data is lorem placeholder; "better" decides which
    // bar gets the accent, matching the "lower/higher is better" line.
    const CHARTS = {
        lorem: {
            title: "Lorem ipsum dolor",
            note: "lower is better",
            better: "lower",
            rows: [
                { label: "Adipiscing", value: 34, text: "1h 40m" },
                { label: "Elit sed do", value: 78, text: "3h 12m" },
                { label: "Eiusmod tempor", value: 92, text: "4h 05m" },
            ],
        },
        ipsum: {
            title: "Ipsum dolor sit",
            note: "higher is better",
            better: "higher",
            rows: [
                { label: "Consectetur", value: 55, text: "1h 10m" },
                { label: "Adipiscing elit", value: 91, text: "2h 48m" },
                { label: "Sed do eiusmod", value: 47, text: "58m" },
            ],
        },
        dolar: {
            title: "Dolar sit amet",
            note: "lower is better",
            better: "lower",
            rows: [
                { label: "Tempor incididunt", value: 72, text: "2h 30m" },
                { label: "Ut labore", value: 38, text: "45m" },
                { label: "Dolore magna", value: 60, text: "1h 55m" },
            ],
        },
    };
    const SCALE = 100;

    const section = document.querySelector(".chart-section");
    if (!section) return;

    const tabs = [...section.querySelectorAll(".chart-tab")];
    const panel = section.querySelector(".chart-card");
    const titleEl = section.querySelector(".chart-title");
    const noteEl = section.querySelector(".chart-subtitle");
    const rowsEl = section.querySelector(".chart-rows");
    const details = section.querySelector(".chart-details");
    const detailsToggle = section.querySelector(".chart-details-toggle");
    const detailsLabel = section.querySelector(".chart-details-label");

    function render(key) {
        const chart = CHARTS[key];
        if (!chart) return;

        titleEl.textContent = chart.title;
        noteEl.textContent = chart.note;

        const values = chart.rows.map((row) => row.value);
        const target =
            chart.better === "lower"
                ? Math.min(...values)
                : Math.max(...values);

        rowsEl.replaceChildren();
        const pending = [];
        chart.rows.forEach((row) => {
            const rowEl = document.createElement("div");
            rowEl.className = "bar-row";
            if (row.value === target) rowEl.classList.add("is-best");

            const label = document.createElement("span");
            label.className = "bar-label";
            label.textContent = row.label;

            const track = document.createElement("span");
            track.className = "bar-track";
            track.setAttribute("aria-hidden", "true");
            const fill = document.createElement("span");
            fill.className = "bar-fill";
            track.append(fill);

            const amount = document.createElement("span");
            amount.className = "bar-value";
            amount.textContent = row.text;

            const value = document.createElement("span");
            value.className = "sr-only";
            value.textContent = `${row.label}: ${row.text}`;

            rowEl.append(label, track, amount, value);
            rowsEl.append(rowEl);

            const pct = Math.max(0, Math.min(100, (row.value / SCALE) * 100));
            pending.push({ fill, pct });
        });

        // Set the widths a frame later so the fills animate up from zero.
        requestAnimationFrame(() => {
            pending.forEach(({ fill, pct }) => {
                fill.style.setProperty("--pct", `${pct.toFixed(1)}%`);
            });
        });
    }

    function selectTab(tab, focus) {
        tabs.forEach((candidate) => {
            const active = candidate === tab;
            candidate.setAttribute("aria-selected", String(active));
            candidate.tabIndex = active ? 0 : -1;
        });
        panel.setAttribute("aria-labelledby", tab.id);
        render(tab.dataset.chart);
        if (focus) tab.focus();
    }

    tabs.forEach((tab) => {
        tab.addEventListener("click", () => selectTab(tab, false));
        tab.addEventListener("keydown", (event) => {
            const index = tabs.indexOf(tab);
            let next = -1;
            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                next = (index + 1) % tabs.length;
            } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                next = (index - 1 + tabs.length) % tabs.length;
            } else if (event.key === "Home") {
                next = 0;
            } else if (event.key === "End") {
                next = tabs.length - 1;
            }
            if (next >= 0) {
                event.preventDefault();
                selectTab(tabs[next], true);
            }
        });
    });

    function setDetails(open) {
        detailsToggle.setAttribute("aria-expanded", String(open));
        details.classList.toggle("is-open", open);
        detailsLabel.textContent = open ? "Hide Details" : "Show Details";
    }

    detailsToggle.addEventListener("click", () => {
        setDetails(detailsToggle.getAttribute("aria-expanded") !== "true");
    });
    setDetails(true);

    selectTab(tabs[0], false);

    const reveal = () => section.classList.add("is-visible", "bars-in");
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
