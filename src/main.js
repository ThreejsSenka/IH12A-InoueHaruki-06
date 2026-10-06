import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createMenu } from './menu.js';
import { createStartGantry } from './startGantry.js';
import { createBgm } from './bgm.js';
import './style.css';

// ----------------------------------------------------------------
// カーレースシーンの土台
// - Scene / Camera / Renderer の初期化（青空の日中シーン）
// - 無限に続くコンクリートの地面 + うねりのあるレースサーキット
// - GLTFモデルの車（読み込み中は簡易な箱で代用、タイヤは回転）
// - エンジン音（速度に応じてピッチ変化）
// - キーボード操作（矢印キー / WASD、Shiftでブースト）
// - 車を追従し、右クリックドラッグで見回せる・ホイールで寄れるカメラ
// - グリップの限界がある走行モデル（速すぎるとコーナーで外に膨らむ）と車体のロール/ピッチ
// - 出力・空気抵抗・ブレーキ力から加減速を計算する走行モデル（ペダルはじわっと踏み込む）
// - ブレーキランプ、BGM（タイトル用・走行用）
// - 速度のHUD表示
// - タイムアタック（カウントダウン、ラップ計測、チェックポイント、ベストラップ保存、Rでリスタート）
// - タイトル画面（車のショールーム演出）と一時停止メニュー（Esc）
//
// 画面の流れ（raceState.phase）:
//   'menu'（タイトル）→ 'countdown' → 'racing' ⇄ 'paused'（一時停止）→ 'menu' に戻ることもできる
// ----------------------------------------------------------------

const app = document.getElementById('app');

// 速度表示（HUD）。タイトル画面では隠し、走行中だけ表示する
const speedDisplay = document.createElement('div');
speedDisplay.id = 'speed-display';
speedDisplay.hidden = true;
document.body.appendChild(speedDisplay);

// タイムアタック用HUD（画面上部中央：ラップ数・現在タイム・前回/ベスト）
const raceHud = document.createElement('div');
raceHud.id = 'race-hud';
raceHud.hidden = true;
raceHud.innerHTML = `
  <div class="race-lap"></div>
  <div class="race-time"></div>
  <div class="race-sub">
    <span>LAST <b class="race-last"></b></span>
    <span>BEST <b class="race-best"></b></span>
  </div>
  <div class="race-warning" hidden>コースアウト</div>
`;
document.body.appendChild(raceHud);
const raceLapEl = raceHud.querySelector('.race-lap');
const raceTimeEl = raceHud.querySelector('.race-time');
const raceLastEl = raceHud.querySelector('.race-last');
const raceBestEl = raceHud.querySelector('.race-best');
const raceWarningEl = raceHud.querySelector('.race-warning');

// 画面中央のメッセージ（カウントダウン、ラップタイム、NEW RECORD など）
const raceMessage = document.createElement('div');
raceMessage.id = 'race-message';
raceMessage.hidden = true;
document.body.appendChild(raceMessage);

// タイトル画面・一時停止メニュー（各ボタンの処理は下の「画面の切り替え」で定義）
// BGM（タイトル画面用・走行中用）
const bgm = createBgm();

const menu = createMenu({
  formatTime,
  onStart: () => startGame(),
  onResume: () => resumeGame(),
  onRestart: () => restartFromPause(),
  onQuit: () => quitToTitle(),
  onResetBest: () => resetBestLap(),
});

// --- Scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // 日中の青空
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
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
app.appendChild(renderer.domElement);

// --- 環境マップ ---
// 車体塗装・クローム・ガラスなどの金属/反射マテリアルは、映り込む「周囲の環境」がないと
// 黒くのっぺり見えてしまう。three.js組み込みのスタジオ風環境（RoomEnvironment）を反射用に使う。
// （背景の青空はそのまま。environmentは照明・反射にだけ使われる）
const pmremGenerator = new THREE.PMREMGenerator(renderer);
const environmentTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = environmentTexture;
pmremGenerator.dispose();

// 斜めから見たテクスチャのちらつき（モアレ）・遠景のぼやけを抑える異方性フィルタリングの最大値
const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

// --- Lights ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
scene.add(ambientLight);

// 太陽光。影を計算する範囲（shadow.camera）は有限なので、光源ごと車に追従させて
// 常に車の周囲に影が落ちるようにする（updateSunLight を毎フレーム呼ぶ）
const SUN_OFFSET = new THREE.Vector3(30, 40, 20);
const SHADOW_RANGE = 25; // 車を中心に影を描く範囲(m)。狭いほど影がくっきりする

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.left = -SHADOW_RANGE;
dirLight.shadow.camera.right = SHADOW_RANGE;
dirLight.shadow.camera.top = SHADOW_RANGE;
dirLight.shadow.camera.bottom = -SHADOW_RANGE;
dirLight.shadow.normalBias = 0.02; // 影のギザギザ（シャドウアクネ）対策
scene.add(dirLight);
scene.add(dirLight.target);

// --- 地面（無限に続くコンクリート） ---
// 外部テクスチャファイルを使わず、Canvasでコンクリート風のテクスチャを生成して敷き詰める
function createConcreteTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // ベースカラー
  ctx.fillStyle = '#7c7c7c';
  ctx.fillRect(0, 0, size, size);

  // ノイズで質感を出す
  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const shade = 100 + Math.random() * 80;
    ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade}, 0.15)`;
    ctx.fillRect(x, y, 1, 1);
  }

  // スラブの継ぎ目（目地）ライン
  ctx.strokeStyle = 'rgba(50, 50, 50, 0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const GROUND_SIZE = 4000; // 十分に大きく取ることで「無限に続く」ように見せる
const GROUND_TILE_SIZE = 20; // テクスチャ1タイルが表す実寸(m)相当

// 地面・コースへの環境マップの映り込みの強さ。
// scene.environment のままだと全マテリアル共通の強さになり、地面が白く飛んでしまうため、
// 地面・コースだけ envMap を明示的に指定して弱める（envMapIntensity は envMap 指定時のみ有効）
const GROUND_ENV_INTENSITY = 0.25;

const concreteTexture = createConcreteTexture();
concreteTexture.repeat.set(GROUND_SIZE / GROUND_TILE_SIZE, GROUND_SIZE / GROUND_TILE_SIZE);
concreteTexture.anisotropy = maxAnisotropy;

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
  new THREE.MeshStandardMaterial({
    map: concreteTexture,
    envMap: environmentTexture,
    envMapIntensity: GROUND_ENV_INTENSITY,
  })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// --- レースサーキット（コンクリートの地面の上に敷く、うねったコース） ---
// 縁石・白線・センターラインを描いたテクスチャを、コースの長さ方向に繰り返し貼り付ける
function createTrackTexture() {
  const width = 128; // コース方向（繰り返しでタイル状に）
  const height = 256; // コース幅方向（片側→反対側で1回だけ使う）
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // アスファルト
  ctx.fillStyle = '#2b2b2b';
  ctx.fillRect(0, 0, width, height);

  // 縁石（両端、赤/白のチェッカー模様）
  const curbHeight = height * 0.05;
  const curbBlocks = 8;
  for (let i = 0; i < curbBlocks; i++) {
    const x = (width / curbBlocks) * i;
    ctx.fillStyle = i % 2 === 0 ? '#d0342c' : '#f2f2f2';
    ctx.fillRect(x, 0, width / curbBlocks, curbHeight);
    ctx.fillRect(x, height - curbHeight, width / curbBlocks, curbHeight);
  }

  // 両端の白線
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(0, curbHeight, width, 4);
  ctx.fillRect(0, height - curbHeight - 4, width, 4);

  // 中央の破線（センターライン）
  ctx.fillRect(0, height / 2 - 3, width * 0.55, 6);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// コースの中心線を生成する。
// 長い直線2本を、両端の大きな半円（半径150m）でつないだ高速コース。上側の直線には浅く長いS字を入れている。
// カーブは「両端の大きな回り込み2つ＋ゆるいS字」だけで、最もきつい所でも曲率半径は約98m。
// （全長約1,745m。両端の半円は点を細かく置かないとスプラインが円弧の入口で急に曲がるため、7点で表す）
function generateCircuitCurve() {
  const END_RADIUS = 150;
  const END_CENTER_X = 200;

  // 中心(cx, cz)・半径 r の円弧上に、fromDeg から toDeg まで等間隔に count 個の点を並べる
  const arcPoints = (cx, cz, r, fromDeg, toDeg, count) =>
    Array.from({ length: count }, (_, i) => {
      const angle = THREE.MathUtils.degToRad(fromDeg + ((toDeg - fromDeg) * i) / (count - 1));
      return [cx + Math.cos(angle) * r, cz + Math.sin(angle) * r];
    });

  const points = [
    [-100, -150], [100, -150], // 下側の直線（スタート/フィニッシュライン）
    ...arcPoints(END_CENTER_X, 0, END_RADIUS, -90, 90, 7), // 右端の大きなカーブ
    [100, 150], [0, 132], [-100, 150], // 上側の直線にある浅いS字
    ...arcPoints(-END_CENTER_X, 0, END_RADIUS, 90, 270, 7), // 左端の大きなカーブ
  ];

  return new THREE.CatmullRomCurve3(
    points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    'centripetal' // 制御点の間隔が不均一でも膨らみ・尖りが出にくい補間
  );
}

// コースの中心線（Curve）に沿って、一定幅のリボン状ジオメトリを生成する
function buildTrackGeometry(curve, trackWidth, segments, tileLength) {
  const halfWidth = trackWidth / 2;
  const up = new THREE.Vector3(0, 1, 0);
  const pathLength = curve.getLength();
  const uRepeat = Math.max(1, Math.round(pathLength / tileLength));

  const positions = [];
  const uvs = [];
  const indices = [];

  // 周の終わり（i = segments）には始点と同じ位置の頂点をもう一組置き、u だけ uRepeat にする。
  // 終点の頂点を始点（u = 0）と共有すると、最後の1区間で u が uRepeat → 0 と一気に戻り、
  // その区間にテクスチャが数百回分詰め込まれてボケた帯になってしまうため
  // （uRepeat は整数なので、u = uRepeat と u = 0 はテクスチャ上で同じ位置になり継ぎ目は出ない）
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const curveT = i === segments ? 0 : t;
    const point = curve.getPointAt(curveT);
    const tangent = curve.getTangentAt(curveT).normalize();
    const right = new THREE.Vector3().crossVectors(tangent, up).normalize();

    const left = point.clone().addScaledVector(right, -halfWidth);
    const rightEdge = point.clone().addScaledVector(right, halfWidth);
    left.y = 0.03;
    rightEdge.y = 0.03;

    positions.push(left.x, left.y, left.z, rightEdge.x, rightEdge.y, rightEdge.z);

    const u = t * uRepeat;
    uvs.push(u, 0, u, 1);
  }

  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2;
    const d = (i + 1) * 2 + 1;
    indices.push(a, c, b, b, c, d);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const TRACK_WIDTH = 15;
const TRACK_SEGMENTS = 400; // コース中心線の分割数（全長約1,745m → 約4.4mごと）
const TRACK_TILE_LENGTH = 5; // テクスチャ1タイルが表す実寸(m)相当

const circuitCurve = generateCircuitCurve();
const trackTexture = createTrackTexture();
trackTexture.anisotropy = maxAnisotropy;
const trackGeometry = buildTrackGeometry(circuitCurve, TRACK_WIDTH, TRACK_SEGMENTS, TRACK_TILE_LENGTH);

const track = new THREE.Mesh(
  trackGeometry,
  new THREE.MeshStandardMaterial({
    map: trackTexture,
    side: THREE.DoubleSide,
    envMap: environmentTexture,
    envMapIntensity: GROUND_ENV_INTENSITY,
  })
);
track.receiveShadow = true;
scene.add(track);

// --- コース上の位置判定用データ ---
// コース中心線を一定間隔でサンプリングしておき、車に最も近いサンプルの番号で
// 「コースのどこまで進んだか」と「中心線からどれだけ離れているか（コースアウト判定）」を求める
const trackLength = circuitCurve.getLength();
const trackSamples = [];
for (let i = 0; i < TRACK_SEGMENTS; i++) {
  trackSamples.push(circuitCurve.getPointAt(i / TRACK_SEGMENTS));
}

function findNearestTrackSample(position) {
  let nearestIndex = 0;
  let nearestDistanceSq = Infinity;
  for (let i = 0; i < trackSamples.length; i++) {
    const dx = trackSamples[i].x - position.x;
    const dz = trackSamples[i].z - position.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < nearestDistanceSq) {
      nearestDistanceSq = distanceSq;
      nearestIndex = i;
    }
  }
  return { index: nearestIndex, distance: Math.sqrt(nearestDistanceSq) };
}

// --- スタート/フィニッシュライン（コースの t=0 地点に白黒チェッカーを敷く） ---
function createCheckerTexture() {
  const columns = 16;
  const rows = 2;
  const cell = 16;
  const canvas = document.createElement('canvas');
  canvas.width = columns * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#f2f2f2' : '#111111';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.anisotropy = maxAnisotropy;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const finishPoint = circuitCurve.getPointAt(0);
const finishTangent = circuitCurve.getTangentAt(0).normalize();
const finishLine = new THREE.Group();
finishLine.position.set(finishPoint.x, 0.04, finishPoint.z);
// Groupの前方(+Z)をコースの進行方向に合わせると、Groupの X 軸がコースを横切る向きになる
finishLine.rotation.y = Math.atan2(finishTangent.x, finishTangent.z);
const finishLineMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(TRACK_WIDTH, 2),
  new THREE.MeshStandardMaterial({
    map: createCheckerTexture(),
    envMap: environmentTexture,
    envMapIntensity: GROUND_ENV_INTENSITY,
  })
);
finishLineMesh.rotation.x = -Math.PI / 2;
finishLineMesh.receiveShadow = true;
finishLine.add(finishLineMesh);

// スタート/フィニッシュラインのゲート（鉄骨の柱・看板・スタートシグナル）
const startGantry = createStartGantry({ trackWidth: TRACK_WIDTH, maxAnisotropy });
finishLine.add(startGantry.group);
scene.add(finishLine);

// --- チェックポイント ---
// コースを4つの区間に分け、区間の境目（1/4, 2/4, 3/4地点）を順番に通過しないと
// ラップとして認めない（ショートカットや逆走でのラップ成立を防ぐ）
const CHECKPOINT_INDICES = [0.25, 0.5, 0.75].map((ratio) => Math.round(TRACK_SEGMENTS * ratio));
const CHECKPOINT_WINDOW = 15; // チェックポイントとみなすサンプル数の幅（約1/20周）
const CHECKPOINT_MAX_DISTANCE = TRACK_WIDTH; // 中心線からこの距離以内なら通過扱い（多少のはみ出しは許容）

// --- 車 ---
// car : 位置・回転を操作する「ピボット」。走行ロジックはこのGroupに対して行う。
// 実際に見える3Dモデルは読み込み完了後にこの子として追加する。
const car = new THREE.Group();
scene.add(car);

// スタートラインの手前（グリッド）に、コースの進行方向を向けて配置する。
// 手前に置くことで、追従カメラから正面のゲートとスタートシグナルが見える。
// スタート直後の最初のライン通過は周回として数えない（raceState.startLineCrossed）
const SPAWN_OFFSET = -10; // スタートラインからの距離(m)。マイナスはラインの手前

function placeCarAtStart() {
  const t = (((SPAWN_OFFSET / trackLength) % 1) + 1) % 1; // 0〜1 の範囲に収める
  const point = circuitCurve.getPointAt(t);
  const tangent = circuitCurve.getTangentAt(t).normalize();
  car.position.set(point.x, 0, point.z);
  car.rotation.y = Math.atan2(tangent.x, tangent.z);
}
placeCarAtStart();

// モデル読み込み中に表示しておく仮の箱
const placeholder = new THREE.Mesh(
  new THREE.BoxGeometry(2, 0.6, 4),
  new THREE.MeshStandardMaterial({ color: 0xd0342c })
);
placeholder.position.y = 0.6;
placeholder.castShadow = true;
car.add(placeholder);

// タイヤ回転用：読み込んだモデルのうち元の名前が "Wheel." で始まるノードを保持する
// （GTR.glb のノード構成: Wheel.Bk.L / Wheel.Bk.R / Wheel.Ft.L / Wheel.Ft.R）
// ※ GLTFLoader は node.name から "." を取り除く（例: "WheelBkL"）ため、
//   元の名前が残っている userData.name で判定する
const wheels = [];
const WHEEL_RADIUS = 0.36; // GTR.glb のタイヤメッシュの実寸（バウンディングボックスより）

// --- 前輪の操舵（ハンドルを切るとタイヤが左右に向く） ---
// 実車の GT-R（R35）は前輪だけで曲がる（スカイラインGT-R R32〜R34 にあった後輪操舵 HICAS は付いていない）。
// 最小回転半径は約5.7m、ホイールベースは約2.78m なので、前輪の最大の切れ角は約30°になる。
// 曲がるときは内側のタイヤほど大きく切れる（アッカーマン・ジオメトリー：左右の前輪が同じ点を中心に回る）
const STEER_MAX_ANGLE = THREE.MathUtils.degToRad(30); // 前輪の最大の切れ角（左右の平均）
const STEER_RESPONSE = 0.18; // ハンドルを中央から目いっぱいまで切るのにかかる秒数
const WHEELBASE = 2.76; // GTR.glb の前後輪の間隔（m）
// 前輪ごとの「操舵の軸」（タイヤの中心を通る縦の軸）。タイヤとブレーキキャリパーを子にして一緒に向きを変える
// side: +1 = 左の前輪（車の +X 側）、-1 = 右の前輪
const steeringPivots = [];

// 読み込んだ車モデル本体。加減速・コーナリングで車体を傾ける（ロール/ピッチ）のに使う
let carModel = null;

// --- 車モデル読み込み（GLTF / GLB） ---
const CAR_MODEL_URL = '/GTR.glb';
// モデルによって単位・正面の向きが異なるため、読み込み後に見た目を見ながら調整する
const CAR_MODEL_SCALE = 1;
const CAR_MODEL_ROTATION_Y = 0; // 正面が逆を向いていたら Math.PI や ±Math.PI/2 等に調整

// Blenderから書き出した際に色が失われたマテリアルを、名前指定で補正する
// （CarpaintMetallicGoldenYellow はホイールの色だが、glTFに色が書き出されず白になっていた）
const MATERIAL_OVERRIDES = {
  CarpaintMetallicGoldenYellow: { color: 0xc8962a, metalness: 1.0, roughness: 0.3 },
};

// --- ブレーキランプ ---
// GTR.glb のテールランプは、内側の発光部品 "taillight"（細い自発光パーツ）と、
// それを覆う透明なレンズ "PlasticGlassRed" でできている。
// 内側の部品だけ光らせてもレンズ越しではほとんど見えないため、レンズ自体も赤く自発光させて
// ランプ全体が光って見えるようにする（普段は尾灯として控えめに、ブレーキ中は強く）。
// あわせて車の後ろに赤いライトを置き、ブレーキ中は路面がほんのり赤く照らされるようにする
const TAILLIGHT_MATERIAL_NAME = 'taillight';
const TAILLIGHT_LENS_MATERIAL_NAME = 'PlasticGlassRed';
const TAILLIGHT_COLOR = 0xff1a0a;
const TAILLIGHT_INTENSITY = 0.8; // 内側の発光部品：尾灯（ブレーキを踏んでいないとき）
const BRAKE_LIGHT_INTENSITY = 7; // 内側の発光部品：ブレーキ時
const LENS_TAIL_INTENSITY = 0.35; // レンズ：尾灯
const LENS_BRAKE_INTENSITY = 4; // レンズ：ブレーキ時
const BRAKE_GLOW_INTENSITY = 6;
let taillightMaterial = null;
let taillightLensMaterial = null;

const brakeGlow = new THREE.PointLight(0xff1a0a, 0, 5, 2);
brakeGlow.position.set(0, 0.45, -2.5); // 車の後端（テールランプのすぐ後ろ）
car.add(brakeGlow);

function updateBrakeLights() {
  const brake = carState.brake;
  if (taillightMaterial) {
    taillightMaterial.emissiveIntensity =
      TAILLIGHT_INTENSITY + (BRAKE_LIGHT_INTENSITY - TAILLIGHT_INTENSITY) * brake;
  }
  if (taillightLensMaterial) {
    taillightLensMaterial.emissiveIntensity =
      LENS_TAIL_INTENSITY + (LENS_BRAKE_INTENSITY - LENS_TAIL_INTENSITY) * brake;
  }
  brakeGlow.intensity = BRAKE_GLOW_INTENSITY * brake;
}

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

        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
          if (material.name === TAILLIGHT_MATERIAL_NAME) taillightMaterial = material;
          if (material.name === TAILLIGHT_LENS_MATERIAL_NAME) {
            taillightLensMaterial = material;
            material.emissive.set(TAILLIGHT_COLOR);
          }
          const override = MATERIAL_OVERRIDES[material.name];
          if (!override) return;
          material.color.set(override.color);
          material.metalness = override.metalness;
          material.roughness = override.roughness;
        });
      }
      if (child.userData.name && child.userData.name.startsWith('Wheel.')) {
        wheels.push(child);
      }
    });

    // 前輪（Wheel.Ft.L / Wheel.Ft.R）とそのブレーキキャリパー（WheelBrake.Ft.*）を、
    // タイヤの中心に置いた操舵用の Group の子に付け替える。
    // タイヤ自体の回転（転がり）と、操舵の軸まわりの向きの変化を分けて扱えるようにするため
    model.updateMatrixWorld(true);
    const findByName = (name) => {
      let found = null;
      model.traverse((child) => {
        if (child.userData.name === name) found = child;
      });
      return found;
    };
    for (const [suffix, side] of [['L', 1], ['R', -1]]) {
      const wheel = findByName(`Wheel.Ft.${suffix}`);
      if (!wheel) continue;
      const pivot = new THREE.Group();
      pivot.position.copy(wheel.position);
      wheel.parent.add(pivot);
      pivot.updateMatrixWorld(true);
      pivot.attach(wheel); // attach は見た目の位置・向きを保ったまま親を付け替える
      const caliper = findByName(`WheelBrake.Ft.${suffix}`);
      if (caliper) pivot.attach(caliper);
      steeringPivots.push({ pivot, side, halfTrack: Math.abs(wheel.position.x) });
    }

    car.add(model);
    carModel = model;
    menu.setReady();
  },
  (progress) => {
    menu.setLoading(progress.total ? Math.round((progress.loaded / progress.total) * 100) : null);
  },
  (error) => {
    console.error('車モデルの読み込みに失敗しました:', error);
    // 仮の箱の車のままでも遊べるようにスタートは押せるようにする
    menu.setReady('車のモデルを読み込めませんでした。仮の車で走行します。');
  }
);

// 前輪の切れ角を更新する（delta: 経過秒数）
function updateSteering(delta) {
  // キー入力（-1〜1）に、ハンドルを回す時間ぶん遅れて追いつく
  carState.steerAngle = approach(carState.steerAngle, carState.steerInput, STEER_RESPONSE, delta);
  if (steeringPivots.length === 0) return;

  // 速いほど小さくしか切らない（走行モデルのハンドルの効きと同じ割合）。止まっていても切れる
  const highSpeedFactor = 1 / (1 + Math.abs(carState.speed) * carState.steerSpeedFalloff);
  const angle = carState.steerAngle * STEER_MAX_ANGLE * highSpeedFactor; // +で左に切る

  steeringPivots.forEach(({ pivot, side, halfTrack }) => {
    if (Math.abs(angle) < 1e-4) {
      pivot.rotation.y = 0;
      return;
    }
    // 旋回の中心（後輪の車軸の延長線上）までの距離から、各タイヤの切れ角を求める
    const turnRadius = WHEELBASE / Math.tan(Math.abs(angle));
    const isInner = Math.sign(angle) === side; // 左に曲がるときは左の前輪が内側
    const wheelRadius = turnRadius + (isInner ? -halfTrack : halfTrack);
    pivot.rotation.y = Math.sign(angle) * Math.atan(WHEELBASE / wheelRadius);
  });
}

function updateWheels(step) {
  if (wheels.length === 0) return;
  // 進んだ距離をタイヤの回転角に変換（円周 = 2π×半径）
  const rotationDelta = (carState.speed * step) / WHEEL_RADIUS;
  wheels.forEach((wheel) => {
    // タイヤノードはY軸まわりに90°回転して配置されており、車軸（タイヤの厚み方向）は
    // ノードのローカルZ軸＝車の左右方向(X)にあたる。ローカルZ軸まわりに回すと転がる。
    // rotation.z を直接いじると既存の90°回転と干渉するため、rotateZ でローカル軸回転させる。
    wheel.rotateZ(rotationDelta);
  });
}

// --- エンジン音 ---
// 短いループ音源を繰り返し再生し、速度に応じて再生速度（＝音の高さ）と音量を変えて回転数の変化を表現する。
// タイトル画面の START を押したときに鳴り始め、一時停止中は止まり、タイトルに戻ると消える。
//
// 音源（クレジットは README.md にも記載）:
//   "Generic V8 Engine Sound" by DerMeehdrescher（OpenGameArt.org, CC BY-SA 4.0）
//   https://opengameart.org/content/generic-v8-engine-sound の Acc_05570.wav をモノラル化・音量調整して使用
const audioListener = new THREE.AudioListener();
camera.add(audioListener);

const engineSound = new THREE.Audio(audioListener);
const ENGINE_SOUND_URL = '/sounds/engine-generic-v8.wav';
const ENGINE_MIN_PLAYBACK_RATE = 0.76; // 停車中（アイドリング）の音の高さ
const ENGINE_MAX_PLAYBACK_RATE = 2.09; // ブースト最高速時の音の高さ

// エンジンが「かかっている」べき状態か（音源の読み込みが START より遅れた場合に、読み込み後に鳴らすため）
let engineRunning = false;

// START ボタンのクリック（＝ユーザー操作）の中から呼ぶ。
// ページ読み込み時に作られた AudioContext は「一時停止」状態で始まるため、
// ユーザー操作のタイミングで再開しないと音が出ない（Chrome等の自動再生ポリシー）
function startEngineSound() {
  audioListener.context.resume();
  engineRunning = true;
  if (engineSound.buffer && !engineSound.isPlaying) engineSound.play();
}

function stopEngineSound() {
  engineRunning = false;
  if (engineSound.isPlaying) engineSound.stop();
}

// 一時停止：再生位置を保ったまま止める
function pauseEngineSound() {
  if (engineSound.isPlaying) engineSound.pause();
}

function resumeEngineSound() {
  if (engineRunning && engineSound.buffer && !engineSound.isPlaying) engineSound.play();
}

const audioLoader = new THREE.AudioLoader();
audioLoader.load(
  ENGINE_SOUND_URL,
  (buffer) => {
    engineSound.setBuffer(buffer);
    engineSound.setLoop(true);
    engineSound.setVolume(0.4);
    if (engineRunning && raceState.phase !== 'paused') engineSound.play();
  },
  undefined,
  (error) => {
    console.warn(`エンジン音（${ENGINE_SOUND_URL}）の読み込みに失敗しました:`, error);
  }
);

function updateEngineSound() {
  if (!engineSound.isPlaying) return;
  const speedRatio = Math.min(Math.abs(carState.speed) / ENGINE_SOUND_TOP_SPEED, 1);
  const playbackRate =
    ENGINE_MIN_PLAYBACK_RATE + speedRatio * (ENGINE_MAX_PLAYBACK_RATE - ENGINE_MIN_PLAYBACK_RATE);
  engineSound.setPlaybackRate(playbackRate);
  engineSound.setVolume(0.35 + speedRatio * 0.35);
}

// --- 操作状態（キーボード） ---
const keys = {};
window.addEventListener('keydown', (e) => (keys[e.key.toLowerCase()] = true));
window.addEventListener('keyup', (e) => (keys[e.key.toLowerCase()] = false));

// --- 操作状態（マウス右クリックドラッグでカメラ回転、ホイールでズーム） ---
let isRightDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;
const MOUSE_SENSITIVITY = 0.005;
const ZOOM_SPEED = 0.01;

// 右クリックのブラウザ標準コンテキストメニューを無効化
window.addEventListener('contextmenu', (e) => e.preventDefault());

renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button === 2) {
    isRightDragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }
});

window.addEventListener('mousemove', (e) => {
  if (!isRightDragging) return;
  const deltaX = e.clientX - lastMouseX;
  const deltaY = e.clientY - lastMouseY;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;

  cameraYaw -= deltaX * MOUSE_SENSITIVITY;
  cameraPitch = THREE.MathUtils.clamp(
    cameraPitch - deltaY * MOUSE_SENSITIVITY,
    CAMERA_MIN_PITCH,
    CAMERA_MAX_PITCH
  );
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 2) isRightDragging = false;
});

// ウィンドウ外にドラッグしたまま出た場合の保険
window.addEventListener('blur', () => {
  isRightDragging = false;
});

renderer.domElement.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    cameraDistance = THREE.MathUtils.clamp(
      cameraDistance + e.deltaY * ZOOM_SPEED,
      CAMERA_MIN_DISTANCE,
      CAMERA_MAX_DISTANCE
    );
  },
  { passive: false }
);

// --- 車の走行パラメータ ---
// 各値は「60fpsでの1フレームあたり」の量。実際の更新では経過時間に応じた倍率(step)を掛けるので、
// モニターのリフレッシュレートが違っても同じ速さで走る（タイムアタックの公平性のため）
// 速度の単位は「m/フレーム（60fps換算）」なので、1.0 = 60m/s = 216km/h
const carState = {
  speed: 0, // 前後方向の速度（+で前進、-で後退）
  lateralSpeed: 0, // 横方向の速度（+で車の左側へ、-で右側へ滑っている）
  // ペダルの踏み込み量（0〜1）。キーは押す/離すの2択なので、実際のペダルのように徐々に変化させる
  throttle: 0,
  brake: 0,
  boostBlend: 0, // ブーストの効き具合（0〜1。Shiftで徐々に出力が上がる）
  steerInput: 0, // ハンドルのキー入力（+1 = 左、-1 = 右）
  steerAngle: 0, // 実際のハンドルの切れ具合（-1〜1。キー入力に少し遅れて追いつく）
  turnSpeed: 0.035, // ハンドルを切ったときの最大の向き変化（rad/フレーム）
  fullSteerSpeed: 0.15, // この速度未満ではハンドルの効きが弱まる（停止中はその場で旋回しない）
  steerSpeedFalloff: 2.5, // 高速になるほどハンドルの効きを穏やかにする係数（高速域でのふらつき防止）
  // --- グリップ（タイヤが横方向に踏ん張れる限界） ---
  // 1フレームで打ち消せる横滑り速度の上限。0.005 ≒ 横G 1.8g 相当。
  // コーナーを曲がり切れる最高速度は √(グリップ × 半径) で決まるので、きついコーナーほど減速が必要になる
  gripLimit: 0.01,
  offTrackGripMultiplier: 0.8, // コース外（コンクリート）ではグリップが落ちる
  maxSlipAngle: 0.25, // 車体の向きと進行方向のずれ（スリップアングル）の上限（約14°）。スピンを防ぐ
  slideScrub: 0.1, // 横滑り中にタイヤが擦れて失う速度の割合
  // 車体の傾き表現用（直近フレームの加速度）
  lateralAccel: 0,
  longitudinalAccel: 0,
};

// 速度(m/フレーム)を km/h に変換する倍率（60フレーム/秒 × 3.6）
const SPEED_DISPLAY_SCALE = 60 * 3.6;
// 速度(m/フレーム)を m/s に変換する倍率
const FRAME_TO_MPS = 60;

// --- 前後方向の走行モデル（実車に近い加減速） ---
// 加速度(m/s²) = 駆動力 − 空気抵抗 − 転がり抵抗 − エンジンブレーキ − ブレーキ
// - 駆動力は「出力 ÷ 速度」（速いほど伸びが鈍る）。低速ではタイヤのグリップが上限になる
// - 空気抵抗は速度の2乗に比例するので、最高速には徐々に近づいていき、いきなり頭打ちにはならない
// 数値は GT-R（約600馬力・1.7t・4WD）の 0-100km/h 約3秒・最高速 約300km/h を目安にしている
const DRIVE = {
  normalPower: 90, // 通常時の出力÷車重（W/kg）。0-100km/h 約5秒、最高速 約210km/h
  boostPower: 250, // Shift（ブースト）時。0-100km/h 約3秒、最高速 約300km/h
  tractionLimit: 9, // 4WDのタイヤが路面に伝えられる加速度の上限（m/s² ≒ 0.9G）
  dragCoefficient: 4.1e-4, // 空気抵抗（加速度 = 係数 × 速度²）
  rollingResistance: 0.15, // 転がり抵抗（m/s²）
  engineBraking: 1.2, // アクセルを離したときのエンジンブレーキ（m/s²）
  brakeDeceleration: 11, // フルブレーキ（m/s² ≒ 1.1G）。250km/h → 100km/h に約170m
  offTrackResistance: 0.3, // コース外（芝・砂利の代わり）の抵抗（加速度 = 係数 × 速度）
  reverseAcceleration: 4, // バックの加速度（m/s²）
  reverseMaxSpeed: 7, // バックの最高速（m/s ≒ 25km/h）
  // ペダル・ブーストが 0→1（1→0）になるまでの秒数
  throttleRise: 0.25,
  throttleFall: 0.12,
  brakeRise: 0.15,
  brakeFall: 0.1,
  boostRise: 0.5,
  boostFall: 0.8,
};
// エンジン音のピッチ計算に使う最高速（ブースト時の最高速 約300km/h）
const ENGINE_SOUND_TOP_SPEED = 84 / FRAME_TO_MPS;

// value を target に向けて、1秒あたり 1/seconds の速さで近づける
function approach(value, target, seconds, dt) {
  const maxChange = dt / seconds;
  return value + THREE.MathUtils.clamp(target - value, -maxChange, maxChange);
}

// 車の前方向・左方向のベクトル（毎フレーム使い回す）
const carForward = new THREE.Vector3();
const carLeft = new THREE.Vector3();
const carVelocity = new THREE.Vector3();

function updateCarAxes() {
  const heading = car.rotation.y;
  carForward.set(Math.sin(heading), 0, Math.cos(heading));
  carLeft.set(Math.cos(heading), 0, -Math.sin(heading));
}

// 車の向きを変えても、慣性で「進んでいる方向（ワールド座標の速度）」はそのまま残る。
// 向きを変えた後の前後・左右の成分に分解し直す
function rotateCarKeepingVelocity(angle) {
  updateCarAxes();
  carVelocity
    .copy(carForward)
    .multiplyScalar(carState.speed)
    .addScaledVector(carLeft, carState.lateralSpeed);
  car.rotation.y += angle;
  updateCarAxes();
  carState.speed = carVelocity.dot(carForward);
  carState.lateralSpeed = carVelocity.dot(carLeft);
}

function updateCar(step, controlsEnabled) {
  const forward = controlsEnabled && (keys['arrowup'] || keys['w']);
  const backward = controlsEnabled && (keys['arrowdown'] || keys['s']);
  const left = controlsEnabled && (keys['arrowleft'] || keys['a']);
  const right = controlsEnabled && (keys['arrowright'] || keys['d']);
  const boosting = controlsEnabled && keys['shift'];
  const safeStep = Math.max(step, 1e-6);

  // --- 1. 前後方向（駆動力・空気抵抗・ブレーキ。計算は m/s 単位で行う） ---
  const speedBefore = carState.speed;
  const dt = step / 60; // 経過秒数
  let velocity = carState.speed * FRAME_TO_MPS;

  // 前進中に↓/Sでブレーキ、ほぼ止まっていればバック
  const braking = backward && velocity > 0.5;
  const reversing = backward && !braking;

  carState.throttle = approach(
    carState.throttle,
    forward ? 1 : 0,
    forward ? DRIVE.throttleRise : DRIVE.throttleFall,
    dt
  );
  carState.brake = approach(
    carState.brake,
    braking ? 1 : 0,
    braking ? DRIVE.brakeRise : DRIVE.brakeFall,
    dt
  );
  carState.boostBlend = approach(
    carState.boostBlend,
    boosting ? 1 : 0,
    boosting ? DRIVE.boostRise : DRIVE.boostFall,
    dt
  );

  // 駆動力（前進：出力÷速度、ただしグリップの上限まで。バック：最高速に近づくほど弱まる）
  let driveAccel = 0;
  if (velocity >= -0.1) {
    const power = THREE.MathUtils.lerp(DRIVE.normalPower, DRIVE.boostPower, carState.boostBlend);
    driveAccel = carState.throttle * Math.min(DRIVE.tractionLimit, power / Math.max(velocity, 1));
  }
  if (reversing) {
    driveAccel -= DRIVE.reverseAcceleration * Math.max(0, 1 + velocity / DRIVE.reverseMaxSpeed);
  }
  velocity += driveAccel * dt;

  // 抵抗（進んでいる向きと逆にかかり、速度が0をまたいで逆向きにはならない）
  const absVelocity = Math.abs(velocity);
  let resistance =
    DRIVE.dragCoefficient * absVelocity * absVelocity +
    DRIVE.rollingResistance +
    DRIVE.engineBraking * (1 - carState.throttle) * (velocity > 0 ? 1 : 0) +
    DRIVE.brakeDeceleration * carState.brake;
  if (raceState.offTrack) resistance += DRIVE.offTrackResistance * absVelocity;
  velocity = Math.sign(velocity) * Math.max(absVelocity - resistance * dt, 0);

  carState.speed = velocity / FRAME_TO_MPS;
  carState.longitudinalAccel = (carState.speed - speedBefore) / safeStep;

  // --- 2. ステアリング（車体の向きを変える。進行方向は慣性で残る） ---
  const steerInput = (left ? 1 : 0) - (right ? 1 : 0);
  carState.steerInput = steerInput;
  const absSpeed = Math.abs(carState.speed);
  if (steerInput !== 0 && absSpeed > 0.001) {
    const lowSpeedFactor = Math.min(absSpeed / carState.fullSteerSpeed, 1);
    const highSpeedFactor = 1 / (1 + absSpeed * carState.steerSpeedFalloff);
    const direction = carState.speed >= 0 ? 1 : -1; // 後退中はハンドルの向きが逆になる
    rotateCarKeepingVelocity(
      steerInput * carState.turnSpeed * lowSpeedFactor * highSpeedFactor * direction * step
    );
  }

  // --- 3. グリップ（横滑りをタイヤが打ち消す。限界を超えた分は滑る） ---
  const lateralBefore = carState.lateralSpeed;
  const grip =
    carState.gripLimit * (raceState.offTrack ? carState.offTrackGripMultiplier : 1) * step;
  if (Math.abs(carState.lateralSpeed) <= grip) {
    carState.lateralSpeed = 0;
  } else {
    // グリップの限界を超えている：打ち消しきれずに外側へ滑り、タイヤが擦れて減速する
    carState.lateralSpeed -= Math.sign(carState.lateralSpeed) * grip;
    const scrub = Math.abs(carState.lateralSpeed) * carState.slideScrub * step;
    carState.speed = Math.sign(carState.speed) * Math.max(Math.abs(carState.speed) - scrub, 0);
  }
  carState.lateralAccel = (carState.lateralSpeed - lateralBefore) / safeStep;

  // --- 4. スリップアングルの制限（車体が進行方向から向きすぎてスピンしないように） ---
  if (carState.speed > 0.05) {
    const slipAngle = Math.atan2(carState.lateralSpeed, carState.speed);
    if (Math.abs(slipAngle) > carState.maxSlipAngle) {
      // 進行方向のほうへ車体を向け直す
      rotateCarKeepingVelocity(slipAngle - Math.sign(slipAngle) * carState.maxSlipAngle);
    }
  }

  // --- 5. 移動 ---
  updateCarAxes();
  car.position
    .addScaledVector(carForward, carState.speed * step)
    .addScaledVector(carLeft, carState.lateralSpeed * step);
}

// 加減速で前後に、コーナリングで左右に車体を傾ける（見た目だけの演出）
const BODY_ROLL_FACTOR = 10;
const BODY_PITCH_FACTOR = 12; // 1G(約0.0027m/フレーム²)の加減速で約0.03rad傾く
const BODY_MAX_ROLL = 0.06; // 約3.4°
const BODY_MAX_PITCH = 0.04; // 約2.3°

function updateCarBody(step) {
  if (!carModel) return;
  // 左に曲がる（左向きの横加速度）と、遠心力で右側が沈む
  const targetRoll = THREE.MathUtils.clamp(
    carState.lateralAccel * BODY_ROLL_FACTOR,
    -BODY_MAX_ROLL,
    BODY_MAX_ROLL
  );
  // 加速するとノーズが上がり、ブレーキでノーズが沈む
  const targetPitch = THREE.MathUtils.clamp(
    -carState.longitudinalAccel * BODY_PITCH_FACTOR,
    -BODY_MAX_PITCH,
    BODY_MAX_PITCH
  );
  const smoothing = Math.min(1, 0.12 * step);
  carModel.rotation.z += (targetRoll - carModel.rotation.z) * smoothing;
  carModel.rotation.x += (targetPitch - carModel.rotation.x) * smoothing;
}

// 太陽光と影の範囲を車に追従させる
function updateSunLight() {
  dirLight.position.copy(car.position).add(SUN_OFFSET);
  dirLight.target.position.copy(car.position);
}

// --- タイムアタック ---
const COUNTDOWN_SECONDS = 3;
// コース形状や走行モデルを変えたら末尾の版を上げる（別のコースのベストタイムが残らないように）
const BEST_LAP_STORAGE_KEY = 'gtr-time-attack-best-lap-v3'; // v3: 加減速の計算方法を変更

function loadBestLap() {
  try {
    const value = parseFloat(localStorage.getItem(BEST_LAP_STORAGE_KEY));
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function saveBestLap(seconds) {
  try {
    localStorage.setItem(BEST_LAP_STORAGE_KEY, String(seconds));
  } catch {
    // 保存できない環境（プライベートモード等）では、そのセッション中だけ保持する
  }
}

const raceState = {
  // 'menu'（タイトル画面）/ 'countdown'（操作不可）/ 'racing' / 'paused'（一時停止）
  phase: 'menu',
  phaseBeforePause: null, // 一時停止から再開したときに戻るフェーズ
  countdown: COUNTDOWN_SECONDS,
  lap: 1,
  lapTime: 0,
  lastLap: null,
  bestLap: loadBestLap(),
  nextCheckpoint: 0, // 次に通過すべきチェックポイントの番号
  previousIndex: 0, // 前フレームでの最寄りサンプル番号（ライン通過判定用）
  offTrack: false,
  startLineCrossed: false, // グリッドからスタートラインを越えたか（越えるまでのライン通過は周回にしない）
  messageTimer: 0,
};

// 秒数を「分:秒.ミリ秒」形式にする（例: 1:23.456）
function formatTime(seconds) {
  if (seconds === null) return '--:--.---';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(3).padStart(6, '0')}`;
}

function showMessage(text, duration, variant = '') {
  raceMessage.textContent = text;
  raceMessage.className = variant;
  raceMessage.hidden = false;
  raceState.messageTimer = duration;
}

// 車をスタート地点に戻し、周回の記録（ラップ数・タイム・チェックポイント）を初期化する
function resetCarToStart() {
  placeCarAtStart();
  carState.speed = 0;
  carState.lateralSpeed = 0;
  carState.lateralAccel = 0;
  carState.longitudinalAccel = 0;
  carState.throttle = 0;
  carState.brake = 0;
  carState.boostBlend = 0;
  carState.steerInput = 0;
  carState.steerAngle = 0;
  raceState.lap = 1;
  raceState.lapTime = 0;
  raceState.nextCheckpoint = 0;
  raceState.previousIndex = findNearestTrackSample(car.position).index;
  raceState.offTrack = false;
  raceState.startLineCrossed = false;
}

// スタート地点からカウントダウンをやり直す
function restartRace() {
  resetCarToStart();
  raceState.phase = 'countdown';
  raceState.countdown = COUNTDOWN_SECONDS;
}

function hideRaceMessage() {
  raceMessage.hidden = true;
  raceState.messageTimer = 0;
}

function completeLap() {
  const lapTime = raceState.lapTime;
  raceState.lastLap = lapTime;

  if (raceState.bestLap === null || lapTime < raceState.bestLap) {
    raceState.bestLap = lapTime;
    saveBestLap(lapTime);
    showMessage(`NEW RECORD!  ${formatTime(lapTime)}`, 3, 'record');
  } else {
    showMessage(`LAP ${raceState.lap}  ${formatTime(lapTime)}`, 2.5);
  }

  raceState.lap += 1;
  raceState.lapTime = 0;
  raceState.nextCheckpoint = 0;
}

function updateRace(delta) {
  // 中央メッセージの表示時間管理
  if (raceState.messageTimer > 0) {
    raceState.messageTimer -= delta;
    if (raceState.messageTimer <= 0) raceMessage.hidden = true;
  }

  if (raceState.phase === 'countdown') {
    raceState.countdown -= delta;
    if (raceState.countdown > 0) {
      raceMessage.textContent = String(Math.ceil(raceState.countdown));
      raceMessage.className = 'countdown';
      raceMessage.hidden = false;
      raceState.messageTimer = 0;
    } else {
      raceState.phase = 'racing';
      showMessage('GO!', 1, 'countdown');
    }
    return;
  }

  raceState.lapTime += delta;

  const { index, distance } = findNearestTrackSample(car.position);
  raceState.offTrack = distance > TRACK_WIDTH / 2;

  // チェックポイントは決められた順番でのみ通過扱いにする
  if (raceState.nextCheckpoint < CHECKPOINT_INDICES.length) {
    const checkpointIndex = CHECKPOINT_INDICES[raceState.nextCheckpoint];
    const inWindow = index >= checkpointIndex && index < checkpointIndex + CHECKPOINT_WINDOW;
    if (inWindow && distance <= CHECKPOINT_MAX_DISTANCE) {
      raceState.nextCheckpoint += 1;
    }
  }

  // フィニッシュライン（サンプル番号が周の終わり付近 → 始まり付近へ変化）を前向きに通過したか
  const crossedFinishLine =
    raceState.previousIndex > TRACK_SEGMENTS * 0.9 && index < TRACK_SEGMENTS * 0.1;
  if (crossedFinishLine) {
    if (!raceState.startLineCrossed) {
      // スタート直後にグリッドからラインを越えただけなので、周回にはしない
      raceState.startLineCrossed = true;
    } else if (raceState.nextCheckpoint === CHECKPOINT_INDICES.length) {
      completeLap();
    } else {
      showMessage('チェックポイント未通過', 2, 'invalid');
    }
  }
  raceState.previousIndex = index;
}

// スタートシグナル：カウントダウン中に左から1列ずつ赤ランプが点き、GO! で一斉に消える（F1方式）
const START_LIGHT_COLUMNS = 5;

function updateStartLights() {
  if (raceState.phase === 'paused') return; // 一時停止中は今の点灯状態のまま
  if (raceState.phase !== 'countdown') {
    startGantry.setLitColumns(0);
    return;
  }
  const elapsed = COUNTDOWN_SECONDS - raceState.countdown;
  const interval = COUNTDOWN_SECONDS / (START_LIGHT_COLUMNS + 1); // 全灯後、少し間を置いてGO
  startGantry.setLitColumns(Math.min(START_LIGHT_COLUMNS, Math.floor(elapsed / interval) + 1));
}

function updateRaceHud() {
  raceLapEl.textContent = `LAP ${raceState.lap}`;
  raceTimeEl.textContent = formatTime(raceState.lapTime);
  raceLastEl.textContent = formatTime(raceState.lastLap);
  raceBestEl.textContent = formatTime(raceState.bestLap);
  raceWarningEl.hidden = !raceState.offTrack;
}

// --- 画面の切り替え（タイトル / 走行 / 一時停止） ---
function isDriving() {
  return raceState.phase === 'countdown' || raceState.phase === 'racing';
}

function setHudVisible(visible) {
  raceHud.hidden = !visible;
  speedDisplay.hidden = !visible;
}

// タイトル画面の START
function startGame() {
  menu.hideTitle();
  setHudVisible(true);
  bgm.unlock();
  bgm.setScene('race');
  startEngineSound();
  restartRace();
}

function pauseGame() {
  if (!isDriving()) return;
  raceState.phaseBeforePause = raceState.phase;
  raceState.phase = 'paused';
  pauseEngineSound();
  bgm.setPaused(true);
  menu.showPause();
}

function resumeGame() {
  if (raceState.phase !== 'paused') return;
  raceState.phase = raceState.phaseBeforePause;
  menu.hidePause();
  bgm.setPaused(false);
  resumeEngineSound();
}

function restartFromPause() {
  menu.hidePause();
  hideRaceMessage();
  restartRace();
  bgm.setPaused(false);
  resumeEngineSound();
}

function quitToTitle() {
  menu.hidePause();
  hideRaceMessage();
  stopEngineSound();
  setHudVisible(false);
  resetCarToStart();
  raceState.phase = 'menu';
  bgm.setScene('menu');
  menu.showTitle(raceState.bestLap);
}

function resetBestLap() {
  raceState.bestLap = null;
  try {
    localStorage.removeItem(BEST_LAP_STORAGE_KEY);
  } catch {
    // 保存領域が使えない環境では、表示上の記録だけ消す
  }
  menu.setBestLap(null);
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  // Esc：走行中なら一時停止、一時停止中なら再開
  if (e.key === 'Escape') {
    if (isDriving()) pauseGame();
    else if (raceState.phase === 'paused') resumeGame();
  }
  // R：スタート地点に戻ってカウントダウンからやり直し（走行中のみ）
  if (e.key.toLowerCase() === 'r' && isDriving()) restartRace();
});

// ブラウザは操作があるまで音を鳴らせないので、最初のクリック/キー入力でタイトルのBGMを鳴らし始める
window.addEventListener('pointerdown', () => bgm.unlock());
window.addEventListener('keydown', () => bgm.unlock());

// 別のウィンドウに切り替えたら自動で一時停止する（タイムが進み続けないように）
window.addEventListener('blur', pauseGame);

// 起動時はタイトル画面から始める
resetCarToStart();
bgm.setScene('menu');
menu.showTitle(raceState.bestLap);

function updateSpeedDisplay() {
  // 横滑り中も含めた実際の移動速度を表示する
  const speedKmh = Math.hypot(carState.speed, carState.lateralSpeed) * SPEED_DISPLAY_SCALE;
  speedDisplay.textContent = `${speedKmh.toFixed(0)} km/h`;
}

// --- カメラ追従 ---
// 車の前進方向は +Z（updateCarの position 更新式より）なので、
// 基準となるカメラは車の背後＝ -Z 側に置く。
// cameraYaw / cameraPitch は右クリックドラッグで、cameraDistance はマウスホイールで
// ユーザーが自由に調整できる。
let cameraDistance = 9.85;
const CAMERA_MIN_DISTANCE = 4;
const CAMERA_MAX_DISTANCE = 25;
let cameraYaw = 0;
let cameraPitch = 0.42; // 初期角度（従来の (0, 4, -9) 相当）
const CAMERA_MIN_PITCH = 0.15;
const CAMERA_MAX_PITCH = 1.3;

function updateCamera() {
  const yaw = car.rotation.y + cameraYaw;
  const horizontalDistance = cameraDistance * Math.cos(cameraPitch);
  const verticalDistance = cameraDistance * Math.sin(cameraPitch);

  const offset = new THREE.Vector3(0, verticalDistance, -horizontalDistance).applyAxisAngle(
    new THREE.Vector3(0, 1, 0),
    yaw
  );

  // Wを押し続けても距離が開いていかないよう、遅延（lerp）を使わず常に一定オフセットを維持する
  camera.position.copy(car.position).add(offset);
  camera.lookAt(car.position.clone().add(new THREE.Vector3(0, 1, 0)));
}

// --- タイトル画面のカメラ（ショールームのように車の周りをゆっくり回る） ---
const SHOWROOM_RADIUS = 7.2;
const SHOWROOM_HEIGHT = 1.6;
const SHOWROOM_SPEED = 0.18; // rad/秒（1周 約35秒）
// メニューは画面左側にあるので、広い画面では注視点を左へずらして車を画面の右寄りに映す
const SHOWROOM_SHIFT = 2.4;
let showroomAngle = Math.PI * 0.75; // 斜め前から見る角度で始める

function updateShowroomCamera(delta) {
  showroomAngle += SHOWROOM_SPEED * delta;
  const center = car.position.clone().add(new THREE.Vector3(0, 0.7, 0));
  const angle = car.rotation.y + showroomAngle;
  camera.position.set(
    center.x + Math.sin(angle) * SHOWROOM_RADIUS,
    center.y + SHOWROOM_HEIGHT,
    center.z + Math.cos(angle) * SHOWROOM_RADIUS
  );

  const toCar = center.clone().sub(camera.position).normalize();
  const cameraRight = new THREE.Vector3().crossVectors(toCar, camera.up).normalize();
  const shift = window.innerWidth > 900 ? SHOWROOM_SHIFT : 0;
  camera.lookAt(center.addScaledVector(cameraRight, -shift));
}

// --- リサイズ対応 ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- アニメーションループ ---
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  // 前フレームからの経過秒数。タブ切り替え等で大きく空いた場合はタイムと挙動が飛ばないよう上限を設ける
  const delta = Math.min(clock.getDelta(), 0.05);
  const step = delta * 60; // 60fps基準の倍率

  // 一時停止中は車もタイマーも止める（画面は描画し続ける）
  if (raceState.phase !== 'paused') {
    updateCar(step, raceState.phase === 'racing');
    updateCarBody(step);
    updateWheels(step);
    updateSteering(delta);
    updateSunLight();
    if (isDriving()) updateRace(delta);
  }

  if (raceState.phase === 'menu') {
    updateShowroomCamera(delta);
  } else {
    updateCamera();
  }
  updateSpeedDisplay();
  updateRaceHud();
  updateStartLights();
  updateEngineSound();
  updateBrakeLights();
  bgm.update(delta);
  renderer.render(scene, camera);
}

animate();
