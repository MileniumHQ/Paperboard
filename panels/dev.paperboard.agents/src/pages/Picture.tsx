// A page's picture, small: the page as it looked when it was last shown. One
// never taken shows the page's glyph, and one that can't be read says why.

import { Match, Switch, createResource } from "solid-js";
import { PaperIcon } from "@mileniumhq/paperui";
import { errorText } from "../lib/failure";
import type { Launcher } from "./launcher";
import styles from "./Picture.module.css";

export default function Picture(props: { pages: Launcher; name: string; title: string; taken: boolean }) {
    // read again whenever the pages change, so a newer picture replaces this one
    const [picture] = createResource(() => props.taken && `${props.pages.revision()}\0${props.name}`, () => props.pages.picture(props.name));
    return (
        <Switch fallback={<PaperIcon class={styles.glyph}>web</PaperIcon>}>
            <Match when={picture.error}>
                <PaperIcon class={styles.glyph} role="img" aria-label={`${props.title}'s picture wasn't loaded: ${errorText(picture.error)}`} title={`Picture not loaded: ${errorText(picture.error)}`}>
                    broken_image
                </PaperIcon>
            </Match>
            <Match when={picture()}>
                <img class={styles.picture} src={picture()} alt={props.title} />
            </Match>
        </Switch>
    );
}
