import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import './style.css';

// ----------------------------------------------------------------
// カーレースシーンの土台
// - Scene / Camera / Renderer の初期化
// - ライト
// - 地面 + トラック（オーバル）
// - GLTFモデルの車（読み込み中は簡易な箱で代用）
// - キーボード操作（矢印キー / WASD）
// - 車を後方から追従するカメラ
// ----------------------------------------------------------------

const app = document.getElementById('app');

// UI（操作説明）
const instructionsHTML =
  '矢印キー / WASD : 走行操作<br>↑W 加速　↓S 減速・後退　←A →D ステアリング';
const info = document.createElement('div');
info.id = 'info';
info.innerHTML = instructionsHTML;
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

// --- 車 ---
// car : 位置・回転を操作する「ピボット」。走行ロジックはこのGroupに対して行う。
// 実際に見える3Dモデルは読み込み完了後にこの子として追加する。
const car = new THREE.Group();
car.position.set(0, 0, trackOuterRadius - (trackOuterRadius - trackInnerRadius) / 2);
scene.add(car);

// モデル読み込み中に表示しておく仮の箱
const placeholder = new THREE.Mesh(
  new THREE.BoxGeometry(2, 0.6, 4),
  new THREE.MeshStandardMaterial({ color: 0xd0342c })
);
placeholder.position.y = 0.6;
placeholder.castShadow = true;
car.add(placeholder);

// --- 車モデル読み込み（GLTF / GLB） ---
const CAR_MODEL_URL = '/GTR.glb';
// モデルによって単位・正面の向きが異なるため、読み込み後に見た目を見ながら調整する
const CAR_MODEL_SCALE = 1;
const CAR_MODEL_ROTATION_Y = 0; // 正面が逆を向いていたら Math.PI や ±Math.PI/2 等に調整

const gltfLoader = new GLTFLoader();
gltfLoader.load(
  CAR_MODEL_URL,
  (gltf) => {
    car.remove(placeholder);

    const model = gltf.scene;
    model.scale.setScalar(CAR_MODEL_SCALE);
    model.rotation.y = CAR_MODEL_ROTATION_Y;
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    car.add(model);
    info.innerHTML = instructionsHTML;
  },
  (progress) => {
    if (progress.total) {
      const percent = ((progress.loaded / progress.total) * 100).toFixed(0);
      info.innerHTML = `車モデル読み込み中... ${percent}%`;
    }
  },
  (error) => {
    console.error('車モデルの読み込みに失敗しました:', error);
    info.innerHTML = '車モデルの読み込みに失敗しました（コンソールを確認してください）';
  }
);

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
// 車の前進方向は +Z（updateCarの position 更新式より）なので、
// 追従カメラは車の背後＝ -Z 側に置く
const cameraOffset = new THREE.Vector3(0, 4, -9);
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
