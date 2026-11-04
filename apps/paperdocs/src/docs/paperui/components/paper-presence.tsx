import { createSignal } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperPresence,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function PaperPresenceDoc() {
    const [shown, setShown] = createSignal(true);

    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">PaperPresence</PaperText>
            <PaperText preset="body" as="p">
                PaperPresence mounts and unmounts one element with an enter and an exit animation.
                Use it instead of <PaperCode>Show</PaperCode> when something should fade or slide away rather than vanish, such as a notice, a drawer, or a popover.
                The element leaves the page only after its exit animation ends.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperText preset="body" as="p">
                Pass the condition as <PaperCode>when</PaperCode> and a single element as the child.
                Pick the entrance with <PaperCode>motion</PaperCode>.
            </PaperText>
            <PaperCard data-docs-demo padding="double" surface="front">
                <PaperFlex direction="column" gap="full" align="flex-start">
                    <PaperButton onClick={() => setShown(!shown())}>{shown() ? "Hide" : "Show"}</PaperButton>
                    <PaperPresence when={shown()} motion="pop">
                        <PaperCard padding="double" surface="frontest">
                            <PaperText preset="body" as="p">This card pops in and out.</PaperText>
                        </PaperCard>
                    </PaperPresence>
                </PaperFlex>
            </PaperCard>
            <PaperCode block language="tsx">
{`import { createSignal } from "solid-js";
import { PaperButton, PaperCard, PaperFlex, PaperPresence, PaperText } from "@mileniumhq/paperui";

export function Example() {
    const [shown, setShown] = createSignal(true);

    return (
        <PaperFlex direction="column" gap="full" align="flex-start">
            <PaperButton onClick={() => setShown(!shown())}>{shown() ? "Hide" : "Show"}</PaperButton>
            <PaperPresence when={shown()} motion="pop">
                <PaperCard padding="double" surface="frontest">
                    <PaperText preset="body" as="p">This card pops in and out.</PaperText>
                </PaperCard>
            </PaperPresence>
        </PaperFlex>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="props">Props</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Prop</th>
                        <th>Type</th>
                        <th>Default</th>
                        <th>Effect</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>when</PaperCode></td>
                        <td><PaperCode>unknown</PaperCode></td>
                        <td>No default (required)</td>
                        <td>The child is in the page while this is truthy, and stays until its exit animation ends once it turns falsy.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>children</PaperCode></td>
                        <td><PaperCode>JSX.Element</PaperCode></td>
                        <td>No default (required)</td>
                        <td>One element. The animation classes are added to it, so it must be a real element, not text or a fragment of several.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>motion</PaperCode></td>
                        <td><PaperCode>PaperMotion</PaperCode></td>
                        <td><PaperCode>"fade"</PaperCode></td>
                        <td>How the element arrives. It leaves the same way in reverse. See Motions. Ignored when <PaperCode>enterClass</PaperCode> or <PaperCode>exitClass</PaperCode> is given.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>appear</PaperCode></td>
                        <td><PaperCode>boolean</PaperCode></td>
                        <td>No default (off)</td>
                        <td>Plays the entrance on first mount too. Without it, an element that is already shown when the component mounts appears with no animation.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>enterClass</PaperCode>, <PaperCode>exitClass</PaperCode></td>
                        <td><PaperCode>string</PaperCode></td>
                        <td>No default (the preset's classes)</td>
                        <td>Your own class names, added to the element during the entrance and the exit. They replace the preset's classes, so they must supply the animation. Separate several classes with spaces.</td>
                    </tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                <PaperCode>PaperMotion</PaperCode> is exported from <PaperCode>@mileniumhq/paperui</PaperCode>:
            </PaperText>
            <PaperCode block language="ts">
{`type PaperMotion = "fade" | "pop" | "slide-up" | "slide-down" | "slide-start" | "slide-end";`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperText preset="subheader" as="h3" id="motions">Motions</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Motion</th>
                        <th>The element arrives by</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><PaperCode>"fade"</PaperCode></td>
                        <td>Fading in from transparent.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"pop"</PaperCode></td>
                        <td>Fading in while rising a half gap and growing from 96% of its size.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"slide-up"</PaperCode></td>
                        <td>Sliding up from below its own height.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"slide-down"</PaperCode></td>
                        <td>Sliding down from above its own height.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"slide-start"</PaperCode></td>
                        <td>Sliding in from the start edge: the left in left-to-right text, the right in right-to-left.</td>
                    </tr>
                    <tr>
                        <td><PaperCode>"slide-end"</PaperCode></td>
                        <td>Sliding in from the end edge, the mirror of <PaperCode>"slide-start"</PaperCode>.</td>
                    </tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h3" id="timing">Timing</PaperText>
            <PaperTextList>
                <li>The entrance takes the medium transition time, the exit the short one. Set the CSS custom property <PaperCode>--paper-presence-duration</PaperCode> on or above the element to use one duration for both.</li>
                <li>The exit plays the entrance keyframes in reverse, so arriving and leaving always match.</li>
                <li>The element is removed when its own animation ends, backed by a timer a short grace after the declared duration. A child with no animation is removed at once.</li>
                <li>Toggling <PaperCode>when</PaperCode> mid-animation cancels the running animation and starts the other.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h3" id="reduced-motion">Reduced motion</PaperText>
            <PaperText preset="body" as="p">
                Under the operating system's reduced-motion setting, or inside an ancestor with <PaperCode>data-paperui-motion="reduced"</PaperCode>, no animation plays: the element appears and leaves at once.
                The exported function <PaperCode>prefersReducedMotion(el?: Element): boolean</PaperCode> runs the same check, for your own animations.
            </PaperText>

            <PaperText preset="subheader" as="h3" id="custom-classes">Custom animation classes</PaperText>
            <PaperText preset="body" as="p">
                Give <PaperCode>enterClass</PaperCode> and <PaperCode>exitClass</PaperCode> when a preset does not fit.
                PaperUI's own modal uses this to animate its backdrop and its box together.
                The classes need a CSS animation, which you write in a stylesheet that is part of your panel.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="examples">Examples</PaperText>
            <PaperText preset="subheader" as="h3" id="notice">A notice that slides away</PaperText>
            <PaperText preset="body" as="p">
                Drive <PaperCode>when</PaperCode> from a boolean and keep the text outside it, so the notice keeps its words while it leaves.
            </PaperText>
            <PaperCode block language="tsx">
{`import { PaperPresence, PaperQuote } from "@mileniumhq/paperui";

export function Notice(props: { open: boolean; message: string; onDismiss: () => void }) {
    return (
        <PaperPresence when={props.open} motion="slide-down">
            <PaperQuote variant="danger" onDismiss={props.onDismiss}>
                {props.message}
            </PaperQuote>
        </PaperPresence>
    );
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h3" id="neighbors">Choosing a neighbor</PaperText>
            <PaperTextList>
                <li>For content that can appear and disappear with no animation, use Solid's <PaperCode>Show</PaperCode>.</li>
                <li>A dialog already animates itself. Drive <PaperLink href="/docs/paperui/papermodal/">PaperModal</PaperLink> with <PaperCode>open</PaperCode> and do not wrap it.</li>
            </PaperTextList>
        </PaperFlex>
    );
}
