// The live 3D view: one WebGL renderer drawing a Stage into a canvas that
// fills its host, orbit controls, the entrance, the reset glide and an
// animation clip. It draws on demand: a frame is drawn when something
// changed, and frames keep coming only while something moves (the entrance,
// a glide, the camera settling after a drag, auto-rotation, a playing
// clip), so a model at rest costs nothing.
import { AnimationMixer, Spherical, Vector3, WebGLRenderer, type AnimationAction } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { readMotion, type Motion } from "./motion";
import { configureRenderer, Stage, type View } from "./stage";
import type { LoadedModel } from "./load";

/** How far the entrance turns the model, and how small it starts. */
const ENTRANCE_TURN = -Math.PI / 2;
const ENTRANCE_SCALE = 0.6;
/** How much of the view the model takes at most: room around it, and for the controls under it. */
const VIEW_FILL = 0.66;

interface Tween {
    motion: Motion;
    start: number | null;
}

interface Glide extends Tween {
    from: { target: Vector3; offset: Spherical };
    to: { target: Vector3; offset: Spherical };
}

export interface ViewerOptions {
    /** the canvas's name for assistive technology */
    label: string;
    /** the context was lost (the GPU reset, or too many contexts): the view can't draw until it is rebuilt */
    onLost: () => void;
}

export class Viewer {
    readonly renderer: WebGLRenderer;
    readonly canvas: HTMLCanvasElement;
    private readonly stage: Stage;
    private readonly controls: OrbitControls;
    private readonly resize: ResizeObserver;
    private frame = 0;
    private last = 0;
    private disposed = false;
    private aspect = 1;
    private home: View | null = null;
    /** the person moved the camera since it was last at home: a resize keeps their view */
    private moved = false;
    private entrance: Tween | null = null;
    private glide: Glide | null = null;
    private mixer: AnimationMixer | null = null;
    private action: AnimationAction | null = null;
    private playing = false;
    /** the model moved since its shadow was drawn */
    private shadowStale = false;

    /** Throws when the browser can't make a WebGL context. */
    constructor(
        private readonly host: HTMLElement,
        options: ViewerOptions,
    ) {
        this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
        configureRenderer(this.renderer);
        this.canvas = this.renderer.domElement;
        this.canvas.setAttribute("role", "img");
        this.canvas.setAttribute("aria-label", options.label);
        this.canvas.addEventListener("webglcontextlost", () => {
            if (this.disposed) return;
            cancelAnimationFrame(this.frame);
            this.frame = 0;
            options.onLost();
        });
        this.canvas.addEventListener("dblclick", () => this.reset());
        host.append(this.canvas);

        this.stage = new Stage(this.renderer);
        this.controls = new OrbitControls(this.stage.camera, this.canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.autoRotateSpeed = 1;
        this.controls.cursorStyle = "grab";
        // from the keyboard too: arrows move the model, and with Shift, ⌘ or Ctrl they turn it
        this.canvas.tabIndex = 0;
        this.canvas.setAttribute("aria-description", "Arrow keys move it; with Shift they turn it");
        this.controls.listenToKeyEvents(this.canvas);
        this.controls.addEventListener("change", () => this.invalidate());
        this.controls.addEventListener("start", () => {
            this.moved = true;
            this.glide = null;
        });

        this.resize = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            if (width <= 0 || height <= 0) return;
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            this.renderer.setSize(width, height, false);
            this.aspect = width / height;
            this.stage.setAspect(this.aspect);
            if (this.stage.model && !this.moved) this.goHome();
            // a resized canvas is cleared: draw before the page paints
            this.draw(performance.now());
        });
        this.resize.observe(host);
    }

    /** Shows `model` in place of the one shown, with the entrance; it is freed with the view. */
    show(model: LoadedModel): { animated: boolean } {
        this.stopClip();
        this.stage.show(model);
        this.shadowStale = true;
        // a new model starts at home: a resize frames it again until it is moved
        this.moved = false;
        this.goHome();

        const clip = model.animations[0];
        if (clip) {
            this.mixer = new AnimationMixer(model.root);
            this.action = this.mixer.clipAction(clip);
            this.action.play();
            this.playing = true;
        }

        const motion = readMotion(this.host);
        if (motion.duration > 0) {
            this.entrance = { motion, start: null };
            this.stage.pivot.rotation.y = ENTRANCE_TURN;
            this.stage.pivot.scale.setScalar(ENTRANCE_SCALE);
            this.canvas.animate([{ opacity: 0 }, { opacity: 1 }], { duration: motion.duration / 2, easing: "ease-out" });
        }
        this.invalidate();
        return { animated: Boolean(clip) };
    }

    /** Takes the model off the view and frees it. */
    clear() {
        this.stopClip();
        this.entrance = null;
        this.glide = null;
        this.stage.clear();
        this.invalidate();
    }

    /** Glides the camera back to where it started. */
    reset() {
        if (!this.home || !this.stage.model) return;
        const motion = readMotion(this.host);
        this.moved = false;
        this.settle();
        if (motion.duration === 0) {
            this.goHome();
            this.invalidate();
            return;
        }
        const camera = this.stage.camera;
        const target = this.controls.target.clone();
        this.glide = {
            motion,
            start: null,
            from: { target, offset: new Spherical().setFromVector3(camera.position.clone().sub(target)) },
            to: { target: this.home.target.clone(), offset: new Spherical().setFromVector3(this.home.position.clone().sub(this.home.target)) },
        };
        // the shorter way round
        const turn = this.glide.to.offset.theta - this.glide.from.offset.theta;
        this.glide.to.offset.theta -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI;
        this.invalidate();
    }

    setLabel(label: string) {
        this.canvas.setAttribute("aria-label", label);
    }

    setPlaying(playing: boolean) {
        if (!this.action) return;
        this.playing = playing;
        this.invalidate();
    }

    setAutoRotate(on: boolean) {
        this.controls.autoRotate = on;
        this.invalidate();
    }

    /** Asks for a frame; frames keep coming while something moves. */
    invalidate = () => {
        if (!this.frame && !this.disposed) this.frame = requestAnimationFrame(this.tick);
    };

    /** Frees the model, the stage and the WebGL context, at once rather than whenever the page collects it. */
    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        cancelAnimationFrame(this.frame);
        this.resize.disconnect();
        this.stopClip();
        this.controls.dispose();
        this.stage.dispose();
        this.renderer.dispose();
        // browsers keep only so many contexts: this one is given back now
        this.renderer.forceContextLoss();
        this.canvas.remove();
    }

    private tick = (now: number) => {
        this.frame = 0;
        if (this.draw(now)) this.invalidate();
        else this.last = 0;
    };

    /** Steps everything that moves to `now` and draws; true while something is still moving. */
    private draw(now: number): boolean {
        const dt = this.last ? Math.min((now - this.last) / 1000, 0.1) : 0;
        this.last = now;
        let moving = false;
        let modelMoved = this.shadowStale;
        this.shadowStale = false;

        if (this.entrance) {
            modelMoved = true;
            const t = progress(this.entrance, now);
            const eased = this.entrance.motion.ease(t);
            this.stage.pivot.rotation.y = ENTRANCE_TURN * (1 - eased);
            this.stage.pivot.scale.setScalar(ENTRANCE_SCALE + (1 - ENTRANCE_SCALE) * eased);
            if (t >= 1) this.entrance = null;
            else moving = true;
        }

        if (this.mixer && this.playing) {
            this.mixer.update(dt);
            moving = modelMoved = true;
        }

        // the controls settle after a drag (damping) and turn the model when auto-rotating
        if (this.controls.update(dt > 0 ? dt : null)) moving = true;
        if (this.controls.autoRotate && this.stage.model) moving = true;

        if (this.glide) {
            const t = progress(this.glide, now);
            const eased = this.glide.motion.ease(t);
            const { from, to } = this.glide;
            const offset = new Spherical(
                from.offset.radius + (to.offset.radius - from.offset.radius) * eased,
                from.offset.phi + (to.offset.phi - from.offset.phi) * eased,
                from.offset.theta + (to.offset.theta - from.offset.theta) * eased,
            );
            this.controls.target.lerpVectors(from.target, to.target, eased);
            this.stage.camera.position.setFromSpherical(offset).add(this.controls.target);
            this.stage.camera.lookAt(this.controls.target);
            if (t >= 1) this.glide = null;
            else moving = true;
        }

        this.stage.render(this.renderer, modelMoved);
        return moving;
    }

    /** Ends the drift a fling left, so the camera stays where it is put. */
    private settle() {
        // without damping, an update spends what's left of the drift at once
        this.controls.enableDamping = false;
        this.controls.update();
        this.controls.enableDamping = true;
    }

    private goHome() {
        this.settle();
        this.home = this.stage.home(this.aspect, VIEW_FILL);
        this.stage.look(this.home);
        this.controls.target.copy(this.home.target);
        // zoom stays within reach of the model whatever its size: it was fitted into a unit sphere
        const distance = this.home.position.distanceTo(this.home.target);
        this.controls.minDistance = distance * 0.25;
        this.controls.maxDistance = distance * 4;
        this.controls.update();
    }

    private stopClip() {
        if (this.mixer && this.stage.model) {
            this.mixer.stopAllAction();
            this.mixer.uncacheRoot(this.stage.model.root);
        }
        this.mixer = null;
        this.action = null;
        this.playing = false;
    }
}

function progress(tween: Tween, now: number): number {
    tween.start ??= now;
    return tween.motion.duration > 0 ? Math.min(1, (now - tween.start) / tween.motion.duration) : 1;
}
