import { withBase } from "../../utils/base";

/** Screenshots are captured at 1600 × 1200; reserve their 4:3 space before loading. */
export function Screenshot(props: { src: string; alt: string; class?: string; eager?: boolean }) {
    return (
        <img
            src={withBase(props.src)}
            alt={props.alt}
            class={["marketing-screenshot", props.class].filter(Boolean).join(" ")}
            width={1600}
            height={1200}
            loading={props.eager ? "eager" : "lazy"}
            decoding="async"
        />
    );
}
