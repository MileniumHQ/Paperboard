import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { layoutModels, separatedModels } from './model-layout.mjs';

const REST_POS = [0.5, 3.4, 15];
const REST_LOOK = [0.5, 0.5, 0];
const FOV = 38;
const CAM_DIST = REST_POS[2];

const canvas = document.getElementById('aio-stage');

const DEVICES = [
    { id: 'laptop', file: 'models/laptop.glb' },
    { id: 'mini-pc', file: 'models/mini-pc.glb' },
    { id: 'dev-board', file: 'models/dev-board.glb' },
    { id: 'battlestation', file: 'models/battlestation.glb' },
];

// Keep every device in a compact group; fit the measured footprints instead
// of removing machines at progressively wider aspect-ratio breakpoints.
const TIERS = [
    {
        minHalfW: 3.5, mode: 'h',
        slots: {
            imac: { x: -3.5, y: 0, scale: 0.36, rot: 0.7 },
            laptop: { x: -1.5, y: 0, scale: 0.4, rot: 0.7 },
            'mini-pc': { x: 0.1, y: 0, scale: 0.28, rot: 0.7 },
            'dev-board': { x: 1.2, y: 0, scale: 0.24, rot: 0.7 },
            battlestation: { x: 4.0, y: 0, scale: 0.36, rot: -0.75 },
        },
        dash: { from: 'dev-board', to: 'battlestation' },
    },
    {
        minHalfW: 0, mode: 'v',
        slots: {
            imac: { x: -0.6, y: 1.3, scale: 0.22, rot: 0.3 },
            laptop: { x: 0.9, y: 1.6, scale: 0.26, rot: -0.3 },
            'mini-pc': { x: -0.5, y: 0.2, scale: 0.22, rot: 0.5 },
            'dev-board': { x: 0.8, y: 0.3, scale: 0.22, rot: -0.4 },
            battlestation: { x: 0.4, y: -1.2, scale: 0.3, rot: -0.5 },
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
            if (src !== currentScreen) { texture.dispose(); return; }
            texture.colorSpace = THREE.SRGBColorSpace;
            const flippedTexture = texture.clone();
            flippedTexture.colorSpace = THREE.SRGBColorSpace;
            flippedTexture.wrapT = THREE.RepeatWrapping;
            flippedTexture.repeat.y = -1;
            flippedTexture.offset.y = 1;
            flippedTexture.needsUpdate = true;
            const previous = currentFaces;
            currentFaces = { normal: texture, flipped: flippedTexture };
            for (const target of screenTargets) applyFace(target);
            api.screenVersion++;
            previous?.normal.dispose();
            previous?.flipped.dispose();
        });
    }

    // companions start invisible, flight fades them in
    const companions = [];
    // group footprint per unit of its scale, for the data-run endpoint
    const groupBox = new THREE.Box3().setFromObject(group);
    groupBox.min.sub(group.position).divideScalar(group.scale.x);
    groupBox.max.sub(group.position).divideScalar(group.scale.x);
    let layoutDirty = true;
    const api = {
        THREE, scene, camera, renderer, group, companions, ground,
        REST_POS, REST_LOOK,
        home: { x: -5.5, y: 0, scale: 0.4, rot: 0.9 },
        dash: { enabled: false, p0: [0, 0, 0], p1: [0, 0, 0] },
        groupHover: 0,
        hoverTurn: HOVER_TURN,
        renders: 0,
        layoutVersion: 0,
        screenVersion: 0,
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
            box.min.sub(obj.position);
            box.max.sub(obj.position);
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
                box,
            };
            companions.push(entry);
            const hover = registerHoverable(obj, spec.id, entry);
            entry.hoverEntry = hover;
            layoutDirty = true;
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
        const tier = activeTier(halfW);

        const enabled = new Set(Object.keys(tier.slots));
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

        // Pack bounds that include depth and every hover rotation. Models with
        // off-centre origins still get enough space beside their neighbours.
        const entries = [{ box: groupBox, scale: api.home.scale },
            ...companions.filter(entry => entry.enabled).map(entry => ({ entry, box: entry.box, scale: entry.obj.scale.x }))];
        const placements = layoutModels(entries.map(item => ({
            ...item,
            radius: Math.hypot(Math.max(Math.abs(item.box.min.x), Math.abs(item.box.max.x)), Math.max(Math.abs(item.box.min.z), Math.abs(item.box.max.z))),
            minY: item.box.min.y,
            height: item.box.max.y - item.box.min.y,
        })), { stacked: tier.mode === 'v', halfWidth: halfW, halfHeight: halfW / aspect });
        for (const item of placements) {
            if (!item.entry) Object.assign(api.home, { x: item.x, y: item.y, scale: item.scale });
            else {
                item.entry.obj.position.x = item.x;
                item.entry.obj.position.y = item.y;
                item.entry.obj.scale.setScalar(item.scale);
            }
        }
        api.companionsClear = () => placements.slice(1).every(item => separatedModels(
            { ...placements[0], x: group.position.x, y: group.position.y, scale: group.scale.x },
            { ...item, x: item.entry.obj.position.x, y: item.entry.obj.position.y, scale: item.entry.obj.scale.x },
        ));
        api.layoutVersion++;

        // The run is resolved in screen space by flight from the real objects:
        // a world-space edge can still project inside a yawed model, so passing
        // the objects is the only way to guarantee the line bridges them.
        const dash = { enabled: false, mode: tier.mode, from: null, to: null };
        if (enabled.has('battlestation') && tier.dash) {
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
            if (Math.abs(entry.target - entry.hover) < 0.001) entry.hover = entry.target;
            if (entry === groupHoverEntry) {
                api.groupHover = entry.hover;
            } else if (entry.root) {
                entry.root.rotation.y = entry.baseRotY * (1 - HOVER_TURN * entry.hover);
            }
        }
    }

    let lastFrame = -Infinity;
    let lastRenderedState = '';
    function frame(time) {
        const w = canvas.clientWidth || 1;
        const h = canvas.clientHeight || 1;
        if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) ||
            canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
            renderer.setSize(w, h, false);
            layoutDirty = true;
        }
        camera.aspect = w / h;
        if (layoutDirty) { applyLayout(); layoutDirty = false; }

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
        // The canvas is fully transparent outside the showcase/stage. Keep
        // layout available to flight, but skip GPU work there and in hidden tabs.
        const renderState = [w, h, api.layoutVersion, api.screenVersion,
            ...camera.position.toArray(), ...camera.quaternion.toArray(),
            ...group.position.toArray(), group.rotation.y, group.scale.x,
            ...companions.flatMap(entry => [entry.obj.visible, entry.obj.rotation.y, entry.mats[0]?.opacity])].join(',');
        if (!document.hidden && s > 1 && s < 2.8 && renderState !== lastRenderedState && time - lastFrame >= 1000 / 30) {
            renderer.render(scene, camera);
            lastFrame = time;
            lastRenderedState = renderState;
            api.renders++;
        }
    }

    renderer.setAnimationLoop(frame);
    window.addEventListener('pagehide', () => {
        renderer.setAnimationLoop(null);
        renderer.dispose();
    }, { once: true });
}
