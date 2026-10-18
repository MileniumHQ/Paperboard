import { For, Show } from "solid-js";
import { MarketingChrome, DownloadCta } from "../landing/Landing";
import { MarketingHeading } from "../landing/MarketingHeading";
import { Icon, Screenshot } from "../landing/Screenshot";
import { withBase } from "../../utils/base";
import { LEARN_PANELS, type LearnPanel } from "./panels";

// Slot widths for the screenshot variants (learn.css): the hero is
// min(1040px, 100%) of the padded column; features share a two-column row on
// wide screens and take the full column at 760px and below.
const HERO_SIZES = "(max-width: 1112px) calc(100vw - 48px), 1040px";
const FEATURE_SIZES = "(max-width: 760px) calc(100vw - 48px), 560px";

// Each screenshot links to its image file, so it still opens without
// JavaScript; public/js/learn-lightbox.js upgrades the link to open the image
// full screen in the page's one <dialog>.
function ZoomableScreenshot(props: { src: string; alt: string; sizes: string; priority?: boolean }) {
    return (
        <a
            class="learn-shot-link"
            href={withBase(props.src)}
            aria-label={`View full size: ${props.alt}`}
            data-lightbox
        >
            <Screenshot src={props.src} alt={props.alt} sizes={props.sizes} priority={props.priority} />
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
                            <Icon src={props.panel.icon} size={44} />
                            <span>{props.panel.name}</span>
                        </div>
                        <MarketingHeading level={1} text={props.panel.headline} size={76} />
                        <p class="learn-intro">{props.panel.description}</p>
                        <DownloadCta />
                        <figure class="learn-hero-shot screenshot-card">
                            <ZoomableScreenshot
                                src={props.panel.image}
                                alt={props.panel.alt}
                                sizes={HERO_SIZES}
                                priority
                            />
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
                                        <ZoomableScreenshot
                                            src={feature.image}
                                            alt={feature.alt}
                                            sizes={FEATURE_SIZES}
                                        />
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
                                        <Icon src={panel.icon} size={28} lazy />
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
