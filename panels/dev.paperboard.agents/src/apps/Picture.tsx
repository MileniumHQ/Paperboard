// An app's picture, small: the app as it looked when it was last shown. One
// never taken shows the app's glyph, and one that can't be read says why.

import { Match, Switch, createResource } from "solid-js";
import { PaperIcon } from "@mileniumhq/paperui";
import { errorText } from "../lib/failure";
import type { Launcher } from "./launcher";
import styles from "./Picture.module.css";

export default function Picture(props: { apps: Launcher; name: string; title: string; taken: boolean }) {
    // read again whenever the apps change, so a newer picture replaces this one
    const [picture] = createResource(() => props.taken && `${props.apps.revision()}\0${props.name}`, () => props.apps.picture(props.name));
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
