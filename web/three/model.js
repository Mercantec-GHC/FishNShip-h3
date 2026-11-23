import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Decimetres. The X spindle runs along the front of the wooden base (+Z).
// The rack and the conveyor both accept a carrier from the back of the moving fork.
const transferX = 1.9;
const columnPitch = 1.02;
const rackZ = -0.37;
const forkRestZ = 0.43;
const bottomDeck = 0.93;
const deckSpacing = 0.70;
const beltDeck = bottomDeck + 2 * deckSpacing * 0.16;
const outerBeltZ = -1.48;
const slotX = column => transferX - column * columnPitch;
const slotY = level => bottomDeck + level * deckSpacing;
const halfPi = Math.PI / 2;

function plastic(color, roughness = 0.45, metalness = 0.04) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function materials() {
  return {
    base: plastic(0xdedfd9, 0.65), mould: plastic(0x252931), dark: plastic(0x151a22),
    graphite: plastic(0x3f4650), red: plastic(0xcd2030), redLight: plastic(0xe4353e),
    redDark: plastic(0x931c29), ivory: plastic(0xf1eee0), white: plastic(0xf7f7f1),
    blue: plastic(0x205cad), aluminium: plastic(0xbec7cf, 0.32, 0.48),
    steel: plastic(0x7d8991, 0.27, 0.55), zinc: plastic(0xccd0cc, 0.34, 0.4),
    pcb: plastic(0x285849), terminal: plastic(0x4d8862), rubber: plastic(0x282833, 0.83),
    amber: plastic(0xdfad48), brass: plastic(0xb78b4a, 0.39, 0.38),
    wireRed: plastic(0xb44942), wireGold: plastic(0xe0b343), wireBlue: plastic(0x397aa0),
    wireGreen: plastic(0x468365), lens: plastic(0xe2b067, 0.21), label: plastic(0xe0e3d8),
  };
}

// Consolidate rigid pieces by material and instance repeated tooling. The lift, fork,
// drive screw and travelling carrier keep independent local transforms.
function parts(parent) {
  const batches = new Map();
  const cube = new THREE.BoxGeometry();
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 18);
  const bevel = new Map();
  const transform = new THREE.Object3D();

  function add(geometry, material, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    if (!batches.has(material)) batches.set(material, new Map());
    const shapes = batches.get(material);
    if (!shapes.has(geometry)) shapes.set(geometry, []);
    transform.position.set(x, y, z);
    transform.scale.set(sx, sy, sz);
    transform.rotation.set(rx, ry, rz);
    transform.updateMatrix();
    shapes.get(geometry).push(transform.matrix.clone());
  }

  function box(m, x, y, z, w, h, d, radius = 0) {
    if (!radius) return add(cube, m, x, y, z, w, h, d);
    const key = [w, h, d, radius].join('/');
    if (!bevel.has(key)) bevel.set(key, new RoundedBoxGeometry(w, h, d, 1, radius));
    add(bevel.get(key), m, x, y, z);
  }

  function rod(m, x, y, z, radius, length, axis = 'y') {
    add(cylinder, m, x, y, z, radius, length, radius,
      axis === 'z' ? halfPi : 0, 0, axis === 'x' ? halfPi : 0);
  }

  function cable(m, coordinates, radius = 0.012) {
    const curve = new THREE.CatmullRomCurve3(coordinates.map(point => new THREE.Vector3(...point)));
    add(new THREE.TubeGeometry(curve, Math.max(14, coordinates.length * 4), radius, 6, false), m, 0, 0, 0);
  }

  function finish() {
    for (const [material, shapes] of batches) {
      const solids = [];
      for (const [geometry, matrices] of shapes) {
        if (matrices.length >= 20) {
          const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
          matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
          mesh.castShadow = mesh.receiveShadow = true;
          parent.add(mesh);
        } else {
          for (const matrix of matrices) {
            const solid = geometry.index ? geometry.toNonIndexed() : geometry.clone();
            solid.applyMatrix4(matrix);
            solids.push(solid);
          }
        }
      }
      if (!solids.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(solids), material);
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
      solids.forEach(geometry => geometry.dispose());
    }
    batches.clear();
  }
  return { add, box, rod, cable, finish };
}

function rectangle(path, x, y, w, h) {
  path.moveTo(x, y); path.lineTo(x, y + h); path.lineTo(x + w, y + h);
  path.lineTo(x + w, y); path.closePath();
  return path;
}

function slottedPlate(width, height, depth, slots) {
  const surface = rectangle(new THREE.Shape(), -width / 2, -height / 2, width, height);
  for (const [x, y, w, h] of slots) {
    const hole = new THREE.Path();
    hole.moveTo(x - w / 2, y - h / 2); hole.lineTo(x + w / 2, y - h / 2);
    hole.lineTo(x + w / 2, y + h / 2); hole.lineTo(x - w / 2, y + h / 2);
    hole.closePath();
    surface.holes.push(hole);
  }
  return new THREE.ExtrudeGeometry(surface, { depth, bevelEnabled: false, curveSegments: 4 });
}

function mouldedPost(p, m, x, z, bottom, height, width = 0.13, depth = 0.17) {
  // The square windows go through the four sides, including on the back of the model.
  const blockCount = Math.max(2, Math.round(height / 0.31));
  const module = height / blockCount;
  const windowY = [-0.23, 0.23].map(y => [0, y * module, width * 0.43, module * 0.28]);
  const front = slottedPlate(width, module - 0.009, 0.018, windowY);
  const side = slottedPlate(depth - 0.006, module - 0.009, 0.016, windowY);
  for (let row = 0; row < blockCount; row++) {
    const y = bottom + module * (row + 0.5);
    for (const direction of [-1, 1]) {
      p.add(front, m.mould, x, y, z + direction * (depth / 2 - 0.018),
        1, 1, 1, 0, direction === 1 ? 0 : Math.PI);
      p.add(side, m.graphite, x + direction * (width / 2 - 0.016), y, z,
        1, 1, 1, 0, direction * halfPi);
    }
  }
  p.box(m.dark, x, bottom + height + 0.017, z, width + 0.004, 0.045, depth + 0.004);
  for (const dx of [-width * 0.26, width * 0.26]) {
    p.box(m.graphite, x + dx, bottom + height + 0.038, z, 0.012, 0.010, depth);
  }
}

function gearGeometry(radius, teeth, thickness) {
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth * 4; i++) {
    const a = (2 * Math.PI * i) / (teeth * 4);
    const r = i % 4 === 1 || i % 4 === 2 ? radius : radius * 0.87;
    shape[i ? 'lineTo' : 'moveTo'](r * Math.cos(a), r * Math.sin(a));
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
}

function helicalThread(length, pitch, innerRadius, outerRadius) {
  const count = Math.ceil(length / pitch * 13);
  const positions = [], uv = [], indices = [];
  for (let i = 0; i <= count; i++) {
    const x = length * i / count, angle = x / pitch * 2 * Math.PI;
    for (const [dx, r] of [[0, innerRadius], [0.22, outerRadius], [0.43, outerRadius], [0.67, innerRadius]]) {
      positions.push(x + dx * pitch, Math.cos(angle) * r, Math.sin(angle) * r);
      uv.push(i / count, dx);
    }
    if (i === count) continue;
    for (let j = 0; j < 3; j++) {
      const a = i * 4 + j;
      indices.push(a, a + 4, a + 1, a + 1, a + 4, a + 5);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function table(p, m) {
  p.box(m.base, 0, 0.067, 0, 6.05, 0.134, 3.72, 0.023);
  const tile = slottedPlate(0.157, 0.164, 0.052, [[0, 0, 0.071, 0.034]]);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 2; row++) {
      const cx = (col - 1) * 1.735;
      const cz = (row - 0.5) * 1.482;
      for (let i = -5; i <= 5; i++) {
        for (let j = -4; j <= 4; j++) {
          p.add(tile, m.graphite, cx + i * 0.157, 0.135, cz + j * 0.164, 1, 1, 1, -halfPi);
        }
      }
      for (const dx of [-0.74, 0.74]) {
        for (const dz of [-0.64, 0.64]) {
          p.rod(m.zinc, cx + dx, 0.197, cz + dz, 0.027, 0.02);
          p.box(m.mould, cx + dx, 0.208, cz + dz, 0.025, 0.002, 0.005);
        }
      }
    }
  }
}

function triangleBracket() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(0.159, 0); shape.lineTo(0.031, 0.123);
  shape.lineTo(0, 0.123); shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0.046, 0.044, 0.024, 0, 2 * Math.PI);
  shape.holes.push(hole);
  return new THREE.ExtrudeGeometry(shape, { depth: 0.052, bevelEnabled: false });
}

function shelves(p, m) {
  const bracket = triangleBracket();
  for (let i = 0; i < 4; i++) {
    const x = slotX(i + 0.5);
    for (const z of [rackZ - 0.20, rackZ + 0.20]) {
      mouldedPost(p, m, x, z, 0.242, 2.17, 0.174, 0.158);
      p.box(m.mould, x, 2.427, z, 0.185, 0.156, 0.171, 0.008);
      for (const dx of [-0.064, 0, 0.064]) {
        p.box(m.graphite, x + dx, 2.436, z + 0.084, 0.023, 0.135, 0.012);
        p.box(m.graphite, x + dx, 2.506, z, 0.022, 0.008, 0.160);
      }
      p.box(m.dark, x, 0.227, z, 0.217, 0.08, 0.22, 0.013);
    }
    p.box(m.mould, x, 0.28, rackZ, 0.143, 0.15, 0.52);
  }
  for (let column = 1; column <= 3; column++) {
    const x = slotX(column);
    for (let level = 0; level < 3; level++) {
      const y = slotY(level);
      for (const side of [-1, 1]) {
        const upright = x + side * (columnPitch / 2);
        p.box(m.red, x + side * 0.401, y - 0.065, rackZ, 0.14, 0.11, 0.47, 0.007);
        p.box(m.redLight, x + side * 0.351, y - 0.013, rackZ, 0.263, 0.048, 0.54, 0.006);
        for (const dz of [-0.21, 0.15]) {
          p.add(bracket, m.redLight, upright - side * 0.071, y + 0.009, rackZ + dz,
            1, 1, 1, 0, side === 1 ? Math.PI : 0);
        }
        const boltX = upright - side * 0.106;
        p.box(m.dark, boltX, y - 0.067, rackZ + 0.245, 0.093, 0.087, 0.032);
        p.rod(m.redLight, boltX, y - 0.067, rackZ + 0.264, 0.021, 0.013, 'z');
        p.rod(m.steel, boltX, y - 0.067, rackZ + 0.273, 0.010, 0.006, 'z');
      }
    }
  }
  for (const z of [rackZ - 0.20, rackZ + 0.20]) {
    p.box(m.mould, slotX(2), 0.252, z, 3.15, 0.108, 0.13);
  }
}

function carrier(p, m, x, y, z, color) {
  // The PDF shows light moulded workpiece carriers, each with a recessed coloured puck.
  for (const dx of [-0.198, 0.198]) {
    p.box(m.ivory, x + dx, y + 0.028, z, 0.104, 0.054, 0.385, 0.010);
  }
  p.box(m.white, x, y + 0.105, z, 0.50, 0.139, 0.405, 0.022);
  p.rod(m.ivory, x, y + 0.181, z, 0.182, 0.025);
  p.rod(m[color], x, y + 0.203, z, 0.162, 0.042);
  p.rod(m[color], x, y + 0.225, z, 0.152, 0.012);
  const stripes = color === 'blue' ? [-0.094, 0.094] : color === 'red' ? [0] : [];
  for (const dz of stripes) p.box(m.dark, x - 0.251, y + 0.106, z + dz, 0.004, 0.115, 0.070);
}

function axisDrive(p, m) {
  for (const z of [0.69, 1.25]) {
    p.box(m.mould, 0.04, 0.239, z, 4.96, 0.101, 0.126);
    p.rod(m.aluminium, 0.03, 0.336, z, 0.031, 4.80, 'x');
  }
  for (const x of [-1.83, 2.39]) {
    p.box(m.redDark, x, 0.255, 0.972, 0.17, 0.10, 0.72, 0.012);
    p.box(m.red, x, 0.372, 0.970, 0.135, 0.24, 0.28, 0.010);
    p.rod(m.mould, x, 0.425, 0.97, 0.083, 0.155, 'x');
  }
  p.box(m.mould, -2.130, 0.366, 0.98, 0.35, 0.34, 0.33, 0.018);
  p.box(m.red, -2.136, 0.488, 0.94, 0.50, 0.29, 0.32, 0.022);
  for (let i = 0; i < 5; i++) {
    const x = -2.275 + i * 0.068;
    p.box(m.graphite, x, 0.393, 1.154, 0.048, 0.265, 0.033, 0.006);
  }
  for (const z of [0.80, 1.08]) {
    p.box(m.redLight, -2.14, 0.611, z, 0.458, 0.032, 0.036);
    p.box(m.redDark, -2.14, 0.49, z, 0.39, 0.025, 0.022);
  }
  p.box(m.terminal, -2.39, 0.40, 0.94, 0.024, 0.105, 0.133);
  p.rod(m.steel, 0.285, 0.425, 0.970, 0.031, 4.32, 'x');
  p.box(m.mould, 2.39, 0.435, 1.2, 0.105, 0.08, 0.21);
  p.box(m.redLight, 2.381, 0.481, 1.21, 0.057, 0.027, 0.07);
}

function opticalGate(p, m, z) {
  for (const dx of [-0.35, 0.35]) {
    const x = transferX + dx;
    p.box(m.red, x, beltDeck + 0.016, z, 0.072, 0.223, 0.095, 0.010);
    p.box(m.dark, x, beltDeck + 0.115, z, 0.115, 0.106, 0.109, 0.008);
    p.rod(m.lens, x - Math.sign(dx) * 0.058, beltDeck + 0.115, z, 0.025, 0.016, 'x');
  }
}

function conveyor(p, m) {
  for (const x of [transferX - 0.262, transferX + 0.262]) {
    for (const z of [-1.38, -0.45]) {
      mouldedPost(p, m, x, z, 0.21, beltDeck - 0.40, 0.118, 0.128);
      p.box(m.mould, x, 0.235, z, 0.165, 0.090, 0.19);
      p.box(m.red, x, beltDeck - 0.188, z, 0.15, 0.125, 0.19);
    }
    p.box(m.dark, x, 0.31, -0.91, 0.112, 0.12, 1.01);
    p.box(m.red, x, beltDeck - 0.092, -0.910, 0.102, 0.173, 1.55, 0.012);
    p.box(m.redLight, x, beltDeck - 0.012, -0.91, 0.113, 0.025, 1.54);
    for (const z of [-1.54, -1.22, -0.60, -0.29]) {
      p.rod(m.dark, x + Math.sign(x - transferX) * 0.057, beltDeck - 0.103, z, 0.033, 0.020, 'x');
    }
  }
  // At the transfer end two clear channels allow the fork to rise beneath the carrier.
  p.box(m.rubber, transferX, beltDeck - 0.035, -1.166, 0.408, 0.070, 0.92, 0.012);
  p.box(m.rubber, transferX, beltDeck - 0.035, -0.457, 0.093, 0.070, 0.51, 0.008);
  for (const dx of [-0.23, 0.23]) {
    p.box(m.mould, transferX + dx, beltDeck - 0.017, -0.45, 0.073, 0.035, 0.53);
  }
  for (const z of [-1.62, -0.196]) {
    p.rod(m.rubber, transferX, beltDeck - 0.076, z, 0.075, z < -1 ? 0.414 : 0.093, 'x');
    p.rod(m.steel, transferX, beltDeck - 0.076, z, 0.028, 0.74, 'x');
  }
  p.box(m.mould, transferX - 0.435, beltDeck - 0.269, -1.34, 0.269, 0.229, 0.309, 0.015);
  p.box(m.red, transferX - 0.441, beltDeck - 0.146, -1.41, 0.252, 0.128, 0.29);
  p.add(gearGeometry(0.123, 16, 0.037), m.redDark, transferX - 0.38, beltDeck - 0.08, -1.62, 1, 1, 1, 0, halfPi);
  opticalGate(p, m, -1.43);
  opticalGate(p, m, -0.43);
  p.box(m.red, transferX - 0.33, beltDeck + 0.02, -0.87, 0.1, 0.21, 0.19);
  p.box(m.dark, transferX - 0.315, beltDeck + 0.12, -0.87, 0.125, 0.16, 0.15, 0.01);
  for (const dy of [0.085, 0.152]) p.rod(m.lens, transferX - 0.25, beltDeck + dy, -0.87, 0.019, 0.015, 'x');
}

function mast(p, m) {
  p.box(m.red, 0, 0.373, 0.968, 0.51, 0.237, 0.84, 0.018);
  for (const z of [0.63, 1.25]) {
    p.box(m.redLight, 0, 0.417, z, 0.56, 0.144, 0.192, 0.012);
    p.box(m.mould, 0, 0.372, z + 0.095, 0.395, 0.065, 0.011);
    for (const dx of [-0.14, 0, 0.14]) p.rod(m.redLight, dx, 0.374, z + 0.103, 0.022, 0.015, 'z');
  }
  for (const x of [-0.152, 0.152]) {
    for (const z of [0.72, 1.19]) {
      p.box(m.aluminium, x, 1.745, z, 0.105, 2.52, 0.121, 0.007);
      p.box(m.steel, x, 1.745, z + 0.061, 0.014, 2.47, 0.004);
      p.box(m.zinc, x + 0.052, 1.745, z, 0.008, 2.46, 0.050);
      for (const y of [0.51, 2.984]) {
        p.box(m.mould, x, y, z, 0.139, 0.117, 0.153, 0.009);
        p.box(m.red, x, y + (y > 1 ? 0.064 : -0.066), z, 0.152, 0.057, 0.161);
      }
    }
  }
  p.box(m.mould, 0, 3.062, 0.955, 0.472, 0.135, 0.683, 0.012);
  for (const dx of [-0.232, 0.232]) {
    p.box(m.red, dx, 3.038, 0.955, 0.052, 0.18, 0.681, 0.010);
  }
  p.rod(m.steel, 0, 1.764, 0.735, 0.028, 2.58);
  p.add(helicalThread(2.50, 0.065, 0.027, 0.042), m.graphite, 0, 0.49, 0.735, 1, 1, 1, 0, 0, halfPi);
  p.add(gearGeometry(0.143, 18, 0.042), m.redLight, 0, 3.158, 0.735, 1, 1, 1, -halfPi);
  p.add(gearGeometry(0.095, 13, 0.042), m.redDark, 0, 3.158, 0.955, 1, 1, 1, -halfPi);
  p.rod(m.steel, 0, 3.188, 0.735, 0.029, 0.09);
  p.box(m.redDark, 0.235, 2.724, 1.06, 0.190, 0.526, 0.229, 0.018);
  p.box(m.mould, 0.24, 2.59, 1.058, 0.220, 0.285, 0.250, 0.019);
  p.box(m.terminal, 0.247, 2.424, 1.062, 0.120, 0.049, 0.145);
  p.box(m.mould, -0.272, 2.990, 0.614, 0.160, 0.094, 0.157, 0.012);
  p.box(m.redLight, -0.281, 3.047, 0.615, 0.091, 0.03, 0.092);
  for (const [i, material] of [m.wireGold, m.wireRed, m.wireGreen].entries()) {
    const d = 0.018 * i;
    p.cable(material, [[0.24+d,2.44,1.07],[0.30+d,2.32,1.0],[0.263+d,2.00,0.95],
      [0.255+d,1.29,0.95],[0.25+d,0.72,0.94],[0.16+d,0.47,0.79]], 0.009);
  }
}

function carriage(p, m) {
  for (const z of [0.72, 1.19]) {
    p.box(m.redDark, 0, -0.09, z, 0.50, 0.141, 0.194, 0.012);
    p.box(m.red, 0, 0.006, z, 0.52, 0.081, 0.195, 0.01);
  }
  for (const x of [-0.202, 0.202]) {
    p.box(m.aluminium, x, -0.034, 0.672, 0.090, 0.105, 0.925);
    p.box(m.mould, x, 0.028, 0.665, 0.083, 0.026, 0.86);
  }
  p.box(m.red, 0, -0.05, 0.384, 0.46, 0.114, 0.316, 0.013);
  for (const dx of [-0.18, -0.06, 0.06, 0.18]) {
    p.rod(m.dark, dx, 0.004, 1.294, 0.026, 0.016, 'z');
    p.rod(m.zinc, dx, 0.004, 1.305, 0.012, 0.007, 'z');
  }
  p.box(m.mould, -0.247, 0.105, 0.80, 0.190, 0.22, 0.255, 0.012);
  p.box(m.red, -0.25, 0.225, 0.80, 0.190, 0.047, 0.26);
  p.rod(m.redLight, -0.251, 0.076, 0.550, 0.061, 0.26, 'z');
  p.box(m.dark, 0.237, 0.050, 0.585, 0.126, 0.14, 0.146, 0.012);
  p.box(m.terminal, 0.248, -0.032, 0.573, 0.081, 0.035, 0.103);
  for (const [i, material] of [m.wireGold, m.wireRed, m.wireBlue].entries()) {
    const d = 0.011 * i;
    p.cable(material, [[-0.24,0.1,0.72+d],[-0.34,0.09,0.58+d],[-0.32,-0.13,0.49+d],
      [-0.15,-0.20,0.47+d],[0.20,-0.17,0.52+d],[0.252,-0.042,0.57+d]], 0.008);
  }
}

function electronics(p, m) {
  const x = -2.20, z = -0.52;
  for (const dx of [-0.305, 0.305]) {
    for (const dz of [-0.686, 0.686]) {
      p.rod(m.brass, x + dx, 0.248, z + dz, 0.027, 0.125);
      p.rod(m.zinc, x + dx, 0.327, z + dz, 0.030, 0.017);
    }
  }
  p.box(m.pcb, x, 0.310, z, 0.695, 0.031, 1.46, 0.009);
  for (let i = 0; i < 24; i++) {
    const tz = z - 0.630 + i * 0.054;
    p.box(m.terminal, x - 0.254, 0.380, tz, 0.139, 0.108, 0.051);
    p.box(m.graphite, x - 0.261, 0.438, tz, 0.066, 0.01, 0.024);
    p.box(m.brass, x - 0.319, 0.392, tz, 0.012, 0.025, 0.025);
  }
  for (let i = 0; i < 8; i++) {
    const tz = z - 0.576 + i * 0.159;
    p.box(m.mould, x - 0.055, 0.40, tz, 0.188, 0.150, 0.126, 0.009);
    p.box(m.graphite, x - 0.055, 0.477, tz, 0.126, 0.004, 0.085);
    p.box(m.label, x - 0.055, 0.480, tz + 0.019, 0.078, 0.003, 0.008);
    p.box(m.amber, x + 0.101, 0.342, tz, 0.025, 0.020, 0.023);
  }
  for (let i = 0; i < 3; i++) {
    const tz = z - 0.40 + i * 0.38;
    p.box(m.dark, x + 0.218, 0.387, tz, 0.133, 0.100, 0.268);
    for (let j = 0; j < 6; j++) {
      p.box(m.zinc, x + 0.216, 0.438, tz - 0.093 + j * 0.036, 0.070, 0.006, 0.011);
    }
  }
  for (const [i, material] of [m.wireRed, m.wireGold, m.wireBlue, m.wireGreen].entries()) {
    const d = i * 0.019;
    p.cable(material, [[x+0.24,0.40,z+0.34+d],[-1.84,0.39,z+0.39+d],[-1.71,0.24,0.11+d],
      [-0.85,0.222,0.06+d],[0.69,0.221,0.09+d],[1.41,0.245,-0.02+d],[1.56,0.48,-0.42+d],
      [1.56,0.94,-0.60+d],[1.58,beltDeck,-0.88+d]], 0.009);
    p.cable(material, [[x+0.23,0.40,z+0.02+d],[-1.81,0.34,-0.16+d],[-1.86,0.23,0.39+d],
      [-2.37,0.24,0.56+d],[-2.49,0.33,0.82+d],[-2.39,0.41,0.92+d]], 0.009);
  }
}

function marker(parent, name, x, y, z) {
  const object = new THREE.Object3D();
  object.name = name;
  object.position.set(x, y, z);
  parent.add(object);
  return object;
}

function boardSilkscreen(group) {
  if (typeof document === 'undefined') return;
  const canvas = document.createElement('canvas');
  canvas.width = 300; canvas.height = 640;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ecead2';
  ctx.font = 'bold 12px monospace';
  ctx.fillText('24V DC', 15, 25);
  ctx.font = '9px monospace';
  ctx.fillText('1', 34, 42); ctx.fillText('24', 30, 609);
  ctx.fillText('536631', 129, 623);
  for (let i = 0; i < 8; i++) ctx.fillText('K' + (i + 1), 158, 65 + i * 68);
  ctx.strokeStyle = '#afcbb0';
  ctx.lineWidth = 1.3;
  for (let i = 0; i < 8; i++) {
    const y = 69 + 67 * i;
    ctx.strokeRect(71, y - 35, 90, 54);
    ctx.beginPath(); ctx.moveTo(164, y + 18); ctx.lineTo(176, y + 18);
    ctx.lineTo(190, y + 5); ctx.lineTo(246, y + 5); ctx.stroke();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const print = new THREE.Mesh(new THREE.PlaneGeometry(0.692, 1.46),
    new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 0.85 }));
  print.rotation.x = -halfPi;
  print.position.set(-2.20, 0.327, -0.52);
  group.add(print);
}

export function createWarehouse() {
  const group = new THREE.Group();
  group.name = 'Automatisiertes Hochregallager 24V · 536631';
  const m = materials();
  const fixed = parts(group);
  table(fixed, m);
  shelves(fixed, m);
  axisDrive(fixed, m);
  conveyor(fixed, m);
  electronics(fixed, m);
  boardSilkscreen(group);
  // Five parked carriers plus the red carrier in transit make six workpieces.
  for (const [column, level, color] of [[1,2,'red'],[3,1,'blue'],[1,1,'blue'],[2,0,'white'],[3,0,'white']]) {
    carrier(fixed, m, slotX(column), slotY(level) + 0.012, rackZ, color);
  }
  fixed.finish();

  const screw = marker(group, 'Vandret gevindspindel', -1.832, 0.425, 0.970);
  const screwParts = parts(screw);
  screwParts.add(helicalThread(4.20, 0.068, 0.031, 0.065), m.redLight, 0, 0, 0);
  screwParts.finish();
  const liftMast = marker(group, 'Regalbetjeningsenhed', transferX, 0, 0);
  const mastParts = parts(liftMast);
  mast(mastParts, m);
  mastParts.finish();
  const platform = marker(liftMast, 'Løftevogn', 0, beltDeck, 0);
  const carriageParts = parts(platform);
  carriage(carriageParts, m);
  carriageParts.finish();
  const extensionRails = marker(platform, 'Mellemslæde', 0, 0, 0);
  const slides = parts(extensionRails);
  for (const dx of [-0.14, 0.14]) {
    slides.box(m.steel, dx, -0.071, 0.54, 0.078, 0.052, 0.67);
  }
  slides.finish();
  const fork = marker(platform, 'Teleskopgaffel', 0, 0, 0);
  const forkParts = parts(fork);
  for (const dx of [-0.141, 0.141]) {
    forkParts.box(m.aluminium, dx, -0.017, forkRestZ, 0.070, 0.048, 0.57, 0.008);
    forkParts.box(m.graphite, dx, -0.042, forkRestZ + 0.055, 0.09, 0.033, 0.426);
  }
  forkParts.box(m.red, 0, -0.040, forkRestZ + 0.285, 0.376, 0.094, 0.111, 0.011);
  forkParts.finish();
  const load = marker(group, 'Rød emneholder', transferX, beltDeck, outerBeltZ);
  const loadParts = parts(load);
  carrier(loadParts, m, 0, 0, 0, 'red');
  loadParts.finish();
  const treads = marker(group, 'Transportbåndets ribber', 0, 0, 0);
  const treadParts = parts(treads);
  for (let j = 0; j < 23; j++) {
    treadParts.box(m.graphite, transferX, beltDeck + 0.003, -1.58 + j * 0.061, j < 14 ? 0.402 : 0.086, 0.007, 0.010);
  }
  treadParts.finish();

  const anchors = [
    marker(group, 'Lagerreol', slotX(2.75), slotY(2) + 0.10, rackZ - 0.05),
    marker(liftMast, 'Løftemast', 0.14, 2.91, 1.01),
    marker(group, 'Transportbånd', transferX + 0.10, beltDeck + 0.10, -1.42),
    marker(group, 'I/O-kort', -2.31, 0.46, -0.70),
  ];
  function setPose({ x, y, fork: extension, belt, cargo }) {
    liftMast.position.x = slotX(3 * x);
    platform.position.y = bottomDeck + 2 * deckSpacing * y;
    fork.position.z = extension * (rackZ - forkRestZ);
    extensionRails.position.z = fork.position.z / 2;
    screw.rotation.x = -(liftMast.position.x - transferX) / 0.068 * 2 * Math.PI;
    treads.position.z = THREE.MathUtils.euclideanModulo(belt, 0.061);
    if (cargo.at === 'belt') {
      load.position.set(transferX, beltDeck + 0.010, THREE.MathUtils.lerp(outerBeltZ, rackZ, cargo.beltPosition));
    } else if (cargo.at === 'fork') {
      load.position.set(liftMast.position.x, platform.position.y + 0.010, forkRestZ + fork.position.z);
    } else {
      load.position.set(slotX(cargo.column), slotY(cargo.level) + 0.012, rackZ);
    }
  }
  return { group, setPose, anchors };
}
