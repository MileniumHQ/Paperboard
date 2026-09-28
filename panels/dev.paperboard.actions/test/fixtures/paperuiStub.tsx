// Minimal PaperUI stand-ins for the ActionBlock browser fixture. The tests
// exercise the panel's own components (ActionBlock, VariableMenu, richText),
// so the shared library only has to be a DOM element with the handlers and
// class names the panel passes through.
import type { JSX } from "solid-js";

function Box(props: any): JSX.Element {
    const { children, tag, ...rest } = props;
    if (tag === "span") return <span {...rest}>{children}</span>;
    if (tag === "button") return <button {...rest}>{children}</button>;
    return <div {...rest}>{children}</div>;
}

export function PaperFlex(props: any): JSX.Element {
    return <Box tag="div" {...props} />;
}

export function PaperText(props: any): JSX.Element {
    return <Box tag="span" {...props} />;
}

export function PaperIcon(props: any): JSX.Element {
    return <Box tag="span" {...props} />;
}

export function PaperButton(props: any): JSX.Element {
    return <Box tag="button" {...props} />;
}

export function PaperSelectMenu(props: any): JSX.Element {
    return <Box tag="div" {...props} />;
}

export function PaperSelectMenuItem(props: any): JSX.Element {
    return <Box tag="div" {...props} />;
}
