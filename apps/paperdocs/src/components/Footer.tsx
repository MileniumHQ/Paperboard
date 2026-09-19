import { PaperText } from "@paperboard-dev/paperui";
import { For } from "solid-js";
import { withBase } from "../utils/base";
import styles from "./footer.module.css";

interface FooterLink {
    label: string;
    href: string;
}

// Learn and Site are website-root pages, so they stay absolute. Docs pages
// live under the docs base, so they go through withBase.
const LEARN_LINKS: FooterLink[] = [
    { label: "About Paperboard", href: "/" },
    { label: "Actions", href: "/actions" },
    { label: "Game Server", href: "/game-server" },
    { label: "Bot Creator", href: "/bot-creator" },
    { label: "Local AI", href: "/ai" },
];

const DOCS_LINKS: FooterLink[] = [
    { label: "Getting Started", href: withBase("/paperboard/getting-started") },
    { label: "Actions", href: withBase("/paperboard/actions") },
    { label: "Support", href: withBase("/paperboard/support") },
    { label: "PaperAPI", href: withBase("/paperapi") },
    { label: "PaperUI", href: withBase("/paperui") },
];

const SITE_LINKS: FooterLink[] = [
    { label: "Blog", href: "/blog" },
    { label: "Brand", href: "/brand" },
    { label: "Contact", href: "/contact" },
    { label: "Downloads", href: "/downloads" },
    { label: "Terms of Use", href: "/terms" },
    { label: "Privacy Policy", href: "/privacy" },
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

function LinkColumn(props: { heading: string; links: FooterLink[] }) {
    return (
        <nav class={styles.column} aria-label={props.heading}>
            <PaperText
                as="h3"
                size={2}
                weight={700}
                class={styles.heading}
            >
                {props.heading}
            </PaperText>
            <For each={props.links}>
                {(link) => (
                    <a class={styles.link} href={link.href}>
                        {link.label}
                    </a>
                )}
            </For>
        </nav>
    );
}

export function Footer() {
    const wordmarkMask = `url(${withBase("/milenium.svg")})`;

    return (
        <footer class={styles.footer}>
            <div class={styles.inner}>
                <LinkColumn heading="Learn" links={LEARN_LINKS} />
                <LinkColumn heading="Docs" links={DOCS_LINKS} />
                <LinkColumn heading="Site" links={SITE_LINKS} />
            </div>
            <div class={styles.bottom}>
                <PaperText size={2} class={styles.copyright}>
                    &copy; {new Date().getFullYear()} Milenium LLC
                </PaperText>
                <div class={styles.right}>
                    <a
                        class={styles.social}
                        href="https://x.com/PaperboardHQ"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="X"
                    >
                        <XIcon />
                    </a>
                    <a
                        class={styles.social}
                        href="https://github.com/MileniumHQ/Paperboard"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="GitHub"
                    >
                        <GitHubIcon />
                    </a>
                    <a
                        class={styles.social}
                        href="https://discord.gg/DdnpP3pPfT"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Discord"
                    >
                        <DiscordIcon />
                    </a>
                    <span class={styles.separator} aria-hidden="true" />
                    <a
                        class={styles.mileniumLink}
                        href="https://mileniumhq.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Milenium"
                    >
                        <span
                            class={styles.milenium}
                            style={{
                                "-webkit-mask-image": wordmarkMask,
                                "mask-image": wordmarkMask,
                            }}
                        />
                    </a>
                </div>
            </div>
        </footer>
    );
}
