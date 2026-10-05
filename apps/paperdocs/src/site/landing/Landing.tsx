import { For, type ParentProps } from "solid-js";
import { MarketingHeading } from "./MarketingHeading";
import { styledText } from "./TextEffect";
import { Screenshot } from "./Screenshot";
import { withBase } from "../../utils/base";
import {
    docsDropdownHtml,
    footerDocsHtml,
    footerLearnHtml,
    footerSiteHtml,
    learnDropdownHtml,
    mobileMenuHtml,
} from "./chromeHtml";

// The site landing (/). This is the Solid port of the old hand-written
// public/index.html: same markup, same class names, same effects. It ships as
// its own static document (scripts/prerender-site.mjs gives it landing.css and
// the public/js/*.js effects), not through SitePage.
//
// BgOverlay, StyledText, and PaperButton remain custom elements upgraded by
// those scripts, so their static markup is handed to Solid as innerHTML inside
// host wrappers (.bg-overlay-host, .styled-text-host, .paper-button-host) that
// carry the element-level placement the old element selectors held.

const CARD_NOISE_FILTER = `<svg width="100%" height="100%"><defs><filter id="card-noise" x="0%" y="0%" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="3" stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /></filter></defs><rect width="100%" height="100%" filter="url(#card-noise)" /></svg>`;

const SLIDES = [
    {
        src: "/screens/gameserver.png",
        alt: "Game Server panel",
        title: "Game Server",
        description: "Host and manage your Minecraft server.",
    },
    {
        src: "/screens/botcreator.png",
        alt: "Bot Creator panel",
        title: "Bot Creator",
        description: "Build Discord interactions without writing code.",
    },
    {
        src: "/screens/actions.png",
        alt: "Actions panel",
        title: "Actions",
        description: "Build flows that bring your panels together.",
    },
    {
        src: "/screens/ai.png",
        alt: "AI panel",
        title: "Local AI",
        description: "Chat with models on your own computer.",
    },
    {
        src: "/screens/panel-library.png",
        alt: "Panel Library",
        title: "Panel Library",
        description: "Find more things your computer can do.",
    },
    {
        src: "/screens/terminal.png",
        alt: "Terminal panel",
        title: "Terminal",
        description: "Your computer’s terminal, inside Paperboard.",
    },
];

const PLAY_ICONS = [
    "/pictures/ai.png",
    "/pictures/blocks.png",
    "/pictures/crane.png",
    "/pictures/discord-bot.png",
    "/pictures/game-server.png",
    "/pictures/panel-library.png",
    "/pictures/paperapi.png",
];

function XIcon() {
    return (
        <svg viewBox="1.254 2.25 21.573 19.5" fill="currentColor" aria-hidden="true">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.657l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
        </svg>
    );
}

function GitHubIcon() {
    return (
        <svg viewBox="0.5 0.5 23 22.443" fill="currentColor" aria-hidden="true">
            <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.17c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.07.78 2.16v3.2c0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
        </svg>
    );
}

function DiscordIcon() {
    return (
        <svg viewBox="0 2.853 24 18.295" fill="currentColor" aria-hidden="true">
            <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.444.865-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.036A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.056c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.211 0 2.176 1.094 2.157 2.418 0 1.334-.955 2.419-2.157 2.419Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.211 0 2.176 1.094 2.157 2.418 0 1.334-.946 2.419-2.157 2.419Z" />
        </svg>
    );
}

// --- Custom-element markup ---------------------------------------------------

// The topbar download button and the two hero/outro CTAs share one markup
// builder so download-button.js sees the same [data-download-button] shape.
function downloadButton(size?: "large"): string {
    return (
        `<paper-button variant="brand"${size ? ` size="${size}"` : ""} data-download-button${size ? "" : ' data-download-label="short"'}>` +
        `<span class="icon icon-download" aria-hidden="true"></span>` +
        `<span class="download-label">Download</span>` +
        `</paper-button>`
    );
}

const bgOverlayHtml = `<bg-overlay opacity="0.4"></bg-overlay>`;
const docsButtonHtml = `<paper-button variant="brand" href="/docs/"><span>View Docs</span><span class="icon icon-north-east" aria-hidden="true"></span></paper-button>`;
const githubButtonHtml = `<paper-button variant="black" href="https://github.com/MileniumHQ/Paperboard" target="_blank" rel="noopener noreferrer"><span class="icon icon-github" aria-hidden="true"></span><span>GitHub</span></paper-button>`;

export function DownloadCta() {
    return (
        <div class="download-cta">
            <div class="paper-button-host" innerHTML={downloadButton("large")} />
            <p class="download-note">
                <a href="/downloads">Looking for downloads for other OSes?</a>
            </p>
        </div>
    );
}

export function Topbar() {
    return (
        <header class="site-topbar">
            <div class="site-topbar__bar">
                <a class="site-topbar__brand" href="/">
                    <img class="site-topbar__logo" src={withBase("/paperboard.png")} alt="" />
                    <span class="site-topbar__name">Paperboard</span>
                </a>
                <nav class="site-topbar__nav" aria-label="Primary">
                    <div class="site-topbar__menu" data-topbar-menu>
                        <button class="site-topbar__trigger" type="button" aria-expanded="false">
                            Learn
                            <span class="icon icon-expand site-topbar__caret" aria-hidden="true" />
                        </button>
                        <div
                            class="site-topbar__dropdown"
                            role="menu"
                            innerHTML={learnDropdownHtml}
                        />
                    </div>
                    <div class="site-topbar__menu" data-topbar-menu>
                        <button class="site-topbar__trigger" type="button" aria-expanded="false">
                            Docs
                            <span class="icon icon-expand site-topbar__caret" aria-hidden="true" />
                        </button>
                        <div
                            class="site-topbar__dropdown"
                            role="menu"
                            innerHTML={docsDropdownHtml}
                        />
                    </div>
                    <a class="site-topbar__link" href="/blog">
                        Blog
                    </a>
                </nav>
                <div class="site-topbar__actions">
                    <button
                        class="site-topbar__mobile-toggle"
                        type="button"
                        aria-expanded="false"
                        aria-controls="site-mobile-menu"
                        aria-label="Open navigation"
                    >
                        <span class="icon icon-menu" aria-hidden="true" />
                    </button>
                    <span class="paper-button-host site-topbar__download">
                        <div innerHTML={downloadButton()} />
                    </span>
                </div>
            </div>
            <div class="site-topbar__mobile" id="site-mobile-menu" hidden>
                <div class="site-topbar__mobile-links" innerHTML={mobileMenuHtml} />
            </div>
        </header>
    );
}

export function Footer() {
    return (
        <footer class="site-footer">
            <div class="site-footer__inner">
                <nav class="site-footer__column" aria-label="Learn">
                    <div class="styled-text-host" innerHTML={styledText("Learn", 18)} />
                    <div class="site-footer__links" innerHTML={footerLearnHtml} />
                </nav>
                <nav class="site-footer__column" aria-label="Docs">
                    <div class="styled-text-host" innerHTML={styledText("Docs", 18)} />
                    <div class="site-footer__links" innerHTML={footerDocsHtml} />
                </nav>
                <nav class="site-footer__column" aria-label="Site">
                    <div class="styled-text-host" innerHTML={styledText("Site", 18)} />
                    <div class="site-footer__links" innerHTML={footerSiteHtml} />
                </nav>
            </div>
            <div class="site-footer__bottom">
                <span class="site-footer__copyright" data-year="" />
                <div class="site-footer__right">
                    <a
                        class="site-footer__social"
                        href="https://x.com/PaperboardHQ"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="X"
                    >
                        <XIcon />
                    </a>
                    <a
                        class="site-footer__social"
                        href="https://github.com/MileniumHQ/Paperboard"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="GitHub"
                    >
                        <GitHubIcon />
                    </a>
                    <a
                        class="site-footer__social"
                        href="https://discord.gg/DdnpP3pPfT"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Discord"
                    >
                        <DiscordIcon />
                    </a>
                    <span class="site-footer__separator" aria-hidden="true" />
                    <a
                        class="site-footer__milenium-link"
                        href="https://mileniumhq.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Milenium"
                    >
                        <span class="site-footer__milenium" aria-hidden="true" />
                    </a>
                </div>
            </div>
        </footer>
    );
}

export function MarketingChrome(props: ParentProps) {
    return (
        <>
            <Topbar />
            <div class="bg-overlay-host" innerHTML={bgOverlayHtml} />
            {props.children}
            <Footer />
        </>
    );
}

export function Landing() {
    return (
        <MarketingChrome>
            <div class="stage-fixed" aria-hidden="true">
                <canvas id="aio-stage" />
                <div class="stage-dash" aria-hidden="true" />
            </div>

            <main class="page-layout">
                <section class="hero-section">
                    <MarketingHeading level={1} text="Do more with your computer" size={90} />
                    <p class="hero-sub">Paperboard is an all-in-one toolkit for self-hosting.</p>
                    <DownloadCta />
                </section>

                <section class="showcase-section">
                    <div class="preview-card screenshot-card">
                        <div class="card-image-frame">
                            <div class="card-slides-track">
                                <For each={SLIDES}>
                                    {(slide) => (
                                        <div
                                            class="card-slide"
                                            data-slide-title={slide.title}
                                            data-slide-description={slide.description}
                                        >
                                            <Screenshot
                                                src={slide.src}
                                                alt={slide.alt}
                                                class="card-slide-image"
                                                eager
                                            />
                                        </div>
                                    )}
                                </For>
                            </div>
                        </div>
                        <div class="card-caption">
                            <span class="caption-title">Game Server</span>
                            <span class="caption-separator" aria-hidden="true">
                                ·
                            </span>
                            <span class="caption-desc">Host and manage your Minecraft server.</span>
                        </div>
                    </div>

                    <div class="dots-bar">
                        <div class="card-texture-layer" innerHTML={CARD_NOISE_FILTER} />
                        <For each={SLIDES}>
                            {(_, index) => (
                                <button class="dot" aria-label={`Slide ${index() + 1}`}>
                                    <div class="dot-progress" />
                                </button>
                            )}
                        </For>
                    </div>

                    <div class="showcase-content">
                        <MarketingHeading level={2} text="Your tools, together" size={54} />
                        <p>
                            Run a Minecraft server, build a Discord bot, or chat with local AI. Each
                            panel gives you a clear interface for one job.
                        </p>
                    </div>
                </section>

                <section class="stage-section">
                    <div class="stage-copy">
                        <MarketingHeading level={2} text="Use your other computers" size={54} />
                        <p>
                            Pair another computer and manage its panels from your desktop. Put an
                            old laptop, a home server, or a Raspberry Pi to work.
                        </p>
                    </div>
                </section>

                {/* Comparisons stay off the page until we have measured results. */}

                <section class="cta-section">
                    <div class="cta-shell">
                        <div class="cta-copy">
                            <MarketingHeading level={2} text="Build your own panel" size={54} />
                            <p>
                                Use Solid components and the Paperboard API to build panels. Start
                                with a template and follow the documentation.
                            </p>
                            <div class="cta-actions">
                                <div class="paper-button-host" innerHTML={docsButtonHtml} />
                                <div class="paper-button-host" innerHTML={githubButtonHtml} />
                            </div>
                        </div>
                        <div class="cta-card screenshot-card">
                            <img
                                class="cta-image"
                                src={withBase("/screens/paperconsole-docs.png")}
                                alt="The PaperConsole documentation page in PaperDocs"
                            />
                        </div>
                    </div>
                </section>

                <section class="outro-section" data-play-field>
                    <div class="outro-copy">
                        <MarketingHeading level={2} text="All this and more" size={72} />
                        <DownloadCta />
                    </div>
                    <For each={PLAY_ICONS}>
                        {(src) => (
                            <img class="play-icon" src={withBase(src)} alt="" draggable="false" />
                        )}
                    </For>
                </section>
            </main>
        </MarketingChrome>
    );
}
