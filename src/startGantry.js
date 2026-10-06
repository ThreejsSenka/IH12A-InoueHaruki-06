import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ----------------------------------------------------------------
// スタート/フィニッシュラインのゲート（実際のサーキットの門型ガントリー）
// - 左右に鉄骨トラス（格子状に組んだ柱）を立て、その間に黒い看板をかける
// - 看板の中央からスタートシグナル（赤ランプ 5列×2段）を吊り下げる
// - シグナルはカウントダウンに合わせて setLitColumns() で点灯させる
//
// 座標系：ゲートの中心をスタートラインの中央に置き、
//   X = コースを横切る方向、Y = 上、Z = コースの進行方向（-Z 側から車が近づいてくる）
// ----------------------------------------------------------------

const TOWER_SIZE = 0.9; // トラス柱の断面（一辺）
const TOWER_HEIGHT = 9; // 柱は看板より少し上まで伸ばす
const TOWER_MARGIN = 1.8; // コースの端から柱の中心までの距離
const BANNER_BOTTOM = 5.6; // 看板の下端の高さ（車とカメラがくぐれる高さ）
const BANNER_HEIGHT = 2.0;
const BANNER_DEPTH = 0.7;
const LIGHT_COLUMNS = 5;

// 2点の間に、指定した太さの角材を渡すジオメトリ（トラスの斜材用）
function beamBetween(from, to, thickness) {
  const direction = new THREE.Vector3().subVectors(to, from);
  const geometry = new THREE.BoxGeometry(thickness, direction.length(), thickness);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.clone().normalize()
  );
  geometry.applyQuaternion(quaternion);
  const middle = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  geometry.translate(middle.x, middle.y, middle.z);
  return geometry;
}

function boxAt(width, height, depth, x, y, z) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.translate(x, y, z);
  return geometry;
}

// 鉄骨トラスの柱：四隅の主柱＋一定間隔の水平材＋各面のジグザグの斜材を、1つのジオメトリにまとめる
// （部材ごとにメッシュを作ると数百個になり描画が重くなるため、結合して1回で描く）
function createTrussGeometry(height, size) {
  const post = 0.14;
  const brace = 0.06;
  const half = size / 2;
  const levels = Math.round(height / 1.0);
  const parts = [];

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(boxAt(post, height, post, sx * half, height / 2, sz * half));
    }
  }

  for (let i = 0; i <= levels; i++) {
    const y = (height * i) / levels;
    parts.push(boxAt(size, brace, brace, 0, y, -half));
    parts.push(boxAt(size, brace, brace, 0, y, half));
    parts.push(boxAt(brace, brace, size, -half, y, 0));
    parts.push(boxAt(brace, brace, size, half, y, 0));
  }

  for (let i = 0; i < levels; i++) {
    const y0 = (height * i) / levels;
    const y1 = (height * (i + 1)) / levels;
    const flip = i % 2 === 0 ? 1 : -1; // 段ごとに向きを変えてジグザグにする
    for (const sz of [-1, 1]) {
      parts.push(
        beamBetween(
          new THREE.Vector3(-half * flip, y0, sz * half),
          new THREE.Vector3(half * flip, y1, sz * half),
          brace
        )
      );
    }
    for (const sx of [-1, 1]) {
      parts.push(
        beamBetween(
          new THREE.Vector3(sx * half, y0, -half * flip),
          new THREE.Vector3(sx * half, y1, half * flip),
          brace
        )
      );
    }
  }

  return mergeGeometries(parts);
}

// 看板の文字（このゲームのロゴ）。メニュー画面と同じ黒×赤のデザインにそろえる
function createBannerTexture(maxAnisotropy) {
  const width = 2048;
  const height = 210;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0f0f11';
  ctx.fillRect(0, 0, width, height);

  // 下端の赤いライン
  ctx.fillStyle = '#e10600';
  ctx.fillRect(0, height - 10, width, 10);

  // 左右の斜めストライプ
  const drawStripes = (startX, direction) => {
    [120, 48, 20].forEach((stripeWidth, i) => {
      const x = startX + direction * i * 70;
      ctx.globalAlpha = 1 - i * 0.3;
      ctx.beginPath();
      ctx.moveTo(x, 150);
      ctx.lineTo(x + stripeWidth, 150);
      ctx.lineTo(x + stripeWidth + 34, 60);
      ctx.lineTo(x + 34, 60);
      ctx.closePath();
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  };
  drawStripes(150, 1);
  drawStripes(width - 150 - 120, -1);

  // ロゴ文字
  ctx.textBaseline = 'middle';
  ctx.font = 'italic 900 128px "Segoe UI", "Arial Black", sans-serif';
  const main = 'GT-R';
  const sub = '  TIME ATTACK';
  const mainWidth = ctx.measureText(main).width;
  ctx.font = 'italic 800 96px "Segoe UI", "Arial", sans-serif';
  const subWidth = ctx.measureText(sub).width;
  const startX = (width - mainWidth - subWidth) / 2;

  ctx.font = 'italic 900 128px "Segoe UI", "Arial Black", sans-serif';
  ctx.fillStyle = '#e10600';
  ctx.fillText(main, startX, height / 2 - 4);
  ctx.font = 'italic 800 96px "Segoe UI", "Arial", sans-serif';
  ctx.fillStyle = '#f5f5f5';
  ctx.fillText(sub, startX + mainWidth, height / 2 - 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

export function createStartGantry({ trackWidth, maxAnisotropy }) {
  const group = new THREE.Group();

  const steel = new THREE.MeshStandardMaterial({ color: 0x1c1c1f, metalness: 0.6, roughness: 0.5 });
  const darkPanel = new THREE.MeshStandardMaterial({ color: 0x121214, metalness: 0.3, roughness: 0.6 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9c9c9c, roughness: 0.9 });

  const towerX = trackWidth / 2 + TOWER_MARGIN;

  // --- 左右の柱（トラス）と基礎 ---
  const trussGeometry = createTrussGeometry(TOWER_HEIGHT, TOWER_SIZE);
  for (const side of [-1, 1]) {
    const tower = new THREE.Mesh(trussGeometry, steel);
    tower.position.x = side * towerX;
    tower.castShadow = true;
    tower.receiveShadow = true;
    group.add(tower);

    const footing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 1.6), concrete);
    footing.position.set(side * towerX, 0.2, 0);
    footing.castShadow = true;
    footing.receiveShadow = true;
    group.add(footing);
  }

  // --- 看板（前後の面にロゴ、それ以外の面は黒） ---
  const bannerTexture = createBannerTexture(maxAnisotropy);
  const bannerFace = new THREE.MeshStandardMaterial({
    map: bannerTexture,
    roughness: 0.55,
    metalness: 0.1,
    // 看板の文字が日陰で潰れないよう、わずかに自発光させる
    emissive: 0xffffff,
    emissiveMap: bannerTexture,
    emissiveIntensity: 0.25,
  });
  const bannerWidth = towerX * 2 + TOWER_SIZE;
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(bannerWidth, BANNER_HEIGHT, BANNER_DEPTH),
    // BoxGeometry の面の順番：+X, -X, +Y, -Y, +Z（奥）, -Z（手前＝近づいてくる車の側）
    [darkPanel, darkPanel, darkPanel, darkPanel, bannerFace, bannerFace]
  );
  banner.position.y = BANNER_BOTTOM + BANNER_HEIGHT / 2;
  banner.castShadow = true;
  banner.receiveShadow = true;
  group.add(banner);

  // --- スタートシグナル（看板の中央から吊り下げる） ---
  const panelWidth = 3.4;
  const panelHeight = 0.9;
  const panelDepth = 0.35;
  const panelY = BANNER_BOTTOM - 0.3 - panelHeight / 2;

  const panel = new THREE.Mesh(new THREE.BoxGeometry(panelWidth, panelHeight, panelDepth), darkPanel);
  panel.position.y = panelY;
  panel.castShadow = true;
  group.add(panel);

  for (const side of [-1, 1]) {
    const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), steel);
    hanger.position.set(side * (panelWidth / 2 - 0.3), BANNER_BOTTOM - 0.15, 0);
    group.add(hanger);
  }

  // 列ごとにマテリアルを分け、点灯/消灯を列単位で切り替える
  const lampMaterials = [];
  const lampGeometry = new THREE.CircleGeometry(0.14, 24);
  const rimGeometry = new THREE.RingGeometry(0.14, 0.19, 24);
  const rimMaterial = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.8 });

  for (let column = 0; column < LIGHT_COLUMNS; column++) {
    const material = new THREE.MeshStandardMaterial({
      color: 0x2a0503, // 消灯時は暗い赤のレンズ
      emissive: 0xff1a0a,
      emissiveIntensity: 0,
      roughness: 0.25,
    });
    lampMaterials.push(material);

    const x = (column - (LIGHT_COLUMNS - 1) / 2) * 0.62;
    for (const y of [-0.2, 0.2]) {
      // 手前（-Z）と奥（+Z）の両面に付ける
      for (const face of [-1, 1]) {
        const lamp = new THREE.Mesh(lampGeometry, material);
        lamp.position.set(x, panelY + y, face * (panelDepth / 2 + 0.005));
        lamp.rotation.y = face === -1 ? Math.PI : 0;
        group.add(lamp);

        const rim = new THREE.Mesh(rimGeometry, rimMaterial);
        rim.position.copy(lamp.position);
        rim.rotation.copy(lamp.rotation);
        group.add(rim);
      }
    }
  }

  let litColumns = -1;

  return {
    group,
    // 左から count 列を点灯させる（0 で全消灯）
    setLitColumns(count) {
      if (count === litColumns) return;
      litColumns = count;
      lampMaterials.forEach((material, column) => {
        material.emissiveIntensity = column < count ? 3 : 0;
      });
    },
  };
}
