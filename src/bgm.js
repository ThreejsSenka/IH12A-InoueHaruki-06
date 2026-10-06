// ----------------------------------------------------------------
// BGM（タイトル画面用と走行中用）
// - 画面に合わせて曲を切り替える（切り替え時はフェードアウト → フェードイン）
// - 一時停止中は音量を下げる
// - ブラウザの自動再生の制限があるため、最初にクリック/キー操作があってから鳴り始める
//
// 曲は長いので AudioBuffer に全部読み込まず、<audio> 要素でストリーミング再生する
//
// 音源（クレジットは README.md とタイトル画面のクレジットにも記載）:
//   タイトル: "Racing Menu" by Eric Matyas（www.soundimage.org, CC BY 3.0）
//     https://opengameart.org/content/racing-menu-looping
//   走行中:   "Hyperflight Racing" by cynicmusic（CC0）
//     https://opengameart.org/content/hyperflight-racing
// ----------------------------------------------------------------

const TRACKS = {
  menu: { url: '/sounds/bgm/menu-racing-menu.ogg', volume: 0.5 },
  race: { url: '/sounds/bgm/race-hyperflight.mp3', volume: 0.32 }, // エンジン音が聞こえるよう控えめに
};

const PAUSED_VOLUME_RATIO = 0.35;
const FADE_SECONDS = 0.8;

export function createBgm() {
  const players = {}; // scene → { audio, target }

  let scene = null; // 'menu' | 'race' | null（無音）
  let paused = false;
  let unlocked = false; // ユーザー操作があり、再生が許可されたか

  function getPlayer(name) {
    if (!players[name]) {
      const audio = new Audio(TRACKS[name].url);
      audio.loop = true;
      audio.preload = 'auto';
      audio.volume = 0;
      players[name] = { audio, target: 0 };
    }
    return players[name];
  }

  // 今鳴らすべき曲だけ目標音量を上げ、それ以外はフェードアウトさせる
  function refresh({ restart = false } = {}) {
    Object.entries(players).forEach(([name, player]) => {
      if (name !== scene || !unlocked) player.target = 0;
    });
    if (!scene || !unlocked) return;

    const player = getPlayer(scene);
    player.target = TRACKS[scene].volume * (paused ? PAUSED_VOLUME_RATIO : 1);
    if (player.audio.paused) {
      if (restart) player.audio.currentTime = 0;
      player.audio.play().catch((error) => {
        console.warn(`BGM（${TRACKS[scene].url}）を再生できませんでした:`, error);
      });
    }
  }

  return {
    // クリック/キー操作のイベントの中から呼ぶ（自動再生の制限の解除）
    unlock() {
      if (unlocked) return;
      unlocked = true;
      refresh({ restart: true });
    },

    // 画面に合わせて曲を切り替える（'menu' / 'race' / null）
    setScene(nextScene) {
      if (nextScene === scene) return;
      scene = nextScene;
      paused = false;
      refresh({ restart: true });
    },

    setPaused(value) {
      paused = value;
      refresh();
    },

    // 毎フレーム呼ぶ：音量のフェード
    update(delta) {
      const fadeStep = (TRACKS.menu.volume / FADE_SECONDS) * delta;
      Object.values(players).forEach((player) => {
        const { audio, target } = player;
        if (audio.paused) return;
        const diff = target - audio.volume;
        audio.volume = Math.abs(diff) <= fadeStep ? target : audio.volume + Math.sign(diff) * fadeStep;
        if (audio.volume === 0 && target === 0) audio.pause();
      });
    },
  };
}
