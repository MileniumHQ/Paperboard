import { type Component, For, Show } from "solid-js";
import { flagById, stripeColor } from "./flags";
import type { BuiltinWidgetProps } from "./types";
import styles from "./Builtins.module.css";

// A flag, filling its tile with stripes.
const Flag: Component<BuiltinWidgetProps> = (props) => {
    const flag = () => flagById(props.options.flag);
    return (
        <Show when={flag()}>
            {(shown) => (
                <div class={styles.flag} role="img" aria-label={`${shown().name} flag`}>
                    <For each={shown().stripes}>{(stripe) => <div style={{ background: stripeColor(stripe) }} />}</For>
                </div>
            )}
        </Show>
    );
};

export default Flag;
