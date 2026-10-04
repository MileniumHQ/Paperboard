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

// Model identity sets proportions, while the measured bounds choose the rows.
const MODEL_STYLE = {
    imac: { scale: 0.36, rot: 0.7 },
    laptop: { scale: 0.4, rot: 0.7 },
    'mini-pc': { scale: 0.28, rot: 0.7 },
    'dev-board': { scale: 0.24, rot: 0.7 },
    battlestation: { scale: 0.36, rot: -0.75 },
};

// 1 = no turn on hover, lower = turn further toward the viewer.
const HOVER_TURN = 0.35;
const HOVER_LERP = 0.14;

// Load the renderer only as the visitor approaches the showcase. The opening
// screen needs neither Three.js nor model downloads, including on mobile.
let THREE, GLTFLoader;
let loading = false;
let stageObserver;
let pageClosed = false;
function stageUnavailable(error) {
    if (pageClosed) return;
    canvas.dataset.stageState = 'unavailable';
    console.error('Device preview unavailable', error);
    if (!document.querySelector('.stage-unavailable')) {
        const notice = document.createElement('div');
        notice.className = 'stage-unavailable';
        notice.setAttribute('role', 'status');
        notice.append('Device preview unavailable. ');
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = 'Retry preview';
        // Reload resets failed native-module imports as well as WebGL state.
        retry.addEventListener('click', () => location.reload());
        notice.append(retry);
        // The canvas lives in an aria-hidden decorative layer. Recovery is an
        // interactive UI outcome, so it belongs outside that layer.
        document.body.append(notice);
    }
    window.dispatchEvent(new Event('paperboard:stage-change'));
}
async function loadStage() {
    if (loading || pageClosed) return;
    loading = true;
    try {
        [THREE, { GLTFLoader }] = await Promise.all([
            import('three'), import('three/addons/loaders/GLTFLoader.js'),
        ]);
        if (pageClosed) return;
        init();
        stageObserver?.disconnect();
        canvas.dataset.stageState = 'ready';
        document.querySelector('.stage-unavailable')?.remove();
    } catch (error) {
        loading = false;
        stageObserver?.disconnect();
        stageUnavailable(error);
    }
}
if (canvas && typeof window.createAllInOne === 'function') {
    stageObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting && entry.intersectionRatio > 0)) loadStage();
    }, { rootMargin: '35% 0px' });
    stageObserver.observe(document.querySelector('.showcase-content') || canvas);
    window.addEventListener('pagehide', () => {
        pageClosed = true;
        stageObserver.disconnect();
    }, { once: true });
}

function init() {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    let frameId = 0;
    let disposed = false;
    function wake() {
        if (!disposed && !document.hidden && !frameId) frameId = requestAnimationFrame(frame);
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    camera.position.set(REST_POS[0], REST_POS[1], REST_POS[2]);

    const group = window.createAllInOne(THREE);
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
            if (disposed || src !== currentScreen) { texture.dispose(); return; }
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
            wake();
        }, undefined, error => { if (!disposed && src === currentScreen) stageUnavailable(error); });
    }

    // companions start invisible, flight fades them in
    const companions = [];
    // group footprint per unit of its scale, for the data-run endpoint
    const groupBox = new THREE.Box3().setFromObject(group);
    groupBox.min.sub(group.position).divideScalar(group.scale.x);
    groupBox.max.sub(group.position).divideScalar(group.scale.x);
    let layoutDirty = true;
    const stageCopy = document.querySelector('.stage-copy');
    const stageSection = document.querySelector('.stage-section');
    const topbar = document.querySelector('.site-topbar__bar');
    const layoutObserver = new ResizeObserver(() => { layoutDirty = true; wake(); });
    if (stageCopy) layoutObserver.observe(stageCopy);
    if (topbar) layoutObserver.observe(topbar);
    const api = {
        THREE, scene, camera, renderer, group, companions, ground,
        REST_POS, REST_LOOK,
        home: { x: -5.5, y: 0, scale: 0.4, rot: 0.9 },
        dash: { enabled: false, p0: [0, 0, 0], p1: [0, 0, 0] },
        groupHover: 0,
        hoverTurn: HOVER_TURN,
        renders: 0,
        frames: 0,
        invalidate: wake,
        layoutVersion: 0,
        screenVersion: 0,
    };
    window.__aioStage = api;
    api.applyHomePose = () => {
        group.scale.setScalar(api.home.scale);
        group.position.set(api.home.x, api.home.y, 0);
        group.rotation.y = api.home.rot * (1 - HOVER_TURN * api.groupHover);
    };

    api.setScreen = setScreen;
    api.screenTargets = screenTargets;
    function onSlide(event) {
        if (event.detail && event.detail.src) setScreen(event.detail.src);
    }
    document.addEventListener("paperboard:slide", onSlide);
    const activeIndex = [...document.querySelectorAll('.dots-bar .dot')].findIndex(dot => dot.classList.contains('active'));
    const initialSlide = document.querySelectorAll('.card-slide-image')[Math.max(0, activeIndex)];
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

    function onPointerMove(e) {
        const s = window.scrollY / (window.innerHeight || 1);
        if (s <= 1 || s >= 2.8) return;
        pointer.x = (e.clientX / (window.innerWidth || 1)) * 2 - 1;
        pointer.y = -(e.clientY / (window.innerHeight || 1)) * 2 + 1;
        pointerInside = true;
        pointerDirty = true;
        wake();
    }
    function onPointerLeave() {
        pointerInside = false;
        pointerDirty = true;
        wake();
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave);

    const groupHoverEntry = registerHoverable(group, 'imac', null);

    const loader = new GLTFLoader();
    function disposeTree(root) {
        const geometries = new Set();
        const materials = new Set();
        const textures = new Set();
        root.traverse(obj => {
            if (!obj.isMesh) return;
            geometries.add(obj.geometry);
            for (const material of Array.isArray(obj.material) ? obj.material : [obj.material]) {
                materials.add(material);
                for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
            }
        });
        for (const texture of textures) texture.dispose();
        for (const material of materials) material.dispose();
        for (const geometry of geometries) geometry.dispose();
    }
    DEVICES.forEach((spec) => {
        loader.load(spec.file, (root) => {
            const obj = root.scene || root;
            if (disposed) { disposeTree(obj); return; }
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
            wake();
        }, undefined, error => { if (!disposed) stageUnavailable(error); });
    });

    function applyLayout() {
        const aspect = (canvas.clientWidth || 1) / (canvas.clientHeight || 1);
        const halfW = Math.tan((FOV * Math.PI) / 360) * CAM_DIST * aspect;
        const height = canvas.clientHeight || 1;
        const top = (topbar?.getBoundingClientRect().bottom || 0) + 24;
        const bottom = height - (stageCopy?.offsetHeight || 0)
            - (stageSection ? parseFloat(getComputedStyle(stageSection).paddingBottom) || 0 : 0) - 24;
        const usableHeight = Math.max(64, bottom - top);
        const halfH = halfW / aspect;
        const centerY = REST_LOOK[1] + (height / 2 - (top + bottom) / 2) * (2 * halfH / height);
        api.home = { x: 0, y: 0, ...MODEL_STYLE.imac };
        // A stable order keeps the composition unchanged by model download order.
        const ordered = DEVICES.map(spec => companions.find(entry => entry.id === spec.id)).filter(Boolean);
        for (const entry of ordered) {
            const style = MODEL_STYLE[entry.id];
            entry.enabled = true;
            // Flight restores visibility after adopting this layout. Never
            // render new neighbour positions beside the previous home pose.
            entry.obj.visible = false;
            entry.obj.position.set(0, 0, 0.3);
            entry.obj.scale.setScalar(style.scale);
            entry.baseRotY = style.rot;
            entry.obj.rotation.y = style.rot;
            entry.hoverEntry.baseRotY = style.rot;
        }

        // Pack bounds that include depth and every hover rotation. Models with
        // off-centre origins still get enough space beside their neighbours.
        const entries = [{ id: 'imac', box: groupBox, scale: api.home.scale },
            ...ordered.map(entry => ({ id: entry.id, entry, box: entry.box, scale: entry.obj.scale.x }))];
        const placements = layoutModels(entries.map(item => ({
            ...item,
            radius: Math.hypot(Math.max(Math.abs(item.box.min.x), Math.abs(item.box.max.x)), Math.max(Math.abs(item.box.min.z), Math.abs(item.box.max.z))),
            minY: item.box.min.y,
            height: item.box.max.y - item.box.min.y,
        })), { halfWidth: halfW, halfHeight: halfH * usableHeight / height, centerY });
        api.layoutRows = 1 + Math.max(...placements.map(item => item.row));
        ground.visible = api.layoutRows === 1;
        ground.position.y = Math.min(...placements.map(item => item.y + item.minY * item.scale)) - 0.002;
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

        // Flight connects the entire left cluster to the right-hand station
        // using projected bounds, including the models' live hover turns.
        const to = ordered.find(entry => entry.id === 'battlestation');
        const dash = { enabled: Boolean(to),
            from: [group, ...ordered.filter(entry => entry !== to).map(entry => entry.obj)],
            to: to?.obj };
        api.dash = dash;
    }

    function updateHover() {
        let changed = false;
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
            const previous = entry.hover;
            entry.hover += (entry.target - entry.hover) * HOVER_LERP;
            if (Math.abs(entry.target - entry.hover) < 0.001) entry.hover = entry.target;
            changed ||= entry.hover !== previous;
            if (entry === groupHoverEntry) {
                api.groupHover = entry.hover;
            } else if (entry.root) {
                entry.root.rotation.y = entry.baseRotY * (1 - HOVER_TURN * entry.hover);
            }
        }
        return changed;
    }

    let lastFrame = -Infinity;
    let lastRenderedState = '';
    function frame(time) {
        frameId = 0;
        api.frames++;
        const w = canvas.clientWidth || 1;
        const h = canvas.clientHeight || 1;
        if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) ||
            canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
            renderer.setSize(w, h, false);
            layoutDirty = true;
        }
        camera.aspect = w / h;
        let changed = layoutDirty;
        if (layoutDirty) { applyLayout(); layoutDirty = false; }

        // flight owns the group past the handoff, resting state only above it
        const s = (window.scrollY || 0) / (window.innerHeight || 1);
        if (s >= 2) api.applyHomePose();
        if (s < 0.9) {
            group.scale.setScalar(api.home.scale);
            group.position.set(api.home.x, api.home.y, 0);
            group.rotation.y = 0;
            camera.lookAt(REST_LOOK[0], REST_LOOK[1], REST_LOOK[2]);
        }
        changed = updateHover() || changed;
        if (changed) window.dispatchEvent(new Event('paperboard:stage-change'));
        camera.updateProjectionMatrix();
        // The canvas is fully transparent outside the showcase/stage. Keep
        // layout available to flight, but skip GPU work there and in hidden tabs.
        const renderState = [w, h, api.layoutVersion, api.screenVersion,
            ...camera.position.toArray(), ...camera.quaternion.toArray(),
            ...group.position.toArray(), group.rotation.y, group.scale.x,
            ...companions.flatMap(entry => [entry.obj.visible, entry.obj.rotation.y, entry.mats[0]?.opacity])].join(',');
        if (!document.hidden && s > 1 && s < 2.8 && renderState !== lastRenderedState) {
            if (time - lastFrame >= 1000 / 30) {
                // Packed multi-row layouts have no floor. Skip its entire
                // shadow pass too, rather than rendering invisible shadows.
                renderer.shadowMap.enabled = ground.visible;
                renderer.render(scene, camera);
                lastFrame = time;
                lastRenderedState = renderState;
                api.renders++;
            } else wake();
        }
        if (hoverables.some(entry => entry.hover !== entry.target)) wake();
    }

    function onScroll() { pointerDirty = true; wake(); }
    function onResize() { layoutDirty = true; wake(); }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    document.addEventListener('visibilitychange', wake);
    wake();
    window.addEventListener('pagehide', () => {
        disposed = true;
        cancelAnimationFrame(frameId);
        layoutObserver.disconnect();
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerleave', onPointerLeave);
        document.removeEventListener('visibilitychange', wake);
        document.removeEventListener('paperboard:slide', onSlide);
        disposeTree(scene);
        currentFaces?.normal.dispose();
        currentFaces?.flipped.dispose();
        renderer.dispose();
    }, { once: true });
}
