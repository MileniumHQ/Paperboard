import { unsignedDownload } from './unsigned-downloads.mjs';

let pending = false;
let closed = false;

async function showWarning(download, trigger) {
    if (pending || closed) return;
    pending = true;
    try {
        // Marketing pages load Solid only when a visitor requests this modal.
        // Other pages reuse their already-loaded client bundle and controls.
        const client = await import('/site-client.js');
        if (!closed) await client.showUnsignedDownload(download, trigger);
    } catch (error) {
        console.error('Installation guidance unavailable', error);
        if (!closed && !document.querySelector('.download-warning-error')) {
            const notice = document.createElement('div');
            notice.className = 'paperui-root download-warning-error';
            notice.setAttribute('role', 'alert');
            notice.append('Installation help could not load. ');
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
    const download = unsignedDownload(link.getAttribute('href'));
    if (!download) return;
    event.preventDefault();
    void showWarning(download, link);
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
