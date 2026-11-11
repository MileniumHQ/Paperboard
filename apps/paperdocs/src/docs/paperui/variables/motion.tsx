import {
    PaperCode,
    PaperFlex,
    PaperLink,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function MotionDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">Motion and effects</PaperText>
            <PaperText preset="body" as="p">
                PaperUI animates with five durations and five easing curves, and dims, blurs, and scales with named steps.
                Components apply these for you, and a panel built from components inherits them, including the switch to no motion.
                Read a token yourself only for an element PaperUI has no component for.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="durations">Durations</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>--paper-tiny-transition</PaperCode></td><td>0.15s</td></tr>
                    <tr><td><PaperCode>--paper-short-transition</PaperCode></td><td>0.2s</td></tr>
                    <tr><td><PaperCode>--paper-mid-transition</PaperCode></td><td>0.3s</td></tr>
                    <tr><td><PaperCode>--paper-medium-transition</PaperCode></td><td>0.4s</td></tr>
                    <tr><td><PaperCode>--paper-long-transition</PaperCode></td><td>0.6s</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="easing">Easing</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Curve</th>
                        <th>Shape</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>--paper-ease-standard</PaperCode></td><td><PaperCode>cubic-bezier(0.2, 0, 0, 1)</PaperCode></td><td>A quick start and a long settle. Lists, select menus, and widgets use it.</td></tr>
                    <tr><td><PaperCode>--paper-ease-emphasized</PaperCode></td><td><PaperCode>cubic-bezier(0.16, 1, 0.3, 1)</PaperCode></td><td>A stronger settle for things that arrive: modals, slide pages, wizard steps, and PaperPresence.</td></tr>
                    <tr><td><PaperCode>--paper-ease-symmetric</PaperCode></td><td><PaperCode>cubic-bezier(0.2, 0, 0.2, 1)</PaperCode></td><td>Even acceleration and deceleration. Loaders, progress bars, and charts use it.</td></tr>
                    <tr><td><PaperCode>--paper-ease-slide</PaperCode></td><td><PaperCode>cubic-bezier(0.7, 0, 0.2, 1)</PaperCode></td><td>A slow start and a firm landing. The toggle uses it.</td></tr>
                    <tr><td><PaperCode>--paper-ease-indeterminate</PaperCode></td><td><PaperCode>cubic-bezier(0.4, 0, 0.6, 1)</PaperCode></td><td>The curve of an indeterminate progress bar.</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="reduced-motion">Reduced motion</PaperText>
            <PaperText preset="body" as="p">
                Motion switches off in two ways, and both set every duration above to <PaperCode>0s</PaperCode>. Blur is a switch of its own, below.
            </PaperText>
            <PaperTextList>
                <li>The operating system's <PaperCode>prefers-reduced-motion: reduce</PaperCode> setting applies on <PaperCode>:root</PaperCode>.</li>
                <li>An ancestor with <PaperCode>data-paperui-motion="reduced"</PaperCode> applies to its subtree, and also cuts every transition and animation in it to 0.01 milliseconds and runs animations once. Paperboard writes this attribute on a panel's <PaperCode>html</PaperCode> element: <PaperCode>"reduced"</PaperCode> when the user turns on Disable animations in Paperboard's settings, <PaperCode>"auto"</PaperCode> otherwise.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                Under reduced motion <PaperLink href="/docs/paperui/papereffect/">PaperEffect</PaperLink> stops moving on hover and press, and <PaperLink href="/docs/paperui/paperpresence/">PaperPresence</PaperLink> removes an element at once instead of waiting for its exit animation.
            </PaperText>
            <PaperText preset="body" as="p">
                Animate your own elements with the duration variables so they obey the same switch.
                Code that animates in script asks <PaperCode>prefersReducedMotion(el?: Element): boolean</PaperCode>, exported from PaperUI and documented on <PaperLink href="/docs/paperui/paperpresence/">PaperPresence</PaperLink>.
            </PaperText>
            <PaperCode block language="tsx">
{`import { prefersReducedMotion } from "@mileniumhq/paperui";

export function scrollToEnd(el: HTMLElement) {
    el.scrollTo({
        top: el.scrollHeight,
        behavior: prefersReducedMotion(el) ? "auto" : "smooth",
    });
}`}
            </PaperCode>

            <PaperText preset="subheader" as="h2" id="blur">Blur</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Value</th>
                        <th>Use</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>--paper-blur-light</PaperCode></td><td><PaperCode>blur(5px)</PaperCode></td><td>The backdrop behind a modal.</td></tr>
                    <tr><td><PaperCode>--paper-blur-medium</PaperCode></td><td><PaperCode>blur(10px)</PaperCode></td><td>A stronger blur.</td></tr>
                    <tr><td><PaperCode>--paper-blur-heavy</PaperCode></td><td><PaperCode>blur(15px)</PaperCode></td><td>The strongest blur.</td></tr>
                </tbody>
            </PaperTable>
            <PaperText preset="body" as="p">
                Blur switches off in two ways, and both set the blur variables to <PaperCode>none</PaperCode>.
                Without a graphics card, Chromium blurs on the processor, and anything that moves over a blurred layer, like a modal's list as it scrolls, redraws the blur on every frame.
            </PaperText>
            <PaperTextList>
                <li>The operating system's <PaperCode>prefers-reduced-transparency: reduce</PaperCode> setting applies on <PaperCode>:root</PaperCode>.</li>
                <li>An ancestor with <PaperCode>data-paperui-blur="off"</PaperCode> applies to its subtree, and also removes every backdrop filter in it, even one written without the variables. Paperboard writes this attribute on a panel's <PaperCode>html</PaperCode> element: <PaperCode>"off"</PaperCode> when the user turns on Disable blur in Paperboard's settings, <PaperCode>"auto"</PaperCode> otherwise.</li>
            </PaperTextList>
            <PaperText preset="body" as="p">
                Blur your own elements with these variables so they obey the same switch, and give them a background that stays legible without it.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="opacity">Opacity</PaperText>
            <PaperText preset="body" as="p">
                States that dim an element, rather than recolor it, use these steps.
                Disabled controls inside a provider take <PaperCode>--paper-opacity-disabled</PaperCode> and a grayscale filter, and ignore pointer input.
            </PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>--paper-opacity-faint</PaperCode></td><td>0.35</td></tr>
                    <tr><td><PaperCode>--paper-opacity-dim</PaperCode></td><td>0.5</td></tr>
                    <tr><td><PaperCode>--paper-opacity-disabled</PaperCode></td><td>0.6</td></tr>
                    <tr><td><PaperCode>--paper-opacity-muted</PaperCode></td><td>0.65</td></tr>
                    <tr><td><PaperCode>--paper-opacity-soft</PaperCode></td><td>0.85</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="scale">Scale</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Variable</th>
                        <th>Value</th>
                        <th>Use</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>--paper-scale-press</PaperCode></td><td>0.98</td><td>An element being pressed.</td></tr>
                    <tr><td><PaperCode>--paper-scale-hover</PaperCode></td><td>1.03</td><td>An element under the pointer.</td></tr>
                    <tr><td><PaperCode>--paper-scale-emphasis</PaperCode></td><td>1.2</td><td>A momentary emphasis.</td></tr>
                </tbody>
            </PaperTable>

            <PaperText preset="subheader" as="h2" id="paper-effect">The paper effect</PaperText>
            <PaperText preset="body" as="p">
                The tactile press, a colored shadow offset behind a control that travels as it is pressed, is a component, not a token.
                Wrap a control in <PaperLink href="/docs/paperui/papereffect/">PaperEffect</PaperLink> and set its <PaperCode>variant</PaperCode> to a <PaperLink href="/docs/paperui/colors/">color role</PaperLink>.
                The shadow's offset is one quarter of a gap (<PaperCode>--paper-uigap-onefourth</PaperCode>).
                On a touch screen a press that ends on the control also plays a short haptic, described in <PaperLink href="/docs/paperui/utilities/#haptics">Utilities</PaperLink>.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="other">Appearing and leaving</PaperText>
            <PaperText preset="body" as="p">
                Mount and unmount an element with an animation through <PaperLink href="/docs/paperui/paperpresence/">PaperPresence</PaperLink>, which offers the presets <PaperCode>fade</PaperCode>, <PaperCode>pop</PaperCode>, <PaperCode>slide-up</PaperCode>, <PaperCode>slide-down</PaperCode>, <PaperCode>slide-start</PaperCode>, and <PaperCode>slide-end</PaperCode>.
                Write no keyframes of your own.
            </PaperText>
        </PaperFlex>
    );
}
