// What one document of a panel frame says to the shell, and the answers it
// is sent back. Each load of the frame is a new document with its own
// generation: a message is read only from the frame's window with that
// generation, and every answer carries it. PanelView's frame keeps the
// document's lifecycle (loading it, its timeout, its overlays); this keeps
// the protocols: ready and failed, the swipe back, unsaved work and the
// question whether to leave it, haptics, the pages it names, the backup location window, a
// sign-in redirect to catch, and save and open dialogs.
import { HAPTIC_MESSAGE, LEAVE_ANSWER_MESSAGE, LEAVE_REQUEST_MESSAGE, PAGE_CRUMBS_MESSAGE, SWIPE_BACK_MESSAGE, UNSAVED_CHANGES_MESSAGE } from "@mileniumhq/paperapi";
import { FILE_TRANSFER_RESULT, parseFileTransferMessage, runPanelFileTransfer } from "../../lib/panelFileTransfer";
import { createFrameLoopbackRedirects, LOOPBACK_REDIRECT_CANCEL, LOOPBACK_REDIRECT_REQUEST, LOOPBACK_REDIRECT_RESULT, parseLoopbackRedirectMessage } from "../../lib/panelLoopbackRedirect";
import { BACKUP_LOCATION_REQUEST, BACKUP_LOCATION_RESULT, parseBackupLocationRequest } from "../../lib/backupLocationRequest";
import { setPanelUnsaved, type LeaveAnswer } from "../../lib/unsavedPanels";
import type { BackupLocationChoice } from "../backups/BackupLocationChooser";

/** the backup location window a document asked for, answered with `answer` */
export interface ChooserRequest {
    sourceId?: string;
    answer: (result: BackupLocationChoice) => void;
}

export interface FrameDocumentOptions {
    computerId: string;
    panelId: string;
    panelKey: string;
    generation: string;
    /** the frame's window, while it has one */
    window: () => Window | null | undefined;
    onReady: () => void;
    onFailed: (message: string) => void;
    onSwipeBack: (data: unknown) => void;
    onHaptic: (kind: unknown) => void;
    /** the panel's own open pages, outermost first, as it names them */
    onCrumbs: (titles: string[]) => void;
    /** whether a backup location window is already open for this frame */
    choosing: () => boolean;
    onChooseLocation: (request: ChooserRequest) => void;
}

/** one document's messages; `close` lets go of what it asked when the document goes */
export function createFrameDocument(options: FrameDocumentOptions) {
    const { generation, panelId } = options;
    const post = (target: Window, message: Record<string, unknown>) => {
        target.postMessage({ ...message, generation }, "*");
    };
    // a sign-in redirect this document asked the shell to catch
    const loopback = createFrameLoopbackRedirects(options.computerId);
    // what this document was asked about its unsaved work, by request
    const leaving = new Map<string, (answer: LeaveAnswer) => void>();
    const askToLeave = () =>
        new Promise<LeaveAnswer>((resolve) => {
            const target = options.window();
            if (!target) return resolve({ leave: true });
            const requestId = crypto.randomUUID();
            leaving.set(requestId, resolve);
            post(target, { type: LEAVE_REQUEST_MESSAGE, requestId });
        });

    const listener = (event: MessageEvent) => {
        const target = options.window();
        if (!target || event.source !== target || event.data?.generation !== generation) return;
        const data = event.data;
        switch (data.type) {
            case "paperboard:ready":
                if (data.panelId === panelId) options.onReady();
                return;
            case "paperboard:failed":
                options.onFailed(String(data.message || "Panel initialization failed"));
                return;
            case SWIPE_BACK_MESSAGE:
                options.onSwipeBack(data);
                return;
            case UNSAVED_CHANGES_MESSAGE:
                setPanelUnsaved(options.panelKey, data.unsaved === true ? askToLeave : null);
                return;
            case LEAVE_ANSWER_MESSAGE: {
                const resolve = leaving.get(data.requestId);
                leaving.delete(data.requestId);
                resolve?.({ leave: data.leave === true, error: typeof data.error === "string" ? data.error : undefined });
                return;
            }
            case HAPTIC_MESSAGE:
                options.onHaptic(data.kind);
                return;
            case PAGE_CRUMBS_MESSAGE:
                if (Array.isArray(data.titles)) options.onCrumbs(data.titles.filter((title: unknown): title is string => typeof title === "string"));
                return;
            case BACKUP_LOCATION_REQUEST: {
                const request = parseBackupLocationRequest(data, panelId, options.choosing());
                if (!request) return;
                const answer = (result: BackupLocationChoice) => post(target, { type: BACKUP_LOCATION_RESULT, requestId: request.requestId, result });
                if (request.refused) answer({ status: "failed", message: request.refused });
                else options.onChooseLocation({ sourceId: request.sourceId, answer });
                return;
            }
            case LOOPBACK_REDIRECT_REQUEST:
            case LOOPBACK_REDIRECT_CANCEL: {
                const message = parseLoopbackRedirectMessage(data);
                if (!message) return;
                if (message.kind === "cancel") loopback.cancel(message.requestId);
                else void loopback.request(message.requestId, message.redirectUri).then((result) => {
                    post(target, { type: LOOPBACK_REDIRECT_RESULT, requestId: message.requestId, result });
                });
                return;
            }
            default: {
                // a save or open dialog, answered on the frame that asked
                const request = parseFileTransferMessage(data);
                if (!request) return;
                void runPanelFileTransfer(options.computerId, panelId, request).then((result) => {
                    post(target, { type: FILE_TRANSFER_RESULT, requestId: request.requestId, result });
                });
            }
        }
    };
    window.addEventListener("message", listener);

    return {
        // the document is gone: its sign-in redirect stops being caught, and
        // its unsaved work is gone with it, so nothing is left to ask
        close() {
            window.removeEventListener("message", listener);
            loopback.closeAll();
            setPanelUnsaved(options.panelKey, null);
            for (const resolve of leaving.values()) resolve({ leave: true });
        },
    };
}
