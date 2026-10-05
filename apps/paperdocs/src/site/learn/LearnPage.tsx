import { For, Show } from "solid-js";
import { MarketingChrome, DownloadCta } from "../landing/Landing";
import { MarketingHeading } from "../landing/MarketingHeading";
import { Screenshot } from "../landing/Screenshot";
import { withBase } from "../../utils/base";
import { LEARN_PANELS, type LearnPanel } from "./panels";

// Each screenshot links to its image file, so it still opens without
// JavaScript; public/js/learn-lightbox.js upgrades the link to open the image
// full screen in the page's one <dialog>.
function ZoomableScreenshot(props: { src: string; alt: string; eager?: boolean }) {
    return (
        <a
            class="learn-shot-link"
            href={withBase(props.src)}
            aria-label={`View full size: ${props.alt}`}
            data-lightbox
        >
            <Screenshot src={props.src} alt={props.alt} eager={props.eager} />
        </a>
    );
}

export function LearnPage(props: { panel: LearnPanel }) {
    return (
        <div class="learn-page" style={{ "--paper-site-accent": props.panel.accent }}>
            <MarketingChrome>
                <main class="learn-main">
                    <section class="learn-hero">
                        <div class="learn-identity">
                            <img src={props.panel.icon} width="44" height="44" alt="" />
                            <span>{props.panel.name}</span>
                        </div>
                        <MarketingHeading level={1} text={props.panel.headline} size={76} />
                        <p class="learn-intro">{props.panel.description}</p>
                        <DownloadCta />
                        <figure class="learn-hero-shot screenshot-card">
                            <ZoomableScreenshot src={props.panel.image} alt={props.panel.alt} eager />
                        </figure>
                    </section>
                    <div class="learn-features">
                        <For each={props.panel.features}>
                            {(feature, index) => (
                                <section
                                    class={`learn-feature ${index() % 2 ? "learn-feature--reverse" : ""}`}
                                    data-reveal
                                >
                                    <figure class="learn-feature-shot screenshot-card">
                                        <ZoomableScreenshot src={feature.image} alt={feature.alt} />
                                    </figure>
                                    <div class="learn-feature-copy">
                                        <MarketingHeading
                                            level={2}
                                            text={feature.title}
                                            size={42}
                                        />
                                        <p>{feature.description}</p>
                                    </div>
                                </section>
                            )}
                        </For>
                    </div>
                    <section class="learn-outro" data-reveal>
                        <MarketingHeading level={2} text={`Get ${props.panel.name}`} size={54} />
                        <DownloadCta />
                        <Show when={props.panel.note}>
                            <p class="learn-footnote">{props.panel.note}</p>
                        </Show>
                        <nav class="learn-related" aria-label="Explore more panels">
                            <For
                                each={LEARN_PANELS.filter(
                                    (panel) => panel.slug !== props.panel.slug,
                                )}
                            >
                                {(panel) => (
                                    <a href={`/${panel.slug}/`}>
                                        <img src={panel.icon} width="28" height="28" alt="" />
                                        {panel.name}
                                        <span aria-hidden="true">↗</span>
                                    </a>
                                )}
                            </For>
                        </nav>
                    </section>
                </main>
                <dialog class="learn-lightbox" aria-label="Screenshot">
                    <button class="learn-lightbox-close" type="button" aria-label="Close">
                        <span class="icon icon-close" aria-hidden="true" />
                    </button>
                    <img class="learn-lightbox-image" alt="" />
                </dialog>
            </MarketingChrome>
        </div>
    );
}
