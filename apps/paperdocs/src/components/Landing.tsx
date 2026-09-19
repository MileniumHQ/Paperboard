import {
    PaperButton,
    PaperEffect,
    PaperIcon,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperSeparator,
    PaperText,
} from "@paperboard-dev/paperui";
import { For, Show } from "solid-js";
import { metaSections, sectionKeys } from "../utils/routeUtils";
import { withBase } from "../utils/base";
import styles from "./landing.module.css";

// Entrance stagger is capped so a growing section list never stretches the
// page intro.
const STAGGER_STEP_MS = 60;
const STAGGER_MAX_MS = 300;

function sectionCard(key: string, index: number) {
    const meta = metaSections[key];
    return (
        <div
            class={styles.cardEnter}
            style={{
                "animation-delay": `${Math.min(index * STAGGER_STEP_MS, STAGGER_MAX_MS)}ms`,
            }}
        >
            <PaperMediaCard
                plainIcon
                icon={meta.image ? withBase(meta.image) : meta.icon || "description"}
                title={meta.name}
                description={meta.description}
                href={withBase(`/${key}`)}
            />
        </div>
    );
}

export function Landing() {
    const primaryKeys = () =>
        sectionKeys.filter((key) => metaSections[key].group !== "dev");
    const devKeys = () =>
        sectionKeys.filter((key) => metaSections[key].group === "dev");

    return (
        <div class={styles.landing}>
            <div class={styles.hero}>
                <PaperText
                    rounded
                    preset="headline"
                    as="h1"
                    class={styles.heroTitle}
                >
                    Learn. Build. Create.
                </PaperText>
                <PaperText
                    rounded
                    preset="subtitle"
                    color="text-subtle"
                    as="p"
                    class={styles.heroSubtitle}
                >
                    Welcome to the PaperDocs.
                </PaperText>
            </div>
            <div class={styles.cards}>
                <For each={primaryKeys()}>
                    {(key) => sectionCard(key, sectionKeys.indexOf(key))}
                </For>
                <Show when={devKeys().length > 0}>
                    <PaperSeparator />
                    <PaperMediaCardGroup minCardWidth="200px">
                        <For each={devKeys()}>
                            {(key) =>
                                sectionCard(key, sectionKeys.indexOf(key))
                            }
                        </For>
                    </PaperMediaCardGroup>
                </Show>
            </div>
            <div class={styles.download}>
                <PaperText
                    rounded
                    preset="title"
                    as="h2"
                    class={styles.downloadPrompt}
                >
                    Looking for a download?
                </PaperText>
                <PaperEffect variant="primary">
                    <PaperButton
                        size="large"
                        href="https://paperboard.dev"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        paperboard.dev
                        <PaperIcon zeroHeight aria-hidden="true">
                            north_east
                        </PaperIcon>
                    </PaperButton>
                </PaperEffect>
            </div>
        </div>
    );
}
