// The scene a model is shown in, shared by the viewer and the thumbnails so
// both frame and light it the same way: a soft studio environment, a key
// light, a contact shadow on an invisible floor, and a camera at a
// three-quarter angle that fits the whole model.
import {
    Box3,
    DirectionalLight,
    Group,
    Mesh,
    MeshBasicMaterial,
    MeshDepthMaterial,
    NeutralToneMapping,
    OrthographicCamera,
    PerspectiveCamera,
    PlaneGeometry,
    PMREMGenerator,
    Scene,
    ShaderMaterial,
    SRGBColorSpace,
    Vector3,
    WebGLRenderTarget,
    type WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { HorizontalBlurShader } from "three/examples/jsm/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/examples/jsm/shaders/VerticalBlurShader.js";
import type { LoadedModel } from "./load";

/** The camera's vertical field of view: narrow, as a product shot, so the model isn't distorted. */
const FOV = 30;
/** Where the camera starts: turned this far from the front, and this far above. */
const AZIMUTH = (30 * Math.PI) / 180;
const ELEVATION = (20 * Math.PI) / 180;

/** Where the camera is and what it looks at. */
export interface View {
    position: Vector3;
    target: Vector3;
}

/** Color management, the same on every renderer that draws a stage. */
export function configureRenderer(renderer: WebGLRenderer) {
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    // transparent: the model sits on whatever surface the viewer is on
    renderer.setClearColor(0x000000, 0);
}

export class Stage {
    readonly scene = new Scene();
    readonly camera = new PerspectiveCamera(FOV, 1, 0.01, 100);
    /** turned and scaled by the entrance, about the middle of the model's base */
    readonly pivot = new Group();
    model: LoadedModel | null = null;

    private readonly fit = new Group();
    private readonly environment: WebGLRenderTarget;
    private readonly light = new DirectionalLight(0xffffff, 1.2);
    private readonly shadow = new ContactShadow();
    /** the model's box once fitted: centered on the origin, inside a unit sphere */
    private readonly bounds = new Box3();

    constructor(renderer: WebGLRenderer) {
        const pmrem = new PMREMGenerator(renderer);
        const room = new RoomEnvironment();
        this.environment = pmrem.fromScene(room, 0.04);
        room.dispose();
        pmrem.dispose();
        this.scene.environment = this.environment.texture;
        this.scene.environmentIntensity = 0.75;
        // turned off the axes: a face whose normal points at a corner of the
        // environment's cube map (an icosahedron's do) reads it unsteadily,
        // pixel by pixel, and shows grain
        this.scene.environmentRotation.y = 0.35;

        // every model is fitted into a unit sphere, so the light, the
        // shadow and the camera's clipping planes suit a building and a bolt
        this.light.position.set(-1.5, 3, 2);
        this.scene.add(this.light, this.light.target);
        this.shadow.group.visible = false;
        this.scene.add(this.shadow.group);
        this.pivot.add(this.fit);
        this.scene.add(this.pivot);
    }

    /** Puts `model` on the stage in place of the one there, fitted into a unit sphere with its base on the floor. */
    show(model: LoadedModel) {
        this.clear();
        this.model = model;
        const box = new Box3().setFromObject(model.root);
        const center = box.getCenter(new Vector3());
        const radius = box.getSize(new Vector3()).length() / 2 || 1;
        const scale = 1 / radius;
        // the pivot is the middle of the base, so the entrance grows the
        // model up from the floor; the model's middle is the origin
        this.fit.scale.setScalar(scale);
        this.fit.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
        const base = (box.min.y - center.y) * scale;
        this.pivot.position.set(0, base, 0);
        this.pivot.rotation.set(0, 0, 0);
        this.pivot.scale.setScalar(1);
        this.bounds.min.copy(box.min).sub(center).multiplyScalar(scale);
        this.bounds.max.copy(box.max).sub(center).multiplyScalar(scale);
        this.shadow.group.position.y = base;
        this.shadow.group.visible = true;
        this.fit.add(model.root);
    }

    /** Takes the model off the stage and frees it. */
    clear() {
        if (!this.model) return;
        this.fit.remove(this.model.root);
        this.model.dispose();
        this.model = null;
        this.shadow.group.visible = false;
    }

    /**
     * Where the camera starts for a view `aspect` wide per unit high: at a
     * three-quarter angle, as close as it can be with every corner of the
     * model's box in view and at most `fill` of the frame used.
     */
    home(aspect: number, fill: number): View {
        const toCamera = new Vector3(Math.sin(AZIMUTH) * Math.cos(ELEVATION), Math.sin(ELEVATION), Math.cos(AZIMUTH) * Math.cos(ELEVATION));
        const forward = toCamera.clone().negate();
        const right = new Vector3().crossVectors(forward, this.camera.up).normalize();
        const up = new Vector3().crossVectors(right, forward);
        const tanV = Math.tan((FOV * Math.PI) / 360) * fill;
        const tanH = tanV * aspect;
        let distance = 0;
        const corner = new Vector3();
        for (let i = 0; i < 8; i++) {
            corner.set(i & 1 ? this.bounds.max.x : this.bounds.min.x, i & 2 ? this.bounds.max.y : this.bounds.min.y, i & 4 ? this.bounds.max.z : this.bounds.min.z);
            // a corner `depth` past the target is that much farther from the camera
            const depth = corner.dot(forward);
            distance = Math.max(distance, Math.abs(corner.dot(right)) / tanH - depth, Math.abs(corner.dot(up)) / tanV - depth);
        }
        distance = Math.max(distance, 1.2);
        return { position: toCamera.multiplyScalar(distance), target: new Vector3() };
    }

    /** Points the camera along `view`. */
    look(view: View) {
        this.camera.position.copy(view.position);
        this.camera.lookAt(view.target);
    }

    setAspect(aspect: number) {
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();
    }

    /**
     * Draws the stage. `moved` says the model itself moved (it was shown,
     * the entrance or its animation stepped): its shadow is drawn again.
     * Orbiting moves only the camera, and keeps the shadow it has.
     */
    render(renderer: WebGLRenderer, moved: boolean) {
        if (moved && this.model) this.shadow.render(renderer, this.scene);
        renderer.render(this.scene, this.camera);
    }

    /** Frees the model and the stage's own GPU resources. */
    dispose() {
        this.clear();
        this.environment.dispose();
        this.shadow.dispose();
    }
}

/** The floor the shadow lies on: wider than any model fitted into a unit sphere, with room for the blur. */
const SHADOW_SIZE = 3.2;
/** How far above the floor the shadow sees: what is higher casts none. */
const SHADOW_REACH = 1.1;
const SHADOW_PIXELS = 512;

/**
 * A soft shadow where the model meets the floor, as a studio photo has:
 * the model drawn from under the floor as darkness that fades with height,
 * blurred, and laid on the floor. It depends on the model only, so it is
 * drawn again only when the model moves, never when the camera does.
 */
class ContactShadow {
    readonly group = new Group();
    private readonly target = new WebGLRenderTarget(SHADOW_PIXELS, SHADOW_PIXELS);
    private readonly blurred = new WebGLRenderTarget(SHADOW_PIXELS, SHADOW_PIXELS);
    private readonly geometry = new PlaneGeometry(SHADOW_SIZE, SHADOW_SIZE).rotateX(Math.PI / 2);
    private readonly floor: Mesh<PlaneGeometry, MeshBasicMaterial>;
    private readonly blur: Mesh<PlaneGeometry, ShaderMaterial>;
    private readonly camera = new OrthographicCamera(-SHADOW_SIZE / 2, SHADOW_SIZE / 2, SHADOW_SIZE / 2, -SHADOW_SIZE / 2, 0, SHADOW_REACH);
    private readonly depth = new MeshDepthMaterial({ depthTest: false, depthWrite: false });
    private readonly horizontal = new ShaderMaterial({ ...HorizontalBlurShader, uniforms: { tDiffuse: { value: null }, h: { value: 0 } }, depthTest: false });
    private readonly vertical = new ShaderMaterial({ ...VerticalBlurShader, uniforms: { tDiffuse: { value: null }, v: { value: 0 } }, depthTest: false });

    constructor() {
        this.target.texture.generateMipmaps = false;
        this.blurred.texture.generateMipmaps = false;
        this.floor = new Mesh(this.geometry, new MeshBasicMaterial({ map: this.target.texture, transparent: true, opacity: 0.55, depthWrite: false }));
        // the shadow is drawn looking up, so it is laid down mirrored
        this.floor.scale.y = -1;
        this.floor.renderOrder = 1;
        this.blur = new Mesh(this.geometry, this.horizontal);
        this.blur.visible = false;
        // looking up from the floor
        this.camera.rotation.x = Math.PI / 2;
        this.group.add(this.floor, this.blur, this.camera);

        // depth as darkness: black, more opaque the nearer the floor
        const from = "gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );";
        this.depth.onBeforeCompile = (shader) => {
            if (!shader.fragmentShader.includes(from)) throw new Error("PaperModel: three's depth shader changed; the contact shadow can't be drawn");
            shader.fragmentShader = shader.fragmentShader.replace(from, "gl_FragColor = vec4( vec3( 0.0 ), 1.0 - fragCoordZ );");
        };
    }

    render(renderer: WebGLRenderer, scene: Scene) {
        const before = renderer.getRenderTarget();
        this.floor.visible = false;
        scene.overrideMaterial = this.depth;
        renderer.setRenderTarget(this.target);
        renderer.clear();
        renderer.render(scene, this.camera);
        scene.overrideMaterial = null;
        // twice, the second finer, for a soft edge without banding
        this.pass(renderer, 3);
        this.pass(renderer, 1.2);
        this.floor.visible = true;
        renderer.setRenderTarget(before);
    }

    private pass(renderer: WebGLRenderer, amount: number) {
        this.blur.visible = true;
        this.blur.material = this.horizontal;
        this.horizontal.uniforms.tDiffuse.value = this.target.texture;
        this.horizontal.uniforms.h.value = amount / 256;
        renderer.setRenderTarget(this.blurred);
        renderer.render(this.blur, this.camera);
        this.blur.material = this.vertical;
        this.vertical.uniforms.tDiffuse.value = this.blurred.texture;
        this.vertical.uniforms.v.value = amount / 256;
        renderer.setRenderTarget(this.target);
        renderer.render(this.blur, this.camera);
        this.blur.visible = false;
    }

    dispose() {
        this.target.dispose();
        this.blurred.dispose();
        this.geometry.dispose();
        this.floor.material.dispose();
        this.depth.dispose();
        this.horizontal.dispose();
        this.vertical.dispose();
    }
}
