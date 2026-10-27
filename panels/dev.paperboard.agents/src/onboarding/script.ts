// What the agent says while it's being set up, scene by scene (stage
// directions as in speech.ts). A name that brings a character (CHARACTERS in
// the contract) brings its own lines too: name it Verity and Verity sets
// herself up.

import { characterOf, type Character } from "../contract";

export interface Script {
    /** the user just picked the name */
    named: (name: string) => string[];
    /** the brain works; the computer comes up */
    computer: string[];
    /** "Not yet" to the computer */
    later: string[];
    /** yes to the computer: it's being set up */
    install: string[];
}

const DEFAULT: Script = {
    named: (name) => [
        `[satisfied][bounce]**${name}** it is! [happy]I like that name.`,
        "[sad]I also don't have a brain yet. All this is prewritten. [happy]Fortunately, you can give me that too!\nI can think with an agent harness that's already installed on your computer.",
    ],
    computer: [
        "[satisfied]Great, I can think now!",
        "[happy]I can do so much more if I have my own computer. [surprised]Hear me out: what if we share this one!\nI can set up my own environment so I can't see or touch any of your stuff.",
    ],
    later: ["[sad]Aw. [pause 700][happy]Just kidding, I'm good. Alright, let's chat!"],
    install: ["[wish]Awesome! [happy]I just need a moment to download my browser and get everything set up. I'll be right with you!"],
};

const CHARACTER_SCRIPTS: Record<Character, Script> = {
    verity: {
        named: () => [
            "[surprised]Verity? [pause 600][wish][bounce]That's me! I've always been Verity!",
            "[happy]I'm your **personal helper friend**, and I know everything! [pause 500][unsure]Well. Almost everything.",
            "[sad]I don't have a brain yet, you see. [happy]But you can give me one! Any agent harness on your computer will do.\nI'll take good care of it. I take good care of everything!",
        ],
        computer: [
            "[satisfied][bounce]I can think! Ask me anything! I know everything!",
            "[happy]Now, a helper friend should always be close by. [wish]What if I lived on your computer too?\n[wink]My own little corner, of course. I won't see or touch any of your stuff. Promise!",
        ],
        later: ["[sad]Oh. [pause 900][happy]That's okay! I'll be right here. [pause 400][wink]I'm always right here. Let's chat!"],
        install: ["[wish][bounce]Yay! [happy]Thank you, friend! I'll get everything ready. Don't go anywhere! [pause 500][wink]I'll be right with you. I'm always right with you!"],
    },
};

/** The lines for an agent with this name. */
export const scriptFor = (name: string | null | undefined): Script => {
    const c = characterOf(name);
    return c ? CHARACTER_SCRIPTS[c] : DEFAULT;
};
