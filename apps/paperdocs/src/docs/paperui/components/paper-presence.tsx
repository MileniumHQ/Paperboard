import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperPresence,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";
import { createSignal } from "solid-js";

function PresenceDemo() {
    const [shown, setShown] = createSignal(true);
    return (
        <PaperCard padding="double" surface="front">
            <PaperFlex direction="column" gap="full">
                <PaperButton onClick={() => setShown(!shown())}>Toggle</PaperButton>
                <PaperPresence when={shown()} motion="slide-up">
                    <PaperCard padding="double" surface="frontest">Details</PaperCard>
                </PaperPresence>
            </PaperFlex>
        </PaperCard>
    );
}

export default function PaperPresenceDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header">PaperPresence</PaperText>
            <PaperText preset="body">
                PaperPresence mounts and unmounts one element with an enter and an exit animation.
                Reach for PaperPresence when a drawer, banner, or panel should animate out before it leaves the page.
                The element stays mounted until its exit animation ends.
            </PaperText>
            <PaperText preset="subheader" id="overview">Overview</PaperText>
            <PaperText preset="body">
                Wrap a single element and pass when. Pick how it arrives with motion. It leaves the same way, in reverse.
            </PaperText>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperButton, PaperCard, PaperPresence } from "@mileniumhq/paperui";

export function Example() {
    const [shown, setShown] = createSignal(true);
    return (
        <>
            <PaperButton onClick={() => setShown(!shown())}>Toggle</PaperButton>
            <PaperPresence when={shown()} motion="slide-up">
                <PaperCard padding="double" surface="front">Details</PaperCard>
            </PaperPresence>
        </>
    );
}`}
            </PaperCode>
            <PresenceDemo />
            <PaperText preset="subheader" id="props-and-variants">Props and variants</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>when</PaperCode></td>
                        <td><PaperCode>unknown</PaperCode></td>
                        <td><PaperCode>required</PaperCode></td>
                        <td>The element is shown while this is truthy.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>motion</PaperCode></td>
                        <td><PaperCode>"fade" | "pop" | "slide-up" | "slide-down" | "slide-start" | "slide-end"</PaperCode></td>
                        <td><PaperCode>"fade"</PaperCode></td>
                        <td>A preset animation. Ignored where enterClass or exitClass is given.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>enterClass</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>no default</td>
                        <td>A class with the component's own enter keyframes, used instead of the preset.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>exitClass</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>no default</td>
                        <td>A class with the component's own exit keyframes, used instead of the preset.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>appear</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td><PaperCode>false</PaperCode></td>
                        <td>Animates on first mount too, not only when when changes.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td><PaperCode>required</PaperCode></td>
                        <td>A single element.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body">
                The slide-start and slide-end presets follow the text direction: start is the left edge in left-to-right layouts.
                Enter animations last --paper-mid-transition and exit animations last --paper-short-transition. Set --paper-presence-duration on the element to give both another length.
            </PaperText>
            <PaperText preset="subheader" id="behavior">Behavior</PaperText>
            <PaperText preset="body">
                The element leaves the DOM once its own exit animation has ended. A timer backs up the animationend event, so an animation that never reports its end cannot leave the element mounted.
                Under reduced motion the element appears and leaves at once. Reduced motion means the operating system preference, or an ancestor with data-paperui-motion set to reduced.
                Animations of child elements do not count: only the wrapped element's own animation decides when it leaves.
            </PaperText>
            <PaperText preset="subheader" id="recipes">Recipes</PaperText>
            <PaperText preset="body">
                prefersReducedMotion reports the same reduced-motion decision, for code that animates by hand.
            </PaperText>
            <PaperCode block language="tsx">
{`import { prefersReducedMotion } from "@mileniumhq/paperui";

if (!prefersReducedMotion(element)) {
    element.animate([{ opacity: 0 }, { opacity: 1 }], 200);
}`}
            </PaperCode>
        </PaperFlex>
    );
}
