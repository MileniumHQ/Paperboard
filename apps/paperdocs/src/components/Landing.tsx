import {
    PaperButton,
    PaperCard,
    PaperCode,
    PaperEffect,
    PaperFlex,
    PaperIcon,
    PaperLink,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperText,
} from "@mileniumhq/paperui";
import { For } from "solid-js";
import { metaSections, sectionKeys } from "../utils/routeUtils";
import { docsPath, withBase } from "../utils/base";
import styles from "./landing.module.css";

// The docs home: the four sections, then the two ways in that most readers
// want (make a panel, or hand the docs to an agent), then how panels reach
// the Panel Library.
export function Landing() {
    return (
        <main class={styles.landing}>
            <PaperFlex
                direction="column"
                align="center"
                gap="half"
                class={styles.hero}
            >
                <PaperText rounded preset="headline" as="h1" class={styles.flush}>
                    Paperboard Docs
                </PaperText>
                <PaperText
                    rounded
                    preset="subtitle"
                    color="text-subtle"
                    as="p"
                    class={styles.flush}
                >
                    Run Paperboard, build panels for it, and look up every API
                    and component.
                </PaperText>
            </PaperFlex>

            <div class={styles.column}>
                <PaperMediaCardGroup minCardWidth="220px">
                    <For each={sectionKeys}>
                        {(key) => {
                            const meta = metaSections[key];
                            return (
                                <div class={styles.enter}>
                                    <PaperMediaCard
                                        plainIcon
                                        icon={withBase(meta.image)}
                                        title={meta.name}
                                        description={meta.description}
                                        href={docsPath(key)}
                                    />
                                </div>
                            );
                        }}
                    </For>
                </PaperMediaCardGroup>

                <div class={styles.pair}>
                    <PaperCard padding="double" gap="full">
                        <PaperFlex direction="column" gap="half">
                            <PaperText preset="title" as="h2" class={styles.flush}>
                                Make your first panel
                            </PaperText>
                            <PaperText preset="body" color="text-subtle" as="p" class={styles.flush}>
                                One command writes a working panel with a
                                service, a Home widget, and tests. The tutorial
                                takes it from there to running inside
                                Paperboard.
                            </PaperText>
                        </PaperFlex>
                        <PaperCode block language="sh">
                            npm create @mileniumhq/panel
                        </PaperCode>
                        <PaperFlex direction="row" gap="half" wrap>
                            <PaperEffect variant="primary">
                                <PaperButton
                                    variant="primary"
                                    href={docsPath("developers", "first-panel")}
                                >
                                    Start the tutorial
                                </PaperButton>
                            </PaperEffect>
                            <PaperButton
                                variant="text"
                                href={docsPath("developers", "checklist")}
                            >
                                Panel checklist
                            </PaperButton>
                        </PaperFlex>
                    </PaperCard>

                    <PaperCard padding="double" gap="full">
                        <PaperFlex direction="column" gap="half">
                            <PaperText preset="title" as="h2" class={styles.flush}>
                                Docs for agents
                            </PaperText>
                            <PaperText preset="body" color="text-subtle" as="p" class={styles.flush}>
                                Every page is also plain Markdown. Give your
                                coding agent the index and it can build a panel
                                without reading Paperboard's source.
                            </PaperText>
                        </PaperFlex>
                        <PaperCode block language="text">
                            https://paperboard.dev/llms.txt
                        </PaperCode>
                        <PaperFlex direction="row" gap="half" wrap>
                            <PaperButton href="/llms.txt">Open llms.txt</PaperButton>
                            <PaperButton
                                variant="text"
                                href={docsPath("developers", "agents")}
                            >
                                Build with an agent
                            </PaperButton>
                        </PaperFlex>
                    </PaperCard>
                </div>

                <PaperCard padding="double">
                    <PaperFlex direction="row" gap="full" align="center">
                        <PaperIcon aria-hidden="true">verified</PaperIcon>
                        <PaperText preset="body" as="p" class={styles.flush}>
                            Panels run with full trust on your computers, so
                            the Panel Library only lists panels reviewed with
                            the Paperboard team.{" "}
                            <PaperLink href={docsPath("developers", "panel-library")}>
                                How to get a panel listed
                            </PaperLink>
                        </PaperText>
                    </PaperFlex>
                </PaperCard>
            </div>

            <PaperFlex direction="column" align="center" gap="full">
                <PaperText rounded preset="title" as="h2" class={styles.flush}>
                    Looking for a download?
                </PaperText>
                <PaperEffect variant="primary">
                    <PaperButton size="large" href="/downloads/">
                        Download Paperboard
                        <PaperIcon zeroHeight aria-hidden="true">
                            download
                        </PaperIcon>
                    </PaperButton>
                </PaperEffect>
            </PaperFlex>
        </main>
    );
}
