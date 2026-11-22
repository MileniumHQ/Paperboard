// Reading a 3D file into a three.js object, safely: the file is untrusted.
//
// One fetch reads the file (with progress and an abort signal); each format's
// loader is its own dynamic import, so a GLB never pulls in the FBX parser.
// Everything a model refers to besides itself (glTF images and buffers, an
// OBJ's material file, an FBX's textures) goes through one LoadingManager
// whose URL modifier lets through data: and blob: URLs and URLs on the
// model's own origin, and nothing else: a file can't make the page reach
// another site. A texture that isn't allowed just isn't drawn; geometry that
// isn't allowed fails the model, since there would be nothing to show.
//
// Files are parsed, never run: no loader here evaluates code from a file.
import {
    Box3,
    BufferGeometry,
    DoubleSide,
    Group,
    Loader,
    LoadingManager,
    Mesh,
    MeshStandardMaterial,
    Points,
    PointsMaterial,
    TextureLoader,
    type AnimationClip,
    type Material,
    type Object3D,
    type SkinnedMesh,
    type Texture,
    type WebGLRenderer,
} from "three";
import type { PaperModelFormat } from "../../templates/PaperPreview/kinds";
import { MODEL_MESSAGES } from "./messages";

/** A failure the viewer shows as it is, and whether trying again could help. */
export class ModelError extends Error {
    constructor(
        message: string,
        readonly retryable: boolean,
    ) {
        super(message);
        this.name = "ModelError";
    }
}


/** A model ready to put on the stage. */
export interface LoadedModel {
    /** the model, turned so +Y is up */
    root: Object3D;
    animations: AnimationClip[];
    /** resolves once the textures it loads after it's parsed have arrived or failed */
    settled: Promise<void>;
    /** frees its geometry, materials and textures */
    dispose(): void;
}

export interface LoadOptions {
    /** the renderer that will draw it: compressed textures are transcoded for its GPU */
    renderer: WebGLRenderer;
    signal?: AbortSignal;
    /** how much of the file has arrived, 0..1, or null when its size isn't known */
    onProgress?: (fraction: number | null) => void;
    /** a texture arrived after the model was shown: draw again */
    onUpdate?: () => void;
}

// formats whose files are usually Z-up (CAD and 3D printing): turned to Y-up
const Z_UP: ReadonlySet<PaperModelFormat> = new Set(["stl", "3mf"]);

/** Reads the model at `src`. Rejects with a ModelError, or with the signal's reason once aborted. */
export async function loadModel(src: string, format: PaperModelFormat, options: LoadOptions): Promise<LoadedModel> {
    const { signal } = options;
    const bytes = await readSource(src, signal, options.onProgress);
    signal?.throwIfAborted();

    const context = createContext(src, options.onUpdate, signal);
    let parsed: Parsed;
    try {
        const parsing = PARSERS[format](bytes, context, options.renderer);
        // a reference that stalls (a texture's <img> can't be aborted) doesn't
        // hold an aborted load: it ends at once, and a model parsed after is freed
        parsing.then(
            (late) => signal?.aborted && disposeObject(late.root),
            () => {}, // quiet: a parse that fails after the abort is heard through the abort
        );
        parsed = await untilAborted(parsing, signal);
    } catch (err) {
        if (signal?.aborted) throw signal.reason;
        throw err instanceof ModelError ? err : new ModelError(MODEL_MESSAGES.unreadable, false);
    }

    neutralize(parsed.root, (material) => material.name === Loader.DEFAULT_MATERIAL_NAME);
    const oriented = new Group();
    oriented.add(parsed.root);
    if (Z_UP.has(format)) oriented.rotation.x = -Math.PI / 2;
    oriented.updateMatrixWorld(true);
    const model: LoadedModel = {
        root: oriented,
        animations: parsed.animations,
        settled: context.parsed(),
        dispose: () => disposeObject(oriented),
    };
    if (signal?.aborted) {
        model.dispose();
        throw signal.reason;
    }
    if (!hasSomethingToShow(oriented)) {
        model.dispose();
        throw new ModelError(MODEL_MESSAGES.empty, false);
    }
    prepare(oriented);
    return model;
}

// ── reading the file ────────────────────────────────────────────────────────

async function readSource(src: string, signal: AbortSignal | undefined, onProgress?: (fraction: number | null) => void): Promise<ArrayBuffer> {
    if (/^data:/i.test(src)) return decodeDataUrl(src);
    let response: Response;
    try {
        response = await fetch(src, { signal, credentials: "same-origin" });
    } catch (err) {
        if (signal?.aborted) throw signal.reason;
        throw new ModelError(MODEL_MESSAGES.unreachable, true);
    }
    if (!response.ok) throw new ModelError(response.status === 404 || response.status === 410 ? MODEL_MESSAGES.missing : MODEL_MESSAGES.unreachable, true);

    const total = Number(response.headers.get("content-length")) || 0;
    try {
        if (!total || !response.body || !onProgress) {
            onProgress?.(null);
            return await response.arrayBuffer();
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        onProgress(0);
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.byteLength;
            onProgress(Math.min(1, received / total));
        }
        const out = new Uint8Array(received);
        let at = 0;
        for (const chunk of chunks) {
            out.set(chunk, at);
            at += chunk.byteLength;
        }
        return out.buffer;
    } catch (err) {
        if (signal?.aborted) throw signal.reason;
        throw new ModelError(MODEL_MESSAGES.unreachable, true);
    }
}

/** The bytes of a data: URL, decoded here: a panel's policy doesn't let fetch() read one. */
function decodeDataUrl(url: string): ArrayBuffer {
    const comma = url.indexOf(",");
    if (comma < 0) throw new ModelError(MODEL_MESSAGES.unreadable, false);
    const meta = url.slice(5, comma);
    const body = url.slice(comma + 1);
    try {
        if (/;base64$/i.test(meta)) {
            const binary = atob(body);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return bytes.buffer;
        }
        return new TextEncoder().encode(decodeURIComponent(body)).buffer;
    } catch (err) {
        // malformed base64 or percent-encoding: an unreadable file
        throw new ModelError(MODEL_MESSAGES.unreadable, false);
    }
}

const text = (bytes: ArrayBuffer) => new TextDecoder().decode(bytes);

// ── what a model may refer to ───────────────────────────────────────────────

interface Context {
    manager: LoadingManager;
    /** the folder `src` is in, which relative references resolve against; "" when it has none (blob:, data:) */
    path: string;
    /** the URL a reference resolves to when it may be loaded, or null */
    allow(url: string): string | null;
    /** call once parsing is done: resolves when what the model loads afterwards has arrived */
    parsed(): Promise<void>;
}

/** `work`, or the signal's reason as soon as it aborts. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    if (!signal) return work;
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
}

function createContext(src: string, onUpdate: (() => void) | undefined, signal: AbortSignal | undefined): Context {
    let home: URL | null = null;
    try {
        const url = new URL(src, document.baseURI);
        // a blob: or data: model has no folder: only what it carries itself
        if (url.protocol !== "blob:" && url.protocol !== "data:") home = url;
    } catch (err) {
        // quiet: a src that isn't a URL has no folder, so it may refer to nothing outside it
    }

    const allow = (url: string): string | null => {
        if (/^(data|blob):/i.test(url)) return url;
        if (!home) return null;
        let resolved: URL;
        try {
            resolved = new URL(url, home);
        } catch (err) {
            // quiet: a reference that isn't a URL is refused like any other
            return null;
        }
        // protocol and host, not origin: a custom scheme's origin is "null" for every URL
        return resolved.protocol === home.protocol && resolved.host === home.host ? resolved.href : null;
    };

    const manager = new LoadingManager();
    manager.setURLModifier((url) => allow(url) ?? refusedUrl());

    // what the model loads after it's parsed (FBX, OBJ, Collada and USDZ
    // textures) arrives later: draw again as it does, and settle once it has
    let active = false;
    let done = false;
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => (settle = resolve));
    const check = () => {
        if (done && !active) settle();
    };
    manager.onStart = () => {
        active = true;
    };
    manager.onProgress = () => onUpdate?.();
    manager.onLoad = () => {
        active = false;
        onUpdate?.();
        check();
    };
    // an abort stops the references still loading, and settles what waits on them
    signal?.addEventListener(
        "abort",
        () => {
            manager.abort();
            settle();
        },
        { once: true },
    );

    const path = home ? new URL(".", home).href : "";
    return {
        manager,
        path,
        allow,
        parsed() {
            done = true;
            check();
            return settled;
        },
    };
}

// A URL that fails at once, on this machine: what a refused reference is
// pointed at, so the loader that asked hears "failed" and the network is
// never touched.
let refused: string | undefined;
function refusedUrl(): string {
    if (!refused) {
        refused = URL.createObjectURL(new Blob());
        URL.revokeObjectURL(refused);
    }
    return refused;
}

// ── formats ─────────────────────────────────────────────────────────────────

interface Parsed {
    root: Object3D;
    animations: AnimationClip[];
}

type Parser = (bytes: ArrayBuffer, context: Context, renderer: WebGLRenderer) => Promise<Parsed>;

/** A part of the viewer, imported when a model needs it; a chunk that won't load is the viewer failing, not the file. */
async function part<T>(load: () => Promise<T>): Promise<T> {
    try {
        return await load();
    } catch (err) {
        throw new ModelError(MODEL_MESSAGES.viewer, true);
    }
}

const PARSERS: Record<PaperModelFormat, Parser> = {
    glb: (bytes, context, renderer) => parseGltf(readGlb(bytes), context, renderer),
    gltf: (bytes, context, renderer) => parseGltf({ json: JSON.parse(text(bytes)) }, context, renderer),

    async obj(bytes, context) {
        const source = text(bytes);
        const { OBJLoader } = await part(() => import("three/examples/jsm/loaders/OBJLoader.js"));
        const loader = new OBJLoader(context.manager);
        const library = /^[ \t]*mtllib[ \t]+(.+?)[ \t]*$/m.exec(source)?.[1];
        const materials = library ? await loadMtl(library, context) : null;
        if (materials) loader.setMaterials(materials);
        const root = loader.parse(source);
        if (!materials) neutralize(root, () => true);
        return { root, animations: [] };
    },

    async stl(bytes) {
        const { STLLoader } = await part(() => import("three/examples/jsm/loaders/STLLoader.js"));
        const geometry = new STLLoader().parse(bytes);
        const colored = Boolean((geometry as BufferGeometry & { hasColors?: boolean }).hasColors);
        return { root: new Mesh(geometry, neutralMaterial(colored)), animations: [] };
    },

    async ply(bytes) {
        const { PLYLoader } = await part(() => import("three/examples/jsm/loaders/PLYLoader.js"));
        const geometry = new PLYLoader().parse(bytes);
        const colored = geometry.hasAttribute("color");
        // a scan without faces is a point cloud
        if (!geometry.index) {
            return { root: new Points(geometry, new PointsMaterial({ size: 0.01, vertexColors: colored, color: colored ? 0xffffff : NEUTRAL })), animations: [] };
        }
        if (!geometry.hasAttribute("normal")) geometry.computeVertexNormals();
        return { root: new Mesh(geometry, neutralMaterial(colored)), animations: [] };
    },

    async fbx(bytes, context) {
        const { FBXLoader } = await part(() => import("three/examples/jsm/loaders/FBXLoader.js"));
        const root = new FBXLoader(context.manager).parse(bytes, context.path);
        return { root, animations: root.animations };
    },

    async "3mf"(bytes, context) {
        const { ThreeMFLoader } = await part(() => import("three/examples/jsm/loaders/3MFLoader.js"));
        const root = new ThreeMFLoader(context.manager).parse(bytes);
        return { root, animations: [] };
    },

    async dae(bytes, context) {
        const { ColladaLoader } = await part(() => import("three/examples/jsm/loaders/ColladaLoader.js"));
        const collada = new ColladaLoader(context.manager).parse(text(bytes), context.path);
        // the parser logs and returns nothing for a file that isn't Collada
        if (!collada?.scene) throw new ModelError(MODEL_MESSAGES.unreadable, false);
        return { root: collada.scene, animations: collada.scene.animations ?? [] };
    },

    async usdz(bytes, context) {
        const { USDLoader } = await part(() => import("three/examples/jsm/loaders/USDLoader.js"));
        const root = new USDLoader(context.manager).parse(bytes, context.path);
        return { root, animations: root.animations ?? [] };
    },
};

async function loadMtl(library: string, context: Context) {
    const url = context.allow(library);
    if (!url) return null;
    const { MTLLoader } = await part(() => import("three/examples/jsm/loaders/MTLLoader.js"));
    const loader = new MTLLoader(context.manager);
    loader.setResourcePath(new URL(".", url).href);
    try {
        const materials = await loader.loadAsync(url);
        materials.preload();
        return materials;
    } catch (err) {
        // quiet: a material file that won't load leaves the model in the neutral material, as a missing texture leaves it untextured
        return null;
    }
}

// ── glTF ────────────────────────────────────────────────────────────────────

interface GltfJson {
    asset?: { version?: string };
    extensionsUsed?: string[];
    extensionsRequired?: string[];
    buffers?: { uri?: string; byteLength: number }[];
    images?: { uri?: string; bufferView?: number; mimeType?: string }[];
    textures?: { source?: number; extensions?: Record<string, { source?: number }> }[];
    materials?: Record<string, unknown>[];
}

interface GltfFile {
    json: GltfJson;
    /** a GLB's binary chunk: its first buffer */
    bin?: ArrayBuffer;
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_JSON = 0x4e4f534a;
const GLB_BIN = 0x004e4942;

/** A GLB's JSON and binary chunk, read here so the JSON can be checked before anything loads. */
function readGlb(bytes: ArrayBuffer): GltfFile {
    if (bytes.byteLength < 20) throw new ModelError(MODEL_MESSAGES.unreadable, false);
    const view = new DataView(bytes);
    if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) throw new ModelError(MODEL_MESSAGES.unreadable, false);
    const length = Math.min(view.getUint32(8, true), bytes.byteLength);
    let json: GltfJson | undefined;
    let bin: ArrayBuffer | undefined;
    for (let at = 12; at + 8 <= length; ) {
        const size = view.getUint32(at, true);
        const type = view.getUint32(at + 4, true);
        const start = at + 8;
        if (start + size > length) throw new ModelError(MODEL_MESSAGES.unreadable, false);
        if (type === GLB_JSON && !json) json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, start, size)));
        else if (type === GLB_BIN && !bin) bin = bytes.slice(start, start + size);
        at = start + size;
    }
    if (!json) throw new ModelError(MODEL_MESSAGES.unreadable, false);
    return { json, bin };
}

const DRACO = "KHR_draco_mesh_compression";
const MESHOPT = ["EXT_meshopt_compression", "KHR_meshopt_compression"];
const BASISU = "KHR_texture_basisu";

async function parseGltf(file: GltfFile, context: Context, renderer: WebGLRenderer): Promise<Parsed> {
    const { json } = file;
    if (!json || typeof json !== "object") throw new ModelError(MODEL_MESSAGES.unreadable, false);
    const used = new Set(json.extensionsUsed ?? []);

    // geometry on another site: nothing to show without it
    for (const buffer of json.buffers ?? []) {
        if (buffer.uri !== undefined && !context.allow(buffer.uri)) throw new ModelError(MODEL_MESSAGES.foreign, false);
    }
    // a picture on another site: the model shows without it
    dropTextures(json, (texture) => imagesOf(json, texture).some((image) => image?.uri !== undefined && !context.allow(image.uri)));

    const { GLTFLoader } = await part(() => import("three/examples/jsm/loaders/GLTFLoader.js"));
    const loader = new GLTFLoader(context.manager);
    const done: (() => void)[] = [];
    try {
        if (used.has(DRACO)) {
            const { DRACOLoader, DRACO_GLTF_CONFIG } = await part(() => import("three/examples/jsm/loaders/DRACOLoader.js"));
            // its own manager: the decoder's files are PaperUI's, not the model's
            const draco = new DRACOLoader(new LoadingManager());
            // the glTF build of the decoder where WebAssembly may run; a page
            // whose policy refuses it (a panel's) decodes in plain JavaScript,
            // set on the config itself: setDecoderConfig() warns on every call
            if (wasmAllowed()) draco.setDecoderPath(DRACO_GLTF_CONFIG);
            else (draco as unknown as { decoderConfig: { type?: string } }).decoderConfig.type = "js";
            loader.setDRACOLoader(draco);
            done.push(() => draco.dispose());
        }
        if (MESHOPT.some((name) => used.has(name))) {
            if (!wasmAllowed()) throw new ModelError(MODEL_MESSAGES.compression, false);
            const { MeshoptDecoder } = await part(() => import("three/examples/jsm/libs/meshopt_decoder.module.js"));
            try {
                await MeshoptDecoder.ready;
            } catch (err) {
                throw new ModelError(MODEL_MESSAGES.compression, false);
            }
            loader.setMeshoptDecoder(MeshoptDecoder);
        }
        if (used.has(BASISU)) {
            if (wasmAllowed()) {
                const { KTX2Loader } = await part(() => import("three/examples/jsm/loaders/KTX2Loader.js"));
                const ktx2 = new KTX2Loader(new LoadingManager()).detectSupport(renderer);
                loader.setKTX2Loader(ktx2);
                done.push(() => ktx2.dispose());
            } else {
                // the transcoder is WebAssembly only: textures with no other picture show as untextured
                dropTextures(json, (texture) => texture.source === undefined && Boolean(texture.extensions?.[BASISU]));
            }
        }

        loader.register((parser) => {
            const internals = parser as unknown as {
                json: GltfJson;
                textureLoader: TextureLoader;
                loadBuffer(index: number): Promise<ArrayBuffer>;
            };
            // pictures through an <img>: a panel's policy lets img load data:
            // and blob: URLs, but not fetch(), which ImageBitmapLoader uses
            internals.textureLoader = new TextureLoader(context.manager);
            // the GLB chunk read above, and data: buffers decoded here, for the same reason
            const loadBuffer = internals.loadBuffer.bind(parser);
            internals.loadBuffer = (index) => {
                const uri = internals.json.buffers?.[index]?.uri;
                if (uri === undefined && index === 0 && file.bin) return Promise.resolve(file.bin);
                if (uri !== undefined && /^data:/i.test(uri)) return Promise.resolve(decodeDataUrl(uri));
                return loadBuffer(index);
            };
            return { name: "PAPERUI_local_resources" };
        });

        const gltf = await loader.parseAsync(json as never, context.path);
        return { root: gltf.scene, animations: gltf.animations };
    } finally {
        for (const release of done) release();
    }
}

function imagesOf(json: GltfJson, texture: NonNullable<GltfJson["textures"]>[number]) {
    const sources = [texture.source, ...Object.values(texture.extensions ?? {}).map((ext) => ext?.source)];
    return sources.filter((s): s is number => typeof s === "number").map((s) => json.images?.[s]);
}

/** Takes the textures `drop` picks off every material, so they're never loaded. */
function dropTextures(json: GltfJson, drop: (texture: NonNullable<GltfJson["textures"]>[number]) => boolean) {
    const dropped = new Set<number>();
    (json.textures ?? []).forEach((texture, index) => {
        if (texture && drop(texture)) dropped.add(index);
    });
    if (!dropped.size) return;
    // a texture is used through a textureInfo, an object with an `index`,
    // under a key that ends in "Texture" (baseColorTexture, normalTexture,
    // and every extension's own: clearcoatTexture, sheenColorTexture...)
    const walk = (node: Record<string, unknown>) => {
        for (const key of Object.keys(node)) {
            const value = node[key];
            if (!value || typeof value !== "object") continue;
            const index = (value as { index?: unknown }).index;
            if (key.endsWith("Texture") && typeof index === "number" && dropped.has(index)) delete node[key];
            else walk(value as Record<string, unknown>);
        }
    };
    for (const material of json.materials ?? []) if (material) walk(material);
}

let wasm: boolean | undefined;
/** Whether this page may compile WebAssembly: a policy without 'wasm-unsafe-eval' refuses it. */
function wasmAllowed(): boolean {
    if (wasm === undefined) {
        try {
            // the smallest module: the magic number and version
            new WebAssembly.Module(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
            wasm = true;
        } catch (err) {
            // quiet: a refusal is the answer
            wasm = false;
        }
    }
    return wasm;
}

// ── after parsing ───────────────────────────────────────────────────────────

const NEUTRAL = 0xb4b4ba;

/** The material a model without its own wears: a soft, light gray, matte, seen from both sides. */
function neutralMaterial(vertexColors = false): MeshStandardMaterial {
    return new MeshStandardMaterial({
        color: vertexColors ? 0xffffff : NEUTRAL,
        vertexColors,
        roughness: 0.55,
        metalness: 0.05,
        side: DoubleSide,
    });
}

/**
 * Puts the neutral material on the meshes whose material `plain` picks: an
 * OBJ's without a material file, and the stand-in white a loader gives a
 * mesh its file leaves uncolored.
 */
function neutralize(root: Object3D, plain: (material: Material) => boolean) {
    root.traverse((object) => {
        const mesh = object as Mesh;
        if (!mesh.isMesh || Array.isArray(mesh.material) || !plain(mesh.material)) return;
        mesh.material.dispose();
        mesh.material = neutralMaterial(mesh.geometry.hasAttribute("color"));
    });
}

type Drawable = Mesh & { isPoints?: boolean; isLine?: boolean };

function hasSomethingToShow(root: Object3D): boolean {
    let found = false;
    root.traverse((object) => {
        const geometry = (object as Drawable).geometry as BufferGeometry | undefined;
        if (geometry?.isBufferGeometry && (geometry.getAttribute("position")?.count ?? 0) > 0) found = true;
    });
    if (!found) return false;
    const box = new Box3().setFromObject(root);
    return !box.isEmpty() && [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(Number.isFinite);
}

// shading the loader left out
function prepare(root: Object3D) {
    root.traverse((object) => {
        const mesh = object as Mesh;
        if (!mesh.isMesh) return;
        const geometry = mesh.geometry;
        if (!geometry.hasAttribute("normal") && geometry.hasAttribute("position")) geometry.computeVertexNormals();
    });
}

/** Frees everything `root` holds on the GPU: geometry, materials, their textures, skeletons. */
export function disposeObject(root: Object3D) {
    const materials = new Set<Material>();
    const textures = new Set<Texture>();
    root.traverse((object) => {
        const mesh = object as Mesh;
        mesh.geometry?.dispose();
        if (mesh.material) for (const material of [mesh.material].flat()) materials.add(material);
        (object as SkinnedMesh).skeleton?.dispose();
    });
    for (const material of materials) {
        for (const value of Object.values(material)) {
            if ((value as Texture | null)?.isTexture) textures.add(value as Texture);
        }
        material.dispose();
    }
    for (const texture of textures) {
        const data = texture.source?.data;
        texture.dispose();
        if (typeof ImageBitmap !== "undefined" && data instanceof ImageBitmap) data.close();
    }
}
