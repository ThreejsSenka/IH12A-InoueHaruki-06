import './menu.css';

// ----------------------------------------------------------------
// タイトル画面・一時停止メニューの表示と操作
// （画面のHTMLは index.html にある。ゲーム側の処理は main.js から callbacks で受け取る）
// - マウスのクリックに加えて、↑↓キーで項目を選び Enter で決定できる
// - タイトル画面のサブ画面（操作説明・クレジット）は Esc でも戻れる
// ----------------------------------------------------------------

const RESET_CONFIRM_SECONDS = 3;

export function createMenu({ formatTime, onStart, onResume, onRestart, onQuit, onResetBest }) {
  const titleScreen = document.getElementById('title-screen');
  const pauseMenu = document.getElementById('pause-menu');
  const titleViews = [...titleScreen.querySelectorAll('[data-view]')];

  const startButton = titleScreen.querySelector('[data-action="start"]');
  const loading = titleScreen.querySelector('.loading');
  const loadingText = titleScreen.querySelector('.loading-text');
  const loadingBarFill = titleScreen.querySelector('.loading-bar-fill');
  const bestLapTime = titleScreen.querySelector('.best-lap-time');
  const resetBestButton = titleScreen.querySelector('[data-action="reset-best"]');
  const resetBestDefaultText = resetBestButton.textContent;

  let resetConfirmTimer = null;

  // 今キーボード操作の対象になっている領域（一時停止メニュー > タイトルの表示中のサブ画面）
  function activeContainer() {
    if (!pauseMenu.hidden) return pauseMenu;
    if (!titleScreen.hidden) return titleViews.find((view) => !view.hidden) ?? null;
    return null;
  }

  function focusFirstButton(container) {
    container?.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
  }

  function showView(name) {
    titleViews.forEach((view) => {
      view.hidden = view.dataset.view !== name;
    });
    focusFirstButton(activeContainer());
  }

  function cancelResetConfirm() {
    clearTimeout(resetConfirmTimer);
    resetConfirmTimer = null;
    resetBestButton.textContent = resetBestDefaultText;
    resetBestButton.classList.remove('is-confirming');
  }

  // 誤操作で記録を消さないよう、2回押したときだけリセットする
  function handleResetBest() {
    if (resetConfirmTimer === null) {
      resetBestButton.textContent = 'もう一度押すとリセット';
      resetBestButton.classList.add('is-confirming');
      resetConfirmTimer = setTimeout(cancelResetConfirm, RESET_CONFIRM_SECONDS * 1000);
      return;
    }
    cancelResetConfirm();
    onResetBest();
  }

  titleScreen.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    switch (button.dataset.action) {
      case 'start':
        onStart();
        break;
      case 'controls':
        showView('controls');
        break;
      case 'credits':
        showView('credits');
        break;
      case 'back':
        showView('main');
        break;
      case 'reset-best':
        handleResetBest();
        break;
    }
  });

  pauseMenu.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;
    switch (button.dataset.action) {
      case 'resume':
        onResume();
        break;
      case 'restart':
        onRestart();
        break;
      case 'quit':
        onQuit();
        break;
    }
  });

  document.addEventListener('keydown', (e) => {
    const container = activeContainer();
    if (!container) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const buttons = [...container.querySelectorAll('button:not([disabled]):not([hidden])')];
      if (buttons.length === 0) return;
      e.preventDefault();
      const current = buttons.indexOf(document.activeElement);
      const direction = e.key === 'ArrowDown' ? 1 : -1;
      const next = current === -1 ? 0 : (current + direction + buttons.length) % buttons.length;
      buttons[next].focus({ preventScroll: true });
    }

    // タイトル画面のサブ画面からは Esc でも戻れる（一時停止中の Esc は main.js 側で「再開」として扱う）
    if (e.key === 'Escape' && container !== pauseMenu && container.dataset.view !== 'main') {
      showView('main');
    }
  });

  function setBestLap(seconds) {
    bestLapTime.textContent = formatTime(seconds);
    bestLapTime.classList.toggle('is-empty', seconds === null);
    resetBestButton.hidden = seconds === null;
    cancelResetConfirm();
  }

  return {
    // percent: 0〜100。サーバーがサイズを返さない場合は null（%なしで表示）
    setLoading(percent) {
      loadingText.textContent =
        percent === null ? '車のモデルを読み込み中…' : `車のモデルを読み込み中… ${percent}%`;
      loadingBarFill.style.width = `${percent ?? 0}%`;
    },

    // 読み込み完了（失敗時は errorMessage を表示した上でスタートできるようにする）
    setReady(errorMessage = null) {
      startButton.disabled = false;
      if (errorMessage) {
        loadingText.textContent = errorMessage;
        loading.classList.add('is-error');
      } else {
        loading.hidden = true;
      }
      if (!titleScreen.hidden && activeContainer()?.dataset.view === 'main') {
        startButton.focus({ preventScroll: true });
      }
    },

    setBestLap,

    showTitle(bestLapSeconds) {
      setBestLap(bestLapSeconds);
      titleScreen.hidden = false;
      showView('main');
    },

    hideTitle() {
      cancelResetConfirm();
      titleScreen.hidden = true;
      document.activeElement?.blur();
    },

    showPause() {
      pauseMenu.hidden = false;
      focusFirstButton(pauseMenu);
    },

    hidePause() {
      pauseMenu.hidden = true;
      document.activeElement?.blur();
    },
  };
}
