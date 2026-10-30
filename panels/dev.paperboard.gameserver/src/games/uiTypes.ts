import type { JSX } from "solid-js";
import type { PaperFileReveal } from "@mileniumhq/paperui";
export interface GameTabContext {
    active(): string;
    hasTab(id: string): boolean;
    openTab(id: string): void;
    revealFiles(reveal: PaperFileReveal): void;
}
export interface GameUI {
    create(context: GameTabContext): GameView;
}
export interface GameView {
    setup(props: { initialSoftware: string; initialVersion: string; onComplete(): void }): JSX.Element;
    tab(id: string): JSX.Element;
}
