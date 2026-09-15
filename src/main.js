import * as THREE from 'three';
import './style.css';

// ----------------------------------------------------------------
// カーレースシーンの土台
// - Scene / Camera / Renderer の初期化
// - ライト
// - 地面 + トラック（オーバル）
// - 簡易な車モデル（Box + Cylinderの組み合わせ）
// - キーボード操作（矢印キー / WASD）
// - 車を後方から追従するカメラ
// ----------------------------------------------------------------

const app = document.getElementById('app');

// UI（操作説明）
const info = document.createElement('div');
info.id = 'info';
info.innerHTML = '矢印キー / WASD : 走行操作<br>↑W 加速　↓S 減速・後退　←A →D ステアリング';
document.body.appendChild(info);

// --- Scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // 空の色
scene.fog = new THREE.Fog(0x87ceeb, 60, 220);

// --- Camera ---
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 6, 12);

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
app.appendChild(renderer.domElement);

// --- Lights ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(30, 40, 20);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.left = -60;
dirLight.shadow.camera.right = 60;
dirLight.shadow.camera.top = 60;
dirLight.shadow.camera.bottom = -60;
scene.add(dirLight);

// --- 地面（芝生） ---
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: 0x3a9d3a })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// --- トラック（オーバルコース） ---
// RingGeometryを地面に寝かせて、内周/外周を持つ「輪っか」状の道にする
const trackOuterRadius = 45;
const trackInnerRadius = 30;
const track = new THREE.Mesh(
  new THREE.RingGeometry(trackInnerRadius, trackOuterRadius, 64),
  new THREE.MeshStandardMaterial({ color: 0x333333, side: THREE.DoubleSide })
);
track.rotation.x = -Math.PI / 2;
track.position.y = 0.01; // 地面とのZファイティング防止
track.receiveShadow = true;
scene.add(track);

// トラック中央の芝生（内側）
const infield = new THREE.Mesh(
  new THREE.CircleGeometry(trackInnerRadius, 64),
  new THREE.MeshStandardMaterial({ color: 0x2f8f2f })
);
infield.rotation.x = -Math.PI / 2;
infield.position.y = 0.02;
infield.receiveShadow = true;
scene.add(infield);

// --- 車（簡易モデル） ---
function createCar() {
  const car = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd0342c });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.6, 4), bodyMat);
  body.position.y = 0.6;
  body.castShadow = true;
  car.add(body);

  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.8), cabinMat);
  cabin.position.set(0, 1.15, -0.2);
  cabin.castShadow = true;
  car.add(cabin);

  const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.4, 16);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const wheelOffsets = [
    [-1.1, 0.4, 1.3],
    [1.1, 0.4, 1.3],
    [-1.1, 0.4, -1.3],
    [1.1, 0.4, -1.3],
  ];
  wheelOffsets.forEach(([x, y, z]) => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, y, z);
    wheel.castShadow = true;
    car.add(wheel);
  });

  return car;
}

const car = createCar();
car.position.set(0, 0, trackOuterRadius - (trackOuterRadius - trackInnerRadius) / 2);
scene.add(car);

// --- 操作状態 ---
const keys = {};
window.addEventListener('keydown', (e) => (keys[e.key.toLowerCase()] = true));
window.addEventListener('keyup', (e) => (keys[e.key.toLowerCase()] = false));

// --- 車の走行パラメータ ---
const carState = {
  speed: 0,
  maxSpeed: 0.6,
  maxReverseSpeed: -0.25,
  acceleration: 0.015,
  friction: 0.01,
  turnSpeed: 0.035,
};

function updateCar() {
  const forward = keys['arrowup'] || keys['w'];
  const backward = keys['arrowdown'] || keys['s'];
  const left = keys['arrowleft'] || keys['a'];
  const right = keys['arrowright'] || keys['d'];

  if (forward) {
    carState.speed = Math.min(carState.speed + carState.acceleration, carState.maxSpeed);
  } else if (backward) {
    carState.speed = Math.max(carState.speed - carState.acceleration, carState.maxReverseSpeed);
  } else {
    // 自然減速
    if (carState.speed > 0) {
      carState.speed = Math.max(carState.speed - carState.friction, 0);
    } else if (carState.speed < 0) {
      carState.speed = Math.min(carState.speed + carState.friction, 0);
    }
  }

  // 速度が乗っているときだけステアリングを効かせる
  if (Math.abs(carState.speed) > 0.001) {
    const turnDirection = carState.speed > 0 ? 1 : -1;
    if (left) car.rotation.y += carState.turnSpeed * turnDirection;
    if (right) car.rotation.y -= carState.turnSpeed * turnDirection;
  }

  car.position.x += Math.sin(car.rotation.y) * carState.speed;
  car.position.z += Math.cos(car.rotation.y) * carState.speed;
}

// --- カメラ追従 ---
const cameraOffset = new THREE.Vector3(0, 4, 9);
function updateCamera() {
  const offset = cameraOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), car.rotation.y);
  const targetPos = car.position.clone().add(offset);
  camera.position.lerp(targetPos, 0.08);
  camera.lookAt(car.position.clone().add(new THREE.Vector3(0, 1, 0)));
}

// --- リサイズ対応 ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- アニメーションループ ---
function animate() {
  requestAnimationFrame(animate);
  updateCar();
  updateCamera();
  renderer.render(scene, camera);
}

animate();
