import {
    createEffect,
    createSignal,
    createMemo,
    onCleanup,
    createContext,
    useContext,
    splitProps,
    type ParentProps,
    type JSX,
} from "solid-js";

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

export function PaperProvider(props: ParentProps<PaperProviderProps>) {
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

    const currentThemeMode = createMemo(() => local.theme ?? internalTheme());
    const resolvedTheme = createMemo(() => {
        const mode = currentThemeMode();
        if (mode === "system") {
            return systemPrefersDark() ? "dark" : "light";
        }
        return mode;
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

    const className = () =>
        [
            "paperui-root",
            local.fullScreen ? "fullScreen" : "",
            local.fullWidth ? "fullWidth" : "",
            local.fullHeight ? "fullHeight" : "",
            local.scrollable ? "scrollable" : "",
            isUnselectable() ? "unselectable" : "",
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
            </div>
        </PaperContext.Provider>
    );
}
