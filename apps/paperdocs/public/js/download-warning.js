import { unsignedDownload } from './unsigned-downloads.mjs';
import { linuxDownloads } from './linux-downloads.mjs';

let pending = false;
let closed = false;

async function showWarning(show, trigger) {
    if (pending || closed) return;
    pending = true;
    try {
        // Marketing pages load Solid only when a visitor requests this modal.
        // Other pages reuse their already-loaded client bundle and controls.
        const client = await import('/site-client.js');
        if (!closed) await show(client);
    } catch (error) {
        console.error('Download help unavailable', error);
        if (!closed && !document.querySelector('.download-warning-error')) {
            const notice = document.createElement('div');
            notice.className = 'paperui-root download-warning-error';
            notice.setAttribute('role', 'alert');
            notice.append('Download help could not load. ');
            const reload = document.createElement('button');
            reload.type = 'button';
            reload.textContent = 'Reload and try again';
            reload.addEventListener('click', () => location.reload());
            notice.append(reload);
            document.body.append(notice);
        }
    } finally { pending = false; }
}

function onDownload(event) {
    if (event.defaultPrevented || (event.type === 'auxclick' && event.button !== 1)) return;
    const path = event.composedPath();
    if (path.some(node => node instanceof Element && node.classList.contains('download-warning'))) return;
    const link = path.find(node => node instanceof HTMLElement && node.hasAttribute('href'));
    if (!link || link.hasAttribute('disabled') || link.getAttribute('aria-disabled') === 'true') return;
    const href = link.getAttribute('href');
    const download = unsignedDownload(href);
    // Only the detected download button asks for a Linux format: a link on
    // the downloads page already names one.
    const linux = path.some(node => node instanceof Element && node.hasAttribute('data-download-button')) ? linuxDownloads(href) : null;
    if (download) {
        event.preventDefault();
        void showWarning(client => client.showUnsignedDownload(download, link), link);
    } else if (linux) {
        event.preventDefault();
        void showWarning(client => client.showLinuxDownload(linux, link), link);
    }
}

document.addEventListener('click', onDownload);
document.addEventListener('auxclick', onDownload);
function onPageHide(event) {
    // A cached document keeps its controller for browser Back/Forward.
    if (event.persisted) return;
    closed = true;
    document.removeEventListener('click', onDownload);
    document.removeEventListener('auxclick', onDownload);
    window.removeEventListener('pagehide', onPageHide);
}
window.addEventListener('pagehide', onPageHide);
