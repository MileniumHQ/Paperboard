import { For } from "solid-js";
import { PaperMediaCard, PaperMediaCardGroup } from "@mileniumhq/paperui";
import type { GameDefinition } from "../games";
export default function GamePicker(props: { games: readonly GameDefinition[]; onPick(id: string): void }) {
    return (
        <PaperMediaCardGroup minCardWidth="card-min">
            <For each={props.games}>
                {(game) => (
                    <PaperMediaCard
                        banner={game.art.banner}
                        poster={game.art.poster}
                        posterAlt={`${game.name} cover art`}
                        title={game.name}
                        description={game.art.tagline}
                        onClick={() => props.onPick(game.id)}
                    />
                )}
            </For>
        </PaperMediaCardGroup>
    );
}
