import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const REST_POS = [0.5, 3.4, 15];
const REST_LOOK = [0.5, 0.5, 0];
const FOV = 38;
const CAM_DIST = REST_POS[2];
const SHORT_HEIGHT = 620;

const canvas = document.getElementById('aio-stage');

const DEVICES = [
    { id: 'laptop', file: 'models/laptop.glb' },
    { id: 'mini-pc', file: 'models/mini-pc.glb' },
    { id: 'dev-board', file: 'models/dev-board.glb' },
    { id: 'battlestation', file: 'models/battlestation.glb' },
];

// Stage layouts, widest first. Positions are fixed world coordinates, so the
// gaps between machines never shrink as the window narrows — a fixed-FOV camera
// means only the aspect (not the pixel width) decides how much room there is,
// so the breakpoints are visible half-widths and the responsive step is to
// drop a machine, never to squeeze the lineup. Narrowing drops the dev-board,
// then the mini-pc, then the laptop; below that the imac sits on top and the
// battlestation below it, joined by a short vertical data run.
const TIERS = [
    {
        minHalfW: 9.0,
        mode: 'h',
        slots: {
            imac: { x: -6.2, y: 0, scale: 0.4, rot: 0.9 },
            laptop: { x: -3.2, y: 0, scale: 0.5, rot: 0.9 },
            'mini-pc': { x: -1.3, y: 0, scale: 0.32, rot: 0.9 },
            'dev-board': { x: 0.1, y: 0, scale: 0.25, rot: 0.9 },
            battlestation: { x: 7.4, y: 0, scale: 0.42, rot: -0.95 },
        },
        dash: { from: 'dev-board', to: 'battlestation' },
    },
    {
        minHalfW: 7.8,
        mode: 'h',
        slots: {
            imac: { x: -5.0, y: 0, scale: 0.4, rot: 0.9 },
            laptop: { x: -2.0, y: 0, scale: 0.5, rot: 0.9 },
            'mini-pc': { x: -0.4, y: 0, scale: 0.32, rot: 0.9 },
            battlestation: { x: 6.2, y: 0, scale: 0.42, rot: -0.95 },
        },
        dash: { from: 'mini-pc', to: 'battlestation' },
    },
    {
        minHalfW: 6.9,
        mode: 'h',
        slots: {
            imac: { x: -4.2, y: 0, scale: 0.4, rot: 0.9 },
            laptop: { x: -1.4, y: 0, scale: 0.5, rot: 0.9 },
            battlestation: { x: 5.2, y: 0, scale: 0.42, rot: -0.95 },
        },
        dash: { from: 'laptop', to: 'battlestation' },
    },
    {
        minHalfW: 4.9,
        mode: 'h',
        slots: {
            imac: { x: -2.8, y: 0, scale: 0.4, rot: 0.9 },
            battlestation: { x: 3.4, y: 0, scale: 0.42, rot: -0.95 },
        },
        dash: { from: 'imac', to: 'battlestation' },
    },
    {
        minHalfW: 0,
        mode: 'v',
        slots: {
            imac: { x: 0.5, y: 1.6, scale: 0.28, rot: 0 },
            battlestation: { x: 0.5, y: -1.2, z: 0.2, scale: 0.36, rot: -0.5 },
        },
        dash: { from: 'imac', to: 'battlestation' },
    },
];

// 1 = no turn on hover, lower = turn further toward the viewer.
const HOVER_TURN = 0.35;
const HOVER_LERP = 0.14;

if (canvas && typeof window.createAllInOne === 'function') {
    init();
}

function init() {
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
        return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    camera.position.set(REST_POS[0], REST_POS[1], REST_POS[2]);

    const group = window.createAllInOne(THREE, { screenUrl: 'screens/gameserver.png' });
    group.scale.setScalar(0.4);
    group.position.x = -5.5;
    scene.add(group);

    scene.add(new THREE.HemisphereLight(0xdcecff, 0x0a2a55, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(5, 8, 6);
    sun.castShadow = true;
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -14;
    scene.add(sun);

    const ground = new THREE.Mesh(
        new THREE.CircleGeometry(9, 24),
        new THREE.ShadowMaterial({ opacity: 0.22 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.002;
    ground.receiveShadow = true;
    scene.add(ground);

    group.traverse((o) => {
        if (o.isMesh) o.castShadow = true;
    });

    // Screens mirror the carousel: any mesh or material named for a display
    // gets the active slide texture. GLB screens are UV'd upside down relative
    // to the all-in-one, so their texture is flipped vertically.
    const screenTargets = [];
    let currentFaces = null;

    function applyFace(target) {
        if (!currentFaces) return;
        const face = target.flipped ? currentFaces.flipped : currentFaces.normal;
        if ("map" in target.mat) target.mat.map = face;
        if ("emissiveMap" in target.mat) target.mat.emissiveMap = face;
        target.mat.needsUpdate = true;
    }

    function registerScreens(root, flipped) {
        root.traverse((o) => {
            if (!o.isMesh) return;
            const meshName = (o.name || "").toLowerCase();
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
                if (!m) continue;
                const matName = (m.name || "").toLowerCase();
                if (
                    /screen|display|monitor/.test(meshName) ||
                    /screen|display|monitor/.test(matName)
                ) {
                    if (!screenTargets.some((target) => target.mat === m)) {
                        const target = { mat: m, flipped };
                        screenTargets.push(target);
                        // A companion can finish loading after a slide has
                        // already changed; give it the current face right away
                        // instead of leaving its baked texture on screen.
                        applyFace(target);
                    }
                }
            }
        });
    }
    registerScreens(group, false);

    let currentScreen = null;
    const textureLoader = new THREE.TextureLoader();
    function setScreen(src) {
        if (!src || src === currentScreen) return;
        currentScreen = src;
        textureLoader.load(src, (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            const flippedTexture = texture.clone();
            flippedTexture.colorSpace = THREE.SRGBColorSpace;
            flippedTexture.wrapT = THREE.RepeatWrapping;
            flippedTexture.repeat.y = -1;
            flippedTexture.offset.y = 1;
            flippedTexture.needsUpdate = true;
            currentFaces = { normal: texture, flipped: flippedTexture };
            for (const target of screenTargets) applyFace(target);
        });
    }

    // companions start invisible, flight fades them in
    const companions = [];
    // group footprint per unit of its scale, for the data-run endpoint
    const groupBase = new THREE.Box3().setFromObject(group)
        .getSize(new THREE.Vector3())
        .divideScalar(group.scale.x);
    const api = {
        THREE, scene, camera, renderer, group, companions, ground,
        REST_POS, REST_LOOK,
        home: { x: -5.5, y: 0, scale: 0.4, rot: 0.9 },
        dash: { enabled: false, p0: [0, 0, 0], p1: [0, 0, 0] },
        groupHover: 0,
        hoverTurn: HOVER_TURN,
    };
    window.__aioStage = api;

    api.setScreen = setScreen;
    api.screenTargets = screenTargets;
    document.addEventListener("paperboard:slide", (event) => {
        if (event.detail && event.detail.src) setScreen(event.detail.src);
    });
    const initialSlide = document.querySelector(".card-slide-image");
    if (initialSlide) setScreen(initialSlide.getAttribute("src"));

    // Hover: a pointer move queues one raycast; the render loop eases the
    // hit machine toward the camera and lets the rest fall back.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2(-10, -10);
    let pointerInside = false;
    let pointerDirty = false;
    const hoverables = [];

    function registerHoverable(root, id, companion) {
        const entry = { root, id, companion, meshes: [], baseRotY: root.rotation.y, hover: 0, target: 0 };
        root.traverse((o) => {
            if (o.isMesh) {
                o.userData.hoverEntry = entry;
                entry.meshes.push(o);
            }
        });
        hoverables.push(entry);
        return entry;
    }

    window.addEventListener('pointermove', (e) => {
        pointer.x = (e.clientX / (window.innerWidth || 1)) * 2 - 1;
        pointer.y = -(e.clientY / (window.innerHeight || 1)) * 2 + 1;
        pointerInside = true;
        pointerDirty = true;
    }, { passive: true });
    window.addEventListener('pointerleave', () => {
        pointerInside = false;
        pointerDirty = true;
    });

    const groupHoverEntry = registerHoverable(group, 'imac', null);

    const loader = new GLTFLoader();
    DEVICES.forEach((spec) => {
        loader.load(spec.file, (root) => {
            const obj = root.scene || root;
            registerScreens(obj, true);
            obj.position.set(0, 0, 0.3);
            const mats = new Set();
            const box = new THREE.Box3().setFromObject(obj);
            obj.traverse((o) => {
                if (o.isMesh) {
                    if (!o.material.transparent) o.castShadow = true;
                    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
                        if (m.userData.baseOpacity === undefined) {
                            m.userData.baseOpacity = m.opacity;
                        }
                        m.transparent = true;
                        m.opacity = 0;
                        mats.add(m);
                    });
                }
            });
            obj.visible = false;
            scene.add(obj);
            const entry = {
                id: spec.id, obj, mats: [...mats], enabled: false,
                baseRotY: 0, size: box.getSize(new THREE.Vector3()),
            };
            companions.push(entry);
            const hover = registerHoverable(obj, spec.id, entry);
            entry.hoverEntry = hover;
        });
    });

    function activeTier(halfW) {
        for (const tier of TIERS) {
            if (halfW >= tier.minHalfW) return tier;
        }
        return TIERS[TIERS.length - 1];
    }

    function applyLayout() {
        const aspect = (canvas.clientWidth || 1) / (canvas.clientHeight || 1);
        const halfW = Math.tan((FOV * Math.PI) / 360) * CAM_DIST * aspect;
        const short = (window.innerHeight || 1) < SHORT_HEIGHT;
        const tier = activeTier(halfW);

        const enabled = new Set(Object.keys(tier.slots));
        if (short) enabled.delete('battlestation');
        // a stacked layout floats the machines, so the floor shadow would lie
        ground.visible = tier.mode !== 'v';

        const imacSlot = tier.slots.imac;
        api.home = {
            x: imacSlot.x, y: imacSlot.y,
            scale: imacSlot.scale, rot: imacSlot.rot,
        };

        for (const entry of companions) {
            const slot = tier.slots[entry.id];
            const on = !!slot && enabled.has(entry.id);
            entry.enabled = on;
            if (!on) {
                entry.obj.visible = false;
                continue;
            }
            if (tier.mode === 'v') {
                entry.obj.position.set(slot.x, slot.y, slot.z ?? 0.2);
            } else {
                entry.obj.position.set(slot.x, slot.y, 0.3);
            }
            entry.obj.scale.setScalar(slot.scale);
            entry.baseRotY = slot.rot;
            entry.obj.rotation.y = slot.rot;
            if (entry.hoverEntry) entry.hoverEntry.baseRotY = slot.rot;
        }

        // Short viewports drop the battlestation, which leaves the machines
        // huddled in the left third of a very wide frame; recentre what is left.
        if (short && tier.mode === 'h') {
            const halfImac = (groupBase.x * api.home.scale) / 2;
            let min = api.home.x - halfImac;
            let max = api.home.x + halfImac;
            for (const entry of companions) {
                if (!entry.enabled) continue;
                const half = (entry.size.x * entry.obj.scale.x) / 2;
                min = Math.min(min, entry.obj.position.x - half);
                max = Math.max(max, entry.obj.position.x + half);
            }
            const shift = REST_LOOK[0] - (min + max) / 2;
            api.home = { ...api.home, x: api.home.x + shift };
            for (const entry of companions) {
                if (entry.enabled) entry.obj.position.x += shift;
            }
        }

        // In the stacked layout, centre the pc under the aio so the data run
        // can be a straight vertical.
        if (tier.mode === 'v') {
            const bat = companions.find(
                (entry) => entry.id === 'battlestation' && entry.enabled,
            );
            if (bat) {
                const box = new THREE.Box3().setFromObject(bat.obj);
                const centreX = (box.min.x + box.max.x) / 2;
                bat.obj.position.x += api.home.x - centreX;
            }
        }

        // The run is resolved in screen space by flight from the real objects:
        // a world-space edge can still project inside a yawed model, so passing
        // the objects is the only way to guarantee the line bridges them.
        const dash = { enabled: false, mode: tier.mode, from: null, to: null };
        if (!short && enabled.has('battlestation') && tier.dash) {
            const from =
                tier.dash.from === 'imac'
                    ? group
                    : companions.find(
                          (entry) => entry.id === tier.dash.from && entry.enabled,
                      )?.obj;
            const to = companions.find(
                (entry) => entry.id === tier.dash.to && entry.enabled,
            )?.obj;
            if (from && to) {
                dash.enabled = true;
                dash.from = from;
                dash.to = to;
            }
        }
        api.dash = dash;
    }

    function updateHover() {
        if (pointerDirty) {
            pointerDirty = false;
            for (const entry of hoverables) entry.target = 0;
            if (pointerInside) {
                const meshes = [];
                for (const entry of hoverables) {
                    const on = entry.companion ? entry.companion.enabled && entry.companion.obj.visible : true;
                    if (!on) continue;
                    for (const m of entry.meshes) meshes.push(m);
                }
                if (meshes.length) {
                    raycaster.setFromCamera(pointer, camera);
                    const hits = raycaster.intersectObjects(meshes, false);
                    if (hits.length) hits[0].object.userData.hoverEntry.target = 1;
                }
            }
        }
        for (const entry of hoverables) {
            entry.hover += (entry.target - entry.hover) * HOVER_LERP;
            if (entry === groupHoverEntry) {
                api.groupHover = entry.hover;
            } else if (entry.root) {
                entry.root.rotation.y = entry.baseRotY * (1 - HOVER_TURN * entry.hover);
            }
        }
    }

    function frame() {
        const w = canvas.clientWidth || 1;
        const h = canvas.clientHeight || 1;
        if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) ||
            canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
            renderer.setSize(w, h, false);
        }
        camera.aspect = w / h;
        applyLayout();

        // flight owns the group past the handoff, resting state only above it
        const s = (window.scrollY || 0) / (window.innerHeight || 1);
        if (s < 0.9) {
            group.scale.setScalar(api.home.scale);
            group.position.set(api.home.x, api.home.y, 0);
            group.rotation.y = 0;
            camera.lookAt(REST_LOOK[0], REST_LOOK[1], REST_LOOK[2]);
        }
        updateHover();
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
    }

    renderer.setAnimationLoop(frame);
}
