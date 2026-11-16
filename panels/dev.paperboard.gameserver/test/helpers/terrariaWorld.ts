/** a .wld whose header reads as `title` (and the seed `seed`): Terraria's layout, every later field zero */
export function terrariaWorld(title: string, seed = "12345"): Uint8Array {
    const bytes = new Uint8Array(8192);
    const view = new DataView(bytes.buffer);
    view.setInt32(0, 279, true); // file version (1.4.4)
    view.setBigUint64(4, 0x6369676f6c6572n | (2n << 56n), true); // "relogic", world
    view.setInt16(24, 1, true); // one section
    view.setInt32(26, 64, true); // the header at 64
    let at = 64;
    for (const text of [title, seed]) {
        const utf8 = new TextEncoder().encode(text);
        bytes[at++] = utf8.length;
        bytes.set(utf8, at);
        at += utf8.length;
    }
    at += 8 + 16 + 4 + 16;
    view.setInt32(at, 1200, true); // height
    view.setInt32(at + 4, 4200, true); // width
    return bytes;
}
