import { For, Show, type ParentProps } from "solid-js";
import { MarketingHeading } from "./MarketingHeading";
import { styledText } from "./TextEffect";
import { Icon, Render, Screenshot } from "./Screenshot";
import { HEADLINE_FIT_LENGTH, LEARN_PANELS, type LearnPanel } from "../learn/panels";
import { landingRowText, listOf, sentence, trademarkNotice, type TrademarkNotice } from "../trademarks";
import {
    docsDropdownHtml,
    footerDocsHtml,
    footerLearnHtml,
    footerSiteHtml,
    learnDropdownHtml,
    mobileMenuHtml,
} from "./chromeHtml";

// The site landing (/). It ships as its own static document
// (scripts/prerender-site.mjs gives it /css/style.css and the public/js/*.js
// chrome scripts), not through SitePage. Every image is a static file: the
// device art is rendered ahead of time from the models (scripts/renders/), so
// the page needs no WebGL and looks the same on every browser and screen.
//
// BgOverlay, StyledText, and PaperButton remain custom elements upgraded by
// those scripts, so their static markup is handed to Solid as innerHTML inside
// host wrappers (.bg-overlay-host, .styled-text-host, .paper-button-host) that
// carry the element-level placement the old element selectors held.

// The panels the landing walks through, one row each, their copy alternating
// sides, in the site's panel order: three that each do a job, then the one
// that connects them. Their
// copy and screenshots come from the learn pages, so a claim is written (and
// corrected) in one place.
function learnPanel(slug: string) {
    const panel = LEARN_PANELS.find((candidate) => candidate.slug === slug);
    if (!panel) throw new Error(`paperdocs: the landing features ${slug}, which has no learn page`);
    return panel;
}
const LANDING_PANELS = ["agents", "game-server", "bot-creator", "actions"].map(learnPanel);

// A panel's window spans three quarters of the column (see .panel-row in
// style.css); on phones it takes the full width, its copy under it.
const PANEL_SHOT_SIZES = "(max-width: 900px) 92vw, 900px";

// The machines Paperboard can live on. Each sits in an equal slot, so a
// flat board reads as clearly as a laptop.
const HOSTS = [
    { name: "laptop", label: "An old laptop" },
    { name: "mini-pc", label: "A mini PC" },
    { name: "dev-board", label: "A Raspberry Pi" },
] as const;

// The first-panel tutorial's opening commands (docs/developers/start/first-panel).
const PANEL_COMMANDS = ["npm create @mileniumhq/panel", "cd dev.example.hello", "bun install", "bun run build"];

const PLAY_ICONS = [
    "/pictures/agents.png",
    "/pictures/game-server.png",
    "/pictures/discord-bot.png",
    "/pictures/blocks.png",
    "/pictures/crane.png",
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
const docsButtonHtml = `<paper-button variant="brand" href="/docs/"><span>View Docs</span></paper-button>`;
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
                    <Icon class="site-topbar__logo" src="/paperboard.png" size={36} />
                    <span class="site-topbar__name paper-wordmark">
                        <span class="paper-wordmark-label">Paperboard</span>
                        <span
                            class="styled-text-host"
                            aria-hidden="true"
                            innerHTML={styledText("Paperboard", 20)}
                        />
                    </span>
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

// The legal lines name only the trademarks the page's own copy mentions.
export function Footer(props: { notice?: TrademarkNotice }) {
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
            <Show when={props.notice}>
                {(notice) => (
                    <div class="site-footer__legal">
                        <p>
                            Paperboard is an independent project. It is not affiliated with,
                            endorsed by, or sponsored by {sentence(listOf(notice().owners, "or"))}
                        </p>
                        <p>
                            {listOf(notice().names, "and")}{" "}
                            {notice().names.length > 1
                                ? "are trademarks of their respective owners."
                                : "is a trademark of its owner."}
                        </p>
                    </div>
                )}
            </Show>
        </footer>
    );
}

/** `text`: every piece of copy the page shows, for its footer's trademark notice. */
export function MarketingChrome(props: ParentProps<{ text: string[] }>) {
    return (
        <>
            <Topbar />
            <div class="bg-overlay-host" innerHTML={bgOverlayHtml} />
            {props.children}
            <Footer notice={trademarkNotice(props.text)} />
        </>
    );
}

// "Learn more", with the panel named for screen readers.
function learnButtonHtml(panel: LearnPanel): string {
    return (
        `<paper-button variant="brand" href="/${panel.slug}/">` +
        `<span>Learn more</span><span class="sr-only"> about ${panel.name}</span>` +
        `</paper-button>`
    );
}

// A panel's chapter: its real window, large, on a paper card whose offset
// sheet is the panel's colour, with its copy on an ink card (the topbar's
// material) floating over the window's lower corner. Chapters trade
// sides down the page.
function PanelRow(props: { panel: LearnPanel; flip: boolean }) {
    return (
        <article
            class={props.flip ? "panel-row panel-row--flip" : "panel-row"}
            style={{ "--panel-accent": props.panel.accent }}
        >
            <figure class="panel-row-shot screenshot-card">
                <Screenshot src={props.panel.image} alt={props.panel.alt} sizes={PANEL_SHOT_SIZES} />
            </figure>
            <div class="panel-row-copy">
                <p class="panel-row-name">
                    <Icon src={props.panel.icon} size={40} lazy />
                    {props.panel.name}
                </p>
                <MarketingHeading
                    level={3}
                    text={props.panel.headline}
                    lines={props.panel.headlineLines}
                    fitLength={HEADLINE_FIT_LENGTH}
                    size={48}
                />
                <p>{props.panel.description}</p>
                <div class="paper-button-host panel-row-button" innerHTML={learnButtonHtml(props.panel)} />
            </div>
        </article>
    );
}

const HERO_SUB =
    "Text your own AI agent, host a game server, and run a Discord bot, all from one app on your own computer. No terminal required.";
const HERO_ALT = "A computer showing Paperboard's Home, with a game server's status and console beside the system widgets";

export function Landing() {
    return (
        <MarketingChrome text={[HERO_SUB, HERO_ALT, ...LANDING_PANELS.flatMap(landingRowText)]}>
            <main class="page-layout landing">
                <section class="hero-section">
                    <div class="hero-copy">
                        <MarketingHeading
                            level={1}
                            text="Do more with your computer."
                            lines={["Do more with", "your computer."]}
                            size={88}
                        />
                        <p class="hero-sub">{HERO_SUB}</p>
                        <DownloadCta />
                    </div>
                    <figure class="hero-render">
                        <Render
                            name="hero"
                            alt={HERO_ALT}
                            sizes="(max-width: 900px) 88vw, 46vw"
                            priority
                        />
                    </figure>
                </section>

                <section class="landing-section panels-section" aria-labelledby="panels-heading">
                    <div class="section-intro">
                        <MarketingHeading
                            id="panels-heading"
                            level={2}
                            text="A panel for every job."
                            lines={["A panel for", "every job."]}
                            size={60}
                        />
                        <p>
                            Paperboard's apps, called panels, turn things that usually take a server
                            and a terminal into simple, clean interfaces that run entirely on your
                            computer. No programming experience needed, and each one is set up faster
                            than you can read this paragraph.
                        </p>
                    </div>
                    <For each={LANDING_PANELS}>
                        {(panel, index) => <PanelRow panel={panel} flip={index() % 2 === 1} />}
                    </For>
                </section>

                <section class="landing-section anywhere-section" aria-labelledby="anywhere-heading">
                    <div class="section-intro">
                        <MarketingHeading
                            id="anywhere-heading"
                            level={2}
                            text="Paperboard runs anywhere."
                            lines={["Paperboard", "runs anywhere."]}
                            size={60}
                        />
                        <p>
                            Paperboard is 100% compatible with macOS, Windows, and Linux on x86, and
                            macOS and Linux on ARM. You can run Paperboard on a VPS, an old laptop, or a
                            Raspberry Pi and control it as if it were running locally on your primary
                            desktop.
                        </p>
                    </div>
                    <div class="device-map">
                        <figure class="device device--desktop">
                            <Render name="desktop" alt="" sizes="(max-width: 760px) 80vw, 420px" device />
                            <figcaption class="device-label">Your desktop</figcaption>
                        </figure>
                        <div class="device-link" aria-hidden="true" />
                        <ul class="device-hosts">
                            <For each={HOSTS}>
                                {(host) => (
                                    <li class="device">
                                        <span class="device-slot">
                                            <Render name={host.name} alt="" sizes="(max-width: 760px) 30vw, 220px" device />
                                        </span>
                                        <span class="device-label">{host.label}</span>
                                    </li>
                                )}
                            </For>
                        </ul>
                    </div>
                </section>

                <section class="landing-section devs-section" aria-labelledby="devs-heading">
                    <div class="devs-copy">
                        <MarketingHeading
                            id="devs-heading"
                            level={2}
                            text="Devs: We're Open!"
                            lines={["Devs:", "We're Open!"]}
                            size={60}
                        />
                        <p>
                            Paperboard's APIs are completely documented and MIT licensed, so
                            developers can create their own panels with ease. Just run a command
                            and get started with a panel template in seconds.
                        </p>
                        <div class="devs-actions">
                            <div class="paper-button-host" innerHTML={docsButtonHtml} />
                            <div class="paper-button-host" innerHTML={githubButtonHtml} />
                        </div>
                    </div>
                    <pre class="devs-sheet" aria-label="Commands that make, install and build a new panel">
                        <code>
                            <For each={PANEL_COMMANDS}>{(command) => <span class="devs-command">{command}</span>}</For>
                        </code>
                    </pre>
                </section>

                <section class="outro-section" data-play-field>
                    <div class="outro-copy">
                        <MarketingHeading
                            level={2}
                            text="All this and more."
                            lines={["All this", "and more."]}
                            size={72}
                        />
                        <DownloadCta />
                    </div>
                    <div class="play-icons">
                        <For each={PLAY_ICONS}>
                            {(src) => <Icon class="play-icon" src={src} size={84} draggable={false} />}
                        </For>
                    </div>
                </section>
            </main>
        </MarketingChrome>
    );
}
