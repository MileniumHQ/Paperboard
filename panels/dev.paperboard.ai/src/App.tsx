import { For, createSignal, onCleanup } from "solid-js";
import { PaperButton, PaperToggle } from "@mileniumhq/paperui";
import { Face } from "./face/Face";
import { SPOTS, createFace, type Spot } from "./face/controller";
import { EXPRESSION_NAMES, type Expression } from "./face/expressions";
import { orientationToward } from "./face/geometry";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import styles from "./App.module.css";

// Scratch playground for the AI's face: the identity comes first, the
// onboarding is built around it.

const HELLO: { text: string; expression: Expression; spot: Spot }[] = [
    { text: "Hi! I'm your new AI.", expression: "happy", spot: "home" },
    { text: "I work best with a computer of my own, a little Debian machine that lives right here.", expression: "thinking", spot: "left" },
    { text: "Want me to set one up?", expression: "happy", spot: "home" },
];

export default function App() {
    const face = createFace();
    const small = createFace();
    onCleanup(() => {
        face.dispose();
        small.dispose();
    });
    const [follow, setFollow] = createSignal(false);
    const [line, setLine] = createSignal("");
    const [saying, setSaying] = createSignal(false);
    let stage!: HTMLDivElement;

    // pointer → sphere coordinates of the big face
    const sphereAt = (e: PointerEvent) => {
        const svg = stage.querySelector("svg")!.getBoundingClientRect();
        const r = (svg.width / 200) * 80;
        const cx = svg.left + svg.width / 2;
        const cy = svg.top + svg.height / 2;
        return { x: (e.clientX - cx) / r, y: (e.clientY - cy) / r };
    };

    let dragging = false;
    const onDown = (e: PointerEvent) => {
        dragging = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        onDrag(e);
    };
    const onDrag = (e: PointerEvent) => {
        if (!dragging) return;
        const { x, y } = sphereAt(e);
        face.look(orientationToward(x, y));
    };
    const onUp = () => (dragging = false);

    const onFollow = (e: PointerEvent) => {
        if (!follow() || dragging) return;
        const { x, y } = sphereAt(e);
        // far points saturate toward the rim instead of flipping the face around
        const d = Math.hypot(x, y);
        const k = 0.85 / (d + 1.2);
        face.look({ ...orientationToward(x * k, y * k), roll: 0 });
    };
    window.addEventListener("pointermove", onFollow);
    onCleanup(() => window.removeEventListener("pointermove", onFollow));

    let typing: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => clearTimeout(typing));
    const sayHello = () => {
        clearTimeout(typing);
        setSaying(true);
        let li = 0;
        let ci = 0;
        const step = () => {
            const cur = HELLO[li]!;
            if (ci === 0) {
                face.express(cur.expression);
                face.look(cur.spot);
                face.talk(true);
            }
            ci++;
            setLine(cur.text.slice(0, ci));
            if (ci < cur.text.length) {
                typing = setTimeout(step, /[,.!?]/.test(cur.text[ci - 1]!) ? 220 : 34);
                return;
            }
            face.talk(false);
            li++;
            ci = 0;
            if (li < HELLO.length) typing = setTimeout(step, 1100);
            else setSaying(false);
        };
        step();
    };

    return (
        <div class={styles.page}>
            <section class={styles.stage} ref={stage}>
                <div
                    class={styles.grab}
                    onPointerDown={onDown}
                    onPointerMove={onDrag}
                    onPointerUp={onUp}
                    onPointerCancel={onUp}
                    onDblClick={() => face.look("home")}
                >
                    <Face face={face} size={420} />
                </div>
                <p class={styles.bubble} aria-live="polite">
                    {line() || "Drag the sphere to move the face. Double-click to send it home."}
                </p>
            </section>

            <aside class={styles.controls}>
                <h2>Expression</h2>
                <div class={styles.row}>
                    <For each={EXPRESSION_NAMES}>
                        {(name) => (
                            <PaperButton
                                size="small"
                                variant={face.expression() === name ? "primary" : "text"}
                                onClick={() => {
                                    face.express(name);
                                    small.express(name);
                                }}
                            >
                                {name}
                            </PaperButton>
                        )}
                    </For>
                </div>

                <h2>Look</h2>
                <div class={styles.row}>
                    <For each={Object.keys(SPOTS) as Spot[]}>
                        {(spot) => (
                            <PaperButton size="small" variant="text" onClick={() => face.look(spot)}>
                                {spot}
                            </PaperButton>
                        )}
                    </For>
                </div>

                <h2>Behaviour</h2>
                <label class={styles.toggle}>
                    <PaperToggle checked={face.talking()} onChange={(on) => face.talk(on)} /> Talking
                </label>
                <label class={styles.toggle}>
                    <PaperToggle checked={face.shaking()} onChange={(on) => face.shake(on)} /> Shaking
                </label>
                <label class={styles.toggle}>
                    <PaperToggle checked={face.pondering()} onChange={(on) => face.ponder(on)} /> Pondering
                </label>
                <label class={styles.toggle}>
                    <PaperToggle checked={follow()} onChange={setFollow} /> Follow the cursor
                </label>
                <div class={styles.row}>
                    <PaperButton size="small" onClick={() => face.blink()}>
                        Blink
                    </PaperButton>
                    <PaperButton size="small" onClick={() => face.bounce()}>
                        Bounce
                    </PaperButton>
                    <PaperButton size="small" variant="primary" disabled={saying()} onClick={sayHello}>
                        Say hello
                    </PaperButton>
                </div>

                <h2>Small sizes</h2>
                <div class={styles.sizes}>
                    <Face face={small} size={96} />
                    <Face face={small} size={48} />
                    <Face face={small} size={24} />
                </div>
            </aside>
        </div>
    );
}
