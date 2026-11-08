import { PaperButton, PaperEffect, PaperModal, PaperSelector, PaperSelectorItem, PaperText } from '@mileniumhq/paperui';
import { createSignal, For, Match, onCleanup, Show, Switch } from 'solid-js';
import { render } from 'solid-js/web';
import { installationGuidance, unsignedExplanation, type UnsignedDownload } from '../../public/js/unsigned-downloads.mjs';
import type { LinuxDownloads } from '../../public/js/linux-downloads.mjs';

// What a download link asks before it downloads: how to open an unsigned
// Windows or Mac build, or which Linux format to get.
type DownloadRequest = { kind: 'unsigned'; download: UnsignedDownload } | { kind: 'linux'; downloads: LinuxDownloads };

let show: ((request: DownloadRequest, trigger: HTMLElement) => void) | undefined;

// One lazy island uses the actual shared controls and modal, including their
// entry/exit transitions, accessible title, focus traversal and reduced motion.
export function showUnsignedDownload(download: UnsignedDownload, trigger: HTMLElement) {
    showRequest({ kind: 'unsigned', download }, trigger);
}

export function showLinuxDownload(downloads: LinuxDownloads, trigger: HTMLElement) {
    showRequest({ kind: 'linux', downloads }, trigger);
}

function showRequest(request: DownloadRequest, trigger: HTMLElement) {
    if (!show) {
        const root = document.createElement('div');
        root.id = 'download-warning-root';
        document.body.append(root);
        const dispose = render(() => <DownloadWarning />, root);
        function onPageHide(event: PageTransitionEvent) {
            if (event.persisted) return;
            dispose();
            root.remove();
            show = undefined;
            window.removeEventListener('pagehide', onPageHide);
        }
        window.addEventListener('pagehide', onPageHide);
    }
    show!(request, trigger);
}

function DownloadWarning() {
    const [request, setRequest] = createSignal<DownloadRequest>();
    const [format, setFormat] = createSignal<string | number>('appimage');
    const [open, setOpen] = createSignal(false);
    let trigger: HTMLElement | undefined;
    let overflow = '';
    let closing = false;
    let closingObserver: MutationObserver | undefined;
    const inertElements = new Map<HTMLElement, boolean>();

    function restoreBackground() {
        document.documentElement.style.overflow = overflow;
        for (const [element, inert] of inertElements) element.inert = inert;
        inertElements.clear();
    }
    function finishClose() {
        closingObserver?.disconnect();
        closingObserver = undefined;
        closing = false;
        restoreBackground();
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    }
    function close() {
        if (!open()) return;
        closing = true;
        const surface = document.querySelector('.download-warning');
        // PaperModal removes the backdrop from its Portal wrapper on exit;
        // observing the backdrop itself would miss that removal.
        const portal = surface?.parentElement?.parentElement;
        if (portal) {
            // Keep the page inert until PaperModal finishes its exit animation.
            closingObserver = new MutationObserver(() => {
                if (!surface.isConnected) finishClose();
            });
            closingObserver.observe(portal, { childList: true });
        }
        setOpen(false);
        if (!portal) finishClose();
    }
    show = (selected, source) => {
        if (open() || closing) return;
        trigger = source;
        // PaperModal records the focused trigger; focus it explicitly for
        // browsers whose pointer clicks do not focus anchors.
        source.focus({ preventScroll: true });
        setRequest(selected);
        setFormat('appimage');
        overflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        setOpen(true);
        // Keep the portal interactive and disable only the page behind it.
        for (const child of document.body.children) {
            // A previous modal may still be fading out during a quick reopen.
            // Never make any modal portal inert while finding the page surface.
            if (!(child instanceof HTMLElement) || child.matches('.download-warning') || child.querySelector('.download-warning')) continue;
            inertElements.set(child, child.inert);
            child.inert = true;
        }
    };
    onCleanup(() => {
        closingObserver?.disconnect();
        if (open() || closing) restoreBackground();
        show = undefined;
    });
    const unsigned = () => {
        const current = request();
        return current?.kind === 'unsigned' ? current.download : undefined;
    };
    const linux = () => {
        const current = request();
        return current?.kind === 'linux' ? current.downloads : undefined;
    };
    const guidance = () => installationGuidance[unsigned()!.platform];
    const chosen = () => {
        const choice = linux()!.choices.find(item => item.id === format());
        if (!choice) throw new Error(`No Linux download for ${String(format())}`);
        return choice;
    };
    // The file the Download button gets, whichever question was asked.
    const target = () => (unsigned() ?? chosen()) as { href: string; file: string };

    return (
        <Show when={request()}>
            <PaperModal
                open={open()}
                onClose={close}
                title={unsigned() ? `Installing on ${guidance().label}` : 'Download for Linux'}
                class="paperui-root download-warning"
                size="medium"
                aria-describedby="download-warning-summary"
                footer={<>
                    <PaperButton variant="text" onClick={close}>Cancel</PaperButton>
                    <PaperEffect variant="brand">
                        <PaperButton variant="brand" href={target().href} onClick={close} class="download-warning__download">
                            Download
                        </PaperButton>
                    </PaperEffect>
                </>}
            >
                <Switch>
                    <Match when={unsigned()}>
                        <div id="download-warning-summary"><PaperText as="p" preset="body">{guidance().summary}</PaperText></div>
                        <PaperText as="p" preset="body" color="text-subtle">{unsignedExplanation}</PaperText>
                        <ol class="download-warning__steps"><For each={guidance().steps}>{step => <li>{step}</li>}</For></ol>
                        <PaperText as="p" preset="caption" color="text-subtle">{guidance().note}</PaperText>
                        <a class="download-warning__source" href={guidance().source} target="_blank" rel="noopener noreferrer">{guidance().sourceLabel}</a>
                    </Match>
                    <Match when={linux()}>
                        {(downloads) => <>
                            <div id="download-warning-summary">
                                <PaperText as="p" preset="body">Paperboard for Linux ({downloads().architecture}) comes in three formats. Pick the one for your distribution.</PaperText>
                            </div>
                            <PaperSelector name="linux-format" value={format()} onValueChange={setFormat} aria-label="Format">
                                <For each={downloads().choices}>
                                    {choice => <PaperSelectorItem value={choice.id} description={choice.description}>{choice.label}</PaperSelectorItem>}
                                </For>
                            </PaperSelector>
                        </>}
                    </Match>
                </Switch>
                <PaperText as="p" preset="caption" family="code" breakWord color="text-subtle" class="download-warning__filename">{target().file}</PaperText>
            </PaperModal>
        </Show>
    );
}
