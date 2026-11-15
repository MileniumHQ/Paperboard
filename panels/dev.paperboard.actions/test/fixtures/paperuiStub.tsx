// Minimal PaperUI stand-ins for the ActionBlock browser fixture. The tests
// exercise the panel's own components (ActionBlock, VariableMenu, richText),
// so the shared library only has to be a DOM element with the handlers and
// class names the panel passes through.
import { splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";

function Box(props: any): JSX.Element {
    const [own, rest] = splitProps(props, ["children", "tag"]);
    return (
        <Dynamic component={own.tag ?? "div"} {...rest}>
            {own.children}
        </Dynamic>
    );
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

export function PaperSwatch(props: any): JSX.Element {
    const [own, rest] = splitProps(props, ["color", "size"]);
    return <Box tag="span" {...rest} style={{ background: own.color }} />;
}

export function PaperSelectMenu(props: any): JSX.Element {
    return <Box tag="div" {...props} />;
}

export function PaperSelectMenuItem(props: any): JSX.Element {
    return <Box tag="div" {...props} />;
}
