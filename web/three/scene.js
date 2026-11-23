import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createWarehouse } from './model.js';
import { mountInspection } from './inspection.js';
import { sampleSimulation } from './simulation.js';

const angles = {
  perspective: [-0.59, 0.43, 1],
  front: [0, 0.05, 1],
  side: [-1, 0.07, 0],
  top: [0, 1, 0.001],
};

export function createScene({ selectSignal, editWiring }) {
  const canvas = document.querySelector('#machine');
  const stage = document.querySelector('#stage');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe8edf0);
  scene.fog = new THREE.Fog(0xe8edf0, 14, 40);
  const sky = new THREE.HemisphereLight(0xf4faff, 0xc4baae, 1.6);
  const key = new THREE.DirectionalLight(0xfff5e8, 2.0);
  key.position.set(-4, 9, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: .1, far: 22 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -.00025;
  key.shadow.normalBias = .007;
  const rim = new THREE.DirectionalLight(0xe1edff, 1.2);
  rim.position.set(4, 5, -6);
  scene.add(sky, key, rim);

  const warehouse = createWarehouse();
  warehouse.setPose(sampleSimulation(0).pose);
  scene.add(warehouse.group);
  const bounds = new THREE.Box3().setFromObject(warehouse.group);
  const center = bounds.getCenter(new THREE.Vector3());
  const floorY = bounds.min.y - .015;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(190, 190), new THREE.MeshStandardMaterial({
    color: 0xc8d0d4, roughness: 1, metalness: 0,
  }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY;
  floor.receiveShadow = true;
  const grid = new THREE.GridHelper(64, 128, 0x7c8e98, 0x7c8e98);
  grid.position.y = floorY + .002;
  grid.material.transparent = true;
  grid.material.opacity = .18;
  grid.material.depthWrite = false;
  scene.add(floor, grid);

  const camera = new THREE.PerspectiveCamera(35, 1, .06, 135);
  const controls = new OrbitControls(camera, canvas);
  controls.minDistance = 1.6;
  controls.maxDistance = 35;
  controls.maxPolarAngle = Math.PI * .494;
  controls.rotateSpeed = .75;
  controls.panSpeed = .7;
  controls.zoomSpeed = .86;
  controls.maxTargetRadius = 5.5;
  controls.cursor.copy(center);
  let dirty = true;
  let modified = false;

  // Frame the actual silhouette. The empty space above the board corners makes
  // the model's overall bounding box a poor fit for this asymmetric machine.
  const surfacePoints = [];
  const instance = new THREE.Matrix4(), world = new THREE.Matrix4();
  warehouse.group.traverse(mesh => {
    if (!mesh.isMesh) return;
    const vertices = mesh.geometry.attributes.position;
    const count = mesh.isInstancedMesh ? mesh.count : 1;
    for (let index = 0; index < count; index++) {
      world.copy(mesh.matrixWorld);
      if (mesh.isInstancedMesh) {
        mesh.getMatrixAt(index, instance);
        world.multiply(instance);
      }
      const stride = Math.max(1, Math.floor(vertices.count / 3200));
      for (let v = 0; v < vertices.count; v += stride) {
        surfacePoints.push(new THREE.Vector3().fromBufferAttribute(vertices, v).applyMatrix4(world).sub(center));
      }
    }
  });
  const viewSelect = document.querySelector('#view');
  function fitView(name) {
    const direction = new THREE.Vector3(...angles[name]).normalize();
    const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right);
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const width = tan * camera.aspect * .90, height = tan * .78;
    let left = Infinity, rightmost = -Infinity, bottom = Infinity, top = -Infinity;
    for (const point of surfacePoints) {
      const depth = point.dot(direction);
      const x = point.dot(right), y = point.dot(up);
      left = Math.min(left, x - width * depth);
      rightmost = Math.max(rightmost, x + width * depth);
      bottom = Math.min(bottom, y - height * depth);
      top = Math.max(top, y + height * depth);
    }
    const distance = Math.max((rightmost - left) / (2 * width), (top - bottom) / (2 * height));
    controls.target.copy(center).addScaledVector(right, (rightmost + left) / 2)
      .addScaledVector(up, (top + bottom) / 2);
    camera.position.copy(controls.target).addScaledVector(direction, distance);
    controls.update();
    viewSelect.value = name;
    modified = false;
    dirty = true;
  }
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!modified) fitView(viewSelect.value);
    dirty = true;
  }
  new ResizeObserver(resize).observe(stage);
  resize();
  controls.addEventListener('start', () => { modified = true; });
  controls.addEventListener('change', () => { dirty = true; });
  viewSelect.addEventListener('change', () => fitView(viewSelect.value));
  document.querySelector('#reset-view').addEventListener('click', () => fitView('perspective'));

  function zoom(closer) {
    modified = true;
    if (closer) controls.dollyIn(.82);
    else controls.dollyOut(.82);
  }
  document.querySelector('#zoom-in').addEventListener('click', () => zoom(true));
  document.querySelector('#zoom-out').addEventListener('click', () => zoom(false));
  canvas.addEventListener('keydown', event => {
    const amount = .12;
    switch (event.key) {
      case 'ArrowLeft': controls.rotateLeft(amount); break;
      case 'ArrowRight': controls.rotateLeft(-amount); break;
      case 'ArrowUp': controls.rotateUp(amount); break;
      case 'ArrowDown': controls.rotateUp(-amount); break;
      case '+': case '=': zoom(true); break;
      case '-': zoom(false); break;
      default: return;
    }
    event.preventDefault();
    modified = true;
  });

  function focusPart(part) {
    const box = new THREE.Box3();
    for (const mesh of part.meshes) box.expandByObject(mesh);
    if (box.isEmpty()) return;
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
    const point = box.getCenter(new THREE.Vector3());
    const direction = point.clone().sub(center);
    direction.y = 0;
    if (direction.lengthSq() < .1) direction.set(-.6, 0, 1);
    direction.normalize().y = .55;
    direction.normalize();
    const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(camera.aspect, 1));
    const distance = Math.max(controls.minDistance, 1.3 * radius / Math.sin(halfFov));
    controls.target.copy(point);
    camera.position.copy(point).addScaledVector(direction, distance);
    modified = true;
    controls.update();
    dirty = true;
  }
  const inspection = mountInspection({ warehouse, camera, canvas, focusPart, selectSignal, editWiring,
    invalidate: () => { dirty = true; },
  });
  function render(pose) {
    if (pose) warehouse.setPose(pose);
    if (!pose && !dirty) return;
    renderer.render(scene, camera);
    inspection.projectLabels();
    dirty = false;
  }
  return { render, showSignal: inspection.showSignal, setDigitalState: inspection.setDigitalState };
}
