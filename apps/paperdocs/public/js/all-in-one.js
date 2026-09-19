(() => {
  // matches models/all-in-one.glb dims and palette
  const C = {
    shell: 0x173763,
    fascia: 0x2a6fd6,
    dark: 0x0c1e3a,
    keys: 0x9dbdea,
    board: 0xd3e4fb,
  };

  function std(color, rough = 0.6, metal = 0.1) {
    return { color, roughness: rough, metalness: metal, flatShading: true };
  }

  function box(THREE, w, h, d, m, x = 0, y = 0, z = 0) {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z);
    o.castShadow = true;
    return o;
  }

  // tapered crt shell, front rect to back rect
  function frustum(THREE, fw, fh, fy, fz, bw, bh, by, bz, m) {
    const fx = fw / 2, bx = bw / 2;
    const F = [[-fx, fy - fh / 2, fz], [fx, fy - fh / 2, fz], [fx, fy + fh / 2, fz], [-fx, fy + fh / 2, fz]];
    const B = [[-bx, by - bh / 2, bz], [bx, by - bh / 2, bz], [bx, by + bh / 2, bz], [-bx, by + bh / 2, bz]];
    const quads = [[...F], [B[1], B[0], B[3], B[2]], [F[3], F[2], B[2], B[3]],
      [F[1], F[0], B[0], B[1]], [F[1], B[1], B[2], F[2]], [B[0], F[0], F[3], B[3]]];
    const p = [];
    for (const [a, b, c, d] of quads) p.push(...a, ...b, ...c, ...a, ...c, ...d);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.computeVertexNormals();
    const o = new THREE.Mesh(g, m);
    o.castShadow = true;
    return o;
  }

  // builds the group, loads placeholder.png as the 4:3 screen map
  function createAllInOne(THREE, opts = {}) {
    const texUrl = opts.screenUrl || 'placeholder.png';
    const g = new THREE.Group();
    g.name = 'aio-computer';

    const shellM = new THREE.MeshStandardMaterial(std(C.shell, 0.45, 0.1));
    const fasciaM = new THREE.MeshStandardMaterial(std(C.fascia, 0.5, 0.1));
    const darkM = new THREE.MeshStandardMaterial(std(C.dark, 0.7, 0.2));
    const boardM = new THREE.MeshStandardMaterial(std(C.board, 0.7, 0.05));
    const keysM = new THREE.MeshStandardMaterial(std(C.keys, 0.8, 0.0));
    const ledM = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0x73ff99, emissiveIntensity: 1.2,
      roughness: 0.4, flatShading: true,
    });

    const shell = frustum(THREE, 4.4, 3.6, 2.35, 1.55, 3.3, 2.7, 2.45, -1.65, shellM);
    shell.name = 'shell';
    g.add(shell);
    g.add(box(THREE, 4.42, 3.62, 0.16, fasciaM, 0, 2.35, 1.58));

    const bezel = new THREE.Mesh(new THREE.PlaneGeometry(4.05, 3.15), darkM);
    bezel.position.set(0, 2.42, 1.67);
    g.add(bezel);

    const screenM = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.3, metalness: 0.0,
      emissive: 0xffffff, emissiveIntensity: 1.0, flatShading: true,
    });
    new THREE.TextureLoader().load(texUrl, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      screenM.map = t;
      screenM.emissiveMap = t;
      screenM.needsUpdate = true;
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.7), screenM);
    screen.position.set(0, 2.49, 1.68);
    screen.name = 'screen';
    g.add(screen);

    g.add(box(THREE, 1.5, 0.07, 0.06, darkM, 0, 1.02, 1.68));
    g.add(box(THREE, 0.2, 0.2, 0.08, darkM, -1.7, 1.02, 1.68));
    g.add(box(THREE, 0.22, 0.05, 0.05, ledM, 1.7, 1.02, 1.68));

    g.add(box(THREE, 2.4, 1.5, 0.1, darkM, 0, 2.1, -1.66));

    const wedge = box(THREE, 1.7, 0.55, 2.2, darkM, 0, 0.35, -0.1);
    wedge.rotation.x = THREE.MathUtils.degToRad(-4);
    g.add(wedge);

    const foot = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.14, 10), shellM);
    foot.position.set(0, 0.07, -0.1);
    foot.scale.set(1, 1, 0.7);
    foot.castShadow = true;
    g.add(foot);

    const kb = new THREE.Group();
    kb.position.set(-0.2, 0, 3.3);
    kb.add(box(THREE, 3.0, 0.1, 1.0, boardM, 0, 0.09, 0));
    const pitch = 0.225;
    const x0 = -(12 * pitch - 0.035) / 2 + 0.095;
    const rows = [[-0.31, 0.0], [-0.09, 0.05], [0.13, 0.1]];
    for (const [dz, off] of rows) {
      for (let k = 0; k < 12; k++) {
        kb.add(box(THREE, 0.19, 0.05, 0.17, keysM, x0 + off + k * pitch, 0.16, dz));
      }
    }
    kb.add(box(THREE, 0.19, 0.05, 0.17, keysM, -1.2175, 0.16, 0.35));
    kb.add(box(THREE, 0.19, 0.05, 0.17, keysM, -0.9925, 0.16, 0.35));
    kb.add(box(THREE, 1.5, 0.05, 0.17, keysM, -0.1125, 0.16, 0.35));
    for (const kx of [0.7675, 0.9925, 1.2175]) {
      kb.add(box(THREE, 0.19, 0.05, 0.17, keysM, kx, 0.16, 0.35));
    }
    g.add(kb);

    g.add(box(THREE, 0.55, 0.22, 0.85, boardM, 1.9, 0.11, 3.2));
    g.add(box(THREE, 0.5, 0.05, 0.35, fasciaM, 1.9, 0.24, 2.98));

    return g;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createAllInOne };
  if (typeof window !== 'undefined') window.createAllInOne = createAllInOne;
})();
