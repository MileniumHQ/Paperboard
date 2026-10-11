import { type Component, createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type { BuiltinWidgetProps } from "./types";
import styles from "./Builtins.module.css";

// The time. 2×1 and 4×1 are digital; 2×2 is a clock face. It ticks only
// while it is on screen.
const Clock: Component<BuiltinWidgetProps> = (props) => {
    const [now, setNow] = createSignal(new Date());
    createEffect(() => {
        if (!props.visible) return;
        setNow(new Date());
        // land each tick on the second, so the face and the digits agree
        let timer: ReturnType<typeof setTimeout>;
        const tick = () => {
            setNow(new Date());
            timer = setTimeout(tick, 1000 - (Date.now() % 1000));
        };
        timer = setTimeout(tick, 1000 - (Date.now() % 1000));
        onCleanup(() => clearTimeout(timer));
    });

    const time = () => now().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const weekday = () => now().toLocaleDateString([], { weekday: "long" });
    const day = () => now().toLocaleDateString([], { month: "long", day: "numeric" });
    const shortDate = () => now().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

    return (
        <Show
            when={props.size.h > 1}
            fallback={
                <div class={styles.clockDigital} classList={{ [styles.clockWide]: props.size.w > 2 }}>
                    <time class={styles.clockTime}>{time()}</time>
                    <Show when={props.size.w > 2} fallback={<span class={styles.clockDate}>{shortDate()}</span>}>
                        <span class={styles.clockDay}>
                            <span class={styles.clockWeekday}>{weekday()}</span>
                            <span class={styles.clockDate}>{day()}</span>
                        </span>
                    </Show>
                </div>
            }
        >
            <ClockFace now={now()} label={`${time()}, ${weekday()}, ${day()}`} />
        </Show>
    );
};

const TICKS = Array.from({ length: 60 }, (_, i) => i);

const ClockFace: Component<{ now: Date; label: string }> = (props) => {
    const seconds = () => props.now.getSeconds();
    const minutes = () => props.now.getMinutes() + seconds() / 60;
    const hours = () => (props.now.getHours() % 12) + minutes() / 60;
    const day = () => props.now.toLocaleDateString([], { weekday: "short" }).toUpperCase();
    return (
        <div class={styles.clockFace}>
            <svg viewBox="0 0 100 100" role="img" aria-label={props.label}>
                <circle class={styles.faceDisc} cx="50" cy="50" r="48" />
                <For each={TICKS}>
                    {(i) => (
                        <line
                            class={i % 5 === 0 ? styles.faceHourTick : styles.faceTick}
                            x1="50"
                            y1={i % 5 === 0 ? 6 : 6.5}
                            x2="50"
                            y2={i % 5 === 0 ? 13 : 9.5}
                            transform={`rotate(${i * 6} 50 50)`}
                        />
                    )}
                </For>
                <text class={styles.faceDay} x="50" y="70" text-anchor="middle">
                    {day()} {props.now.getDate()}
                </text>
                <line class={styles.handHour} x1="50" y1="50" x2="50" y2="27" transform={`rotate(${hours() * 30} 50 50)`} />
                <line class={styles.handMinute} x1="50" y1="50" x2="50" y2="14" transform={`rotate(${minutes() * 6} 50 50)`} />
                <line class={styles.handSecond} x1="50" y1="58" x2="50" y2="11" transform={`rotate(${seconds() * 6} 50 50)`} />
                <circle class={styles.handPin} cx="50" cy="50" r="2" />
            </svg>
        </div>
    );
};

export default Clock;
