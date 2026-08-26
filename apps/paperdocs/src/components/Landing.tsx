import { PaperText } from "@paperboard-dev/paperui";
import styles from "./landing.module.css";
import { createSignal, onMount, onCleanup, For } from "solid-js";

function gradientMaker() {
    const getRandomColor = () => ({
        h: Math.floor(Math.random() * 360),
        s: Math.floor(Math.random() * 40) + 40,
        l: Math.floor(Math.random() * 20) + 40,
    });

    const c1 = getRandomColor();
    const c2 = getRandomColor();

    let hMid;
    const hueDiff = Math.abs(c1.h - c2.h);

    if (hueDiff <= 180) {
        hMid = (c1.h + c2.h) / 2;
    } else {
        hMid = ((c1.h + c2.h + 360) / 2) % 360;
    }

    const sMid = (c1.s + c2.s) / 2;
    const lMid = (c1.l + c2.l) / 2;

    const color1 = `hsl(${c1.h}, ${c1.s}%, ${c1.l}%)`;
    const color2 = `hsl(${c2.h}, ${c2.s}%, ${c2.l}%)`;
    const colorMid = `hsl(${Math.round(hMid)}, ${Math.round(sMid)}%, ${Math.round(lMid)}%)`;

    return {
        color1,
        colorMid,
        color2,
        cssString: `linear-gradient(135deg, ${color1} 0%, ${colorMid} 50%, ${color2} 100%)`,
    };
}

interface CardData {
    id: number;
    gradient: string;
}

function SmartBoard(props: { gradient: string }) {
    return (
        <div class={styles.paperelement}>
            <div
                class={styles.paperback}
                style={{ background: props.gradient }}
            />
            <div
                class={styles.paperfront}
                style={{ background: props.gradient }}
            />
        </div>
    );
}

export function Landing() {
    const [cards, setCards] = createSignal<CardData[]>([]);
    let gridRef: HTMLDivElement | undefined;

    const applyDelays = () => {
        if (!gridRef) return;
        const elements = gridRef.children;
        const n = elements.length;
        if (n === 0) return;

        // Batch Read pass (no layout thrashing)
        const delays: number[] = new Array(n);
        for (let i = 0; i < n; i++) {
            const rect = elements[i].getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const dist = Math.hypot(Math.max(0, x), Math.max(0, y));
            delays[i] = Number((dist * 0.0006).toFixed(3));
        }

        // Batch Write pass
        for (let i = 0; i < n; i++) {
            (elements[i] as HTMLElement).style.animationDelay = `${delays[i]}s`;
        }
    };

    const updateCards = () => {
        const gridWidth = window.innerWidth * 2.6;
        const gridHeight = window.innerHeight * 3.0;
        const cellSize = 140;

        const cols = Math.ceil(gridWidth / cellSize);
        const rows = Math.ceil(gridHeight / cellSize);
        const count = cols * rows;

        const newCards: CardData[] = [];
        for (let i = 0; i < count; i++) {
            newCards.push({
                id: i,
                gradient: gradientMaker().cssString,
            });
        }
        setCards(newCards);

        requestAnimationFrame(applyDelays);
    };

    onMount(() => {
        updateCards();

        let resizeTimer: number | undefined;
        const handleResize = () => {
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(updateCards, 200);
        };

        window.addEventListener("resize", handleResize);
        onCleanup(() => {
            if (resizeTimer) clearTimeout(resizeTimer);
            window.removeEventListener("resize", handleResize);
        });
    });

    return (
        <div class={styles.landingcontainer}>
            <div class={styles.landingtext}>
                <PaperText
                    rounded
                    class={styles.landingtextbox}
                    size={14}
                    weight={600}
                >
                    Learn. Build. Create.
                </PaperText>
                <PaperText
                    class={styles.landingtextsubbox}
                    size={8}
                    weight={400}
                    rounded
                >
                    Welcome to the PaperDocs.
                </PaperText>
            </div>
            <div class={styles.gridoverlay}></div>
            <div class={styles.papergridwrapper}>
                <div ref={gridRef} class={styles.papergrid}>
                    <For each={cards()}>
                        {(card) => <SmartBoard gradient={card.gradient} />}
                    </For>
                </div>
            </div>
        </div>
    );
}
