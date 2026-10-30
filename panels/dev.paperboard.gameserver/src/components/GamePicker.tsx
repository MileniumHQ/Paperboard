import { For } from "solid-js";
import { PaperSelector, PaperSelectorItem } from "@mileniumhq/paperui";
import type { GameDefinition } from "../games";
/** Deliberately separate: the art selector can replace this without setup changes. */
export default function GamePicker(props: { games: readonly GameDefinition[]; value: string; onPick(game: GameDefinition): void }) {
    return <PaperSelector name="game" value={props.value} onValueChange={value => {
        const game = props.games.find(g => g.id === value);
        if (!game) throw new Error(`Unknown game: ${value}`);
        props.onPick(game);
    }}><For each={props.games}>{game => <PaperSelectorItem value={game.id}>{game.name}</PaperSelectorItem>}</For></PaperSelector>;
}
