import {
    createEffect,
    createSignal,
    createMemo,
    onCleanup,
    createContext,
    useContext,
    splitProps,
    Show,
    type ParentProps,
    type JSX,
} from "solid-js";
import { PaperToastRegion } from "../PaperToast";
import { installSwipeBack } from "../../utils/swipeBack";
import { installTouchHold } from "../../utils/touchHold";
import { installPressCancel } from "../../utils/pressCancel";
import { installFrameBackground } from "../../utils/frameBackground";
import { installPageZoomLock } from "../../utils/pageZoom";
import { installUncaughtErrors } from "../../utils/uncaughtErrors";

export type ThemeMode = "light" | "dark" | "system";

export interface PaperProviderProps extends JSX.HTMLAttributes<HTMLDivElement> {
    theme?: ThemeMode;
    styleBody?: boolean;
    fullScreen?: boolean;
    fullHeight?: boolean;
    fullWidth?: boolean;
    scrollable?: boolean;
    unselectable?: boolean;
    noSelect?: boolean;
}

interface PaperContextValue {
    theme: () => ThemeMode;
    setTheme: (theme: ThemeMode) => void;
}

const PaperContext = createContext<PaperContextValue>();

export function usePaper() {
    return useContext(PaperContext);
}

function iconFontFamily(): string {
    const family = getComputedStyle(document.documentElement).getPropertyValue("--paper-icon-font-family").trim();
    if (!family) throw new Error("--paper-icon-font-family is not set: import @mileniumhq/paperui/style.css");
    return family;
}

// true when there is nothing to wait for: no document (server render), no
// font loading API (jsdom), or the font already loaded in this document
function iconFontReady(): boolean {
    if (typeof document === "undefined" || !document.fonts) return true;
    return document.fonts.check(`1em ${iconFontFamily()}`);
}

export function PaperProvider(props: ParentProps<PaperProviderProps>) {
    const outermost = useContext(PaperContext) === undefined;
    const [local, rest] = splitProps(props, [
        "theme",
        "styleBody",
        "fullScreen",
        "fullHeight",
        "fullWidth",
        "scrollable",
        "unselectable",
        "noSelect",
        "class",
        "classList",
        "children",
    ]);

    const [internalTheme, setInternalTheme] = createSignal<ThemeMode>("system");
    const [systemPrefersDark, setSystemPrefersDark] = createSignal(false);

    // host-injected theme: the shell writes data-paperui-theme on the panel
    // document's <html> root (alongside data-paperui-motion). When the
    // caller gives no explicit theme, that resolved choice wins over the OS
    // media query — a panel must match the window it lives in, not the OS.
    const readHostTheme = (): "dark" | "light" | null => {
        if (typeof document === "undefined") return null;
        const value = document.documentElement?.getAttribute("data-paperui-theme");
        return value === "dark" || value === "light" ? value : null;
    };
    const [hostTheme, setHostTheme] = createSignal<"dark" | "light" | null>(
        readHostTheme(),
    );

    createEffect(() => {
        if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
            return;
        }
        const observer = new MutationObserver(() => setHostTheme(readHostTheme()));
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-paperui-theme"],
        });
        onCleanup(() => observer.disconnect());
    });

    createEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        setSystemPrefersDark(mediaQuery.matches);

        const handleChange = (e: MediaQueryListEvent) => {
            setSystemPrefersDark(e.matches);
        };

        mediaQuery.addEventListener("change", handleChange);
        onCleanup(() => mediaQuery.removeEventListener("change", handleChange));
    });

    // touch screens: a finger swipes an open page back from anywhere on it,
    // and holding still opens a context menu
    onCleanup(installSwipeBack());
    onCleanup(installTouchHold());
    // a press that slides off its control lets go of it, like a native button
    onCleanup(installPressCancel());
    // in a panel frame: the shell colors the strip under it to match
    onCleanup(installFrameBackground());
    // a pinch is for a panel's own gestures, not for zooming the document
    onCleanup(installPageZoomLock());
    // what nothing caught is said in a toast, not only in the console
    onCleanup(installUncaughtErrors());

    const currentThemeMode = createMemo(() => local.theme ?? internalTheme());
    const resolvedTheme = createMemo(() => {
        const mode = currentThemeMode();
        if (mode !== "system") {
            return mode;
        }
        // no explicit mode from the caller: a host-injected theme wins
        if (local.theme === undefined) {
            const host = hostTheme();
            if (host) return host;
        }
        return systemPrefersDark() ? "dark" : "light";
    });

    createEffect(() => {
        if (local.styleBody && typeof document !== "undefined") {
            const body = document.body;
            body.setAttribute("data-paperui-theme", resolvedTheme());
            if (local.unselectable || local.noSelect) {
                body.setAttribute("data-unselectable", "true");
                body.classList.add("unselectable");
            } else {
                body.removeAttribute("data-unselectable");
                body.classList.remove("unselectable");
            }
        }
    });

    const contextValue: PaperContextValue = {
        theme: currentThemeMode,
        setTheme: (t) => setInternalTheme(() => t),
    };

    const isUnselectable = () => Boolean(local.unselectable || local.noSelect);

    // icons are ligatures in the icon font: painted before it loads, every
    // icon is blank and its row jumps when the font lands. A fresh document
    // (a panel opening, or reloading for another page) holds its first paint
    // until the font is ready, so it appears whole.
    const [iconsReady, setIconsReady] = createSignal(iconFontReady());
    if (!iconsReady()) {
        document.fonts.load(`1em ${iconFontFamily()}`).then(
            () => setIconsReady(true),
            (err) => {
                setIconsReady(true);
                throw new Error(`PaperUI's icon font failed to load: ${err instanceof Error ? err.message : String(err)}`);
            },
        );
    }

    const className = () =>
        [
            "paperui-root",
            local.fullScreen ? "fullScreen" : "",
            local.fullWidth ? "fullWidth" : "",
            local.fullHeight ? "fullHeight" : "",
            local.scrollable ? "scrollable" : "",
            isUnselectable() ? "unselectable" : "",
            iconsReady() ? "" : "iconsPending",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <PaperContext.Provider value={contextValue}>
            <div
                {...rest}
                class={className()}
                classList={local.classList}
                data-paperui-theme={resolvedTheme()}
            >
                {local.children}
                {/* one corner of toasts per document: a provider inside another shares its parent's */}
                <Show when={outermost}>
                    <PaperToastRegion data-paperui-theme={resolvedTheme()} />
                </Show>
            </div>
        </PaperContext.Provider>
    );
}
