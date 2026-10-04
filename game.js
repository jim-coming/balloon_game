(function () {
  'use strict';
  const { GameEngine, DIFFICULTIES, LEVELS } = window.BalloonGameCore;
  const $ = id => document.getElementById(id);
  const stage = $('stage'), canvas = $('scene'), ctx = canvas.getContext('2d');
  const entities = $('entities'), effects = $('effects');
  const screens = [$('menu-screen'), $('pause-screen'), $('result-screen')];
  const modeNames = { classic: '經典', arcade: '派對', challenge: '闖關' };
  const descriptions = {
    classic: '純粹的射擊樂趣。把氣球打破，挑戰自己的最高分。',
    arcade: '金球加時、連擊加分，小心混進派對的炸彈。',
    challenge: '從暖身到冠軍，完成每關任務，解鎖下一個挑戰。',
  };
  const storageKey = 'balloon-club-v2';
  const settings = { mode: 'classic', difficulty: 'normal', levelIndex: 0, sound: true, unlocked: 1, best: Object.create(null) };
  let storageAvailable = true;
  function storageFallback() {
    storageAvailable = false;
    $('storage-note').textContent = '目前僅保留本次開啟的紀錄；重新整理後將重設。';
  }
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && typeof saved === 'object') {
      if (Object.hasOwn(modeNames, saved.mode)) settings.mode = saved.mode;
      if (Object.hasOwn(DIFFICULTIES, saved.difficulty)) settings.difficulty = saved.difficulty;
      if (typeof saved.sound === 'boolean') settings.sound = saved.sound;
      if (Number.isInteger(saved.unlocked)) settings.unlocked = Math.max(1, Math.min(LEVELS.length, saved.unlocked));
      if (Number.isInteger(saved.levelIndex)) settings.levelIndex = Math.max(0, Math.min(settings.unlocked - 1, saved.levelIndex));
      if (saved.best && typeof saved.best === 'object') {
        for (const [key, value] of Object.entries(saved.best)) {
          if (/^(classic|arcade):(easy|normal|hard|insane)$|^challenge:[0-4]$/.test(key) && Number.isFinite(value) && value >= 0) {
            settings.best[key] = Math.min(1e7, Math.floor(value));
          }
        }
      }
    }
  } catch (error) {
    // An invalid old record is harmless; blocked storage still permits playing.
    try { localStorage.removeItem(storageKey); } catch (_) { storageFallback(); }
  }
  function saveSettings() {
    if (!storageAvailable) return;
    try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch (_) { storageFallback(); }
  }
  const recordKey = (mode, difficulty, levelIndex) => mode === 'challenge' ? `challenge:${levelIndex}` : `${mode}:${difficulty}`;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const engine = new GameEngine({ reducedMotion });
  let lastFrame = null, sceneTime = 0, lastTick = -1, lastHud = '', lastGoals = '', keyboardAim = false;
  const aim = { x: 0, y: 0 };
  const balloonNodes = new Map(), bulletNodes = new Map();

  const audio = {
    context: null,
    unlock() {
      if (!settings.sound) return;
      try {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        this.context ||= new Audio();
        if (this.context.state === 'suspended') this.context.resume().catch(() => {});
      } catch (_) { /* Audio never prevents a game from starting. */ }
    },
    play(kind) {
      if (!settings.sound || !this.context || this.context.state !== 'running') return;
      const notes = { hit: [520, 760], gold: [660, 880, 1100], bomb: [135, 80], shot: [300], tick: [700], start: [440, 550, 660], end: [660, 550, 440], combo: [780, 980] }[kind] || [520];
      notes.forEach((frequency, index) => {
        const oscillator = this.context.createOscillator(), gain = this.context.createGain();
        const time = this.context.currentTime + index * 0.055;
        oscillator.type = kind === 'bomb' ? 'triangle' : 'sine';
        oscillator.frequency.setValueAtTime(frequency, time);
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.045, time + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.09);
        oscillator.connect(gain); gain.connect(this.context.destination);
        oscillator.start(time); oscillator.stop(time + 0.1);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      });
    },
  };
  function announce(message) { $('announcer').textContent = message; }
  function updateSound() {
    const supported = Boolean(window.AudioContext || window.webkitAudioContext);
    $('sound-button').disabled = !supported;
    $('sound-button').setAttribute('aria-pressed', String(supported && settings.sound));
    $('sound-button').setAttribute('aria-label', settings.sound ? '關閉音效' : '開啟音效');
    $('sound-button').title = supported ? (settings.sound ? '音效開啟' : '音效關閉') : '此瀏覽器不支援音效';
    $('sound-button').firstElementChild.textContent = settings.sound ? '♪' : '♩';
  }
  function showScreen(id) {
    screens.forEach(screen => { screen.hidden = screen.id !== id; });
    entities.inert = Boolean(id);
    entities.setAttribute('aria-hidden', String(Boolean(id)));
    stage.tabIndex = id ? -1 : 0;
    stage.dataset.state = engine.phase;
    $('pause-button').disabled = engine.phase !== 'playing';
    $('aim').hidden = Boolean(id) || !keyboardAim;
  }
  function updateSelection() {
    document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === settings.mode)));
    document.querySelectorAll('[data-difficulty]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.difficulty === settings.difficulty)));
    $('mode-description').textContent = descriptions[settings.mode];
    const challenge = settings.mode === 'challenge';
    $('difficulty-panel').hidden = challenge;
    $('level-panel').hidden = !challenge;
    const levelOptions = document.querySelector('.level-options');
    levelOptions.replaceChildren();
    LEVELS.forEach((level, index) => {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.level = String(index);
      button.textContent = index < settings.unlocked ? String(index + 1) : '🔒';
      button.disabled = index >= settings.unlocked;
      button.setAttribute('aria-label', `第 ${index + 1} 關：${level.name}${button.disabled ? '，尚未解鎖' : ''}`);
      button.setAttribute('aria-pressed', String(index === settings.levelIndex));
      button.addEventListener('click', () => { settings.levelIndex = index; updateSelection(); saveSettings(); });
      levelOptions.append(button);
    });
    const level = LEVELS[settings.levelIndex];
    const preview = new GameEngine();
    preview.start({ mode: 'challenge', levelIndex: settings.levelIndex });
    $('level-description').textContent = `${level.name} · ${level.duration} 秒｜${preview.goals().map(goal => goal.label).join('、')}`;
    $('start-button').replaceChildren(document.createTextNode(challenge ? `開始第 ${settings.levelIndex + 1} 關` : '開始射擊'));
    const arrow = document.createElement('span'); arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true'); $('start-button').append(arrow);
    $('mode-legend').textContent = settings.mode === 'classic' ? '小氣球 30 分 · 中 20 分 · 大 10 分 · 超大 5 分' : '✦ 金球 +25 分、+2 秒（每局最多 +10 秒） · ✕ 炸彈 −20 分';
    const best = settings.best[recordKey(settings.mode, settings.difficulty, settings.levelIndex)] || 0;
    $('best-score').replaceChildren(document.createTextNode(best.toLocaleString()));
    const unit = document.createElement('small'); unit.textContent = ' 分'; $('best-score').append(unit);
    if (engine.phase === 'menu') {
      $('time-value').textContent = challenge ? level.duration : DIFFICULTIES[settings.difficulty].duration;
      $('time-progress').style.width = '100%';
    }
  }
  function startRound() {
    audio.unlock();
    engine.start(settings);
    entities.replaceChildren(); balloonNodes.clear(); bulletNodes.clear();
    lastFrame = null; lastTick = -1; lastHud = ''; lastGoals = '';
    keyboardAim = false; aim.x = engine.width / 2; aim.y = engine.height / 2;
    effects.replaceChildren();
    showScreen(null);
    $('round-badge').hidden = engine.mode === 'challenge';
    $('round-badge').textContent = `${modeNames[engine.mode]} · ${DIFFICULTIES[engine.difficulty].label}`;
    $('mission-strip').hidden = engine.mode !== 'challenge';
    $('round-status').textContent = engine.mode === 'challenge' ? `第 ${engine.levelIndex + 1} 關 · ${LEVELS[engine.levelIndex].name}` : '點擊氣球；點擊天空可以發射子彈。';
    stage.focus({ preventScroll: true });
    audio.play('start');
    announce('遊戲開始。');
    renderEntities(); updateHud();
  }
  function returnToMenu() {
    engine.menu(); lastFrame = null; effects.replaceChildren();
    showScreen('menu-screen');
    $('mission-strip').hidden = $('round-badge').hidden = true;
    $('score-value').textContent = '0'; $('combo-value').replaceChildren(document.createTextNode('0'));
    $('multiplier-value').textContent = '×1'; $('combo-progress').style.width = '0%';
    document.querySelector('.time-item').classList.remove('urgent');
    $('round-status').textContent = '選好模式，派對就開始。';
    renderEntities(); updateSelection();
    $('start-button').focus({ preventScroll: true });
  }
  function pauseRound(reason) {
    if (!engine.pause(reason)) return;
    $('pause-description').textContent = reason === 'visibility' ? '切換分頁時已自動暫停。準備好再繼續，時間不會偷偷流走。' : '氣球和時間都在等你，準備好再繼續。';
    showScreen('pause-screen');
    if (!document.hidden) $('resume-button').focus({ preventScroll: true });
    announce('遊戲已暫停。');
  }
  function resumeRound() {
    if (!engine.resume()) return;
    audio.unlock(); lastFrame = null;
    showScreen(null); stage.focus({ preventScroll: true });
  }
  function showResults(result) {
    const key = recordKey(result.mode, result.difficulty, result.levelIndex), previousBest = settings.best[key] || 0;
    const newRecord = result.score > previousBest;
    if (newRecord) settings.best[key] = result.score;
    if (result.passed) settings.unlocked = Math.max(settings.unlocked, Math.min(LEVELS.length, result.levelIndex + 2));
    saveSettings(); updateSelection();
    $('result-title').textContent = result.mode === 'challenge' ? (result.passed ? '任務完成，漂亮！' : '再試一次，就更接近了。') : (result.score ? '漂亮的一局！' : '暖身完畢，再來一局！');
    $('result-eyebrow').textContent = result.mode === 'challenge' && result.passed ? 'MISSION COMPLETE!' : 'NICE SHOTS!';
    $('result-score').textContent = result.score;
    $('result-rank').textContent = result.mode === 'challenge' && result.passed && result.levelIndex === LEVELS.length - 1 ? '五關全破！你就是派對冠軍。' : `${result.rank} · ${modeNames[result.mode]} / ${DIFFICULTIES[result.difficulty].label}`;
    $('result-hits').textContent = result.stats.hits;
    $('result-accuracy').textContent = `${Math.round(result.accuracy)}%`;
    $('result-combo').textContent = result.maxCombo;
    $('result-shots').textContent = result.stats.shots;
    $('result-misses').textContent = result.stats.misses;
    $('result-escaped').textContent = result.stats.escaped;
    $('new-record').hidden = !newRecord;
    const goals = $('result-goals'); goals.replaceChildren(); goals.hidden = !result.goals.length;
    result.goals.forEach(goal => {
      const row = document.createElement('span'); row.classList.toggle('met', goal.met);
      row.textContent = `${goal.met ? '✓' : '○'} ${goal.label}（${goal.type === 'accuracy' ? `${Math.round(goal.value)}%` : Math.round(goal.value)}）`;
      goals.append(row);
    });
    $('next-level-button').hidden = !(result.passed && result.levelIndex < LEVELS.length - 1);
    showScreen('result-screen');
    $('round-status').textContent = '本局完成。再玩一次，挑戰新的紀錄。';
    audio.play('end');
    ($('next-level-button').hidden ? $('replay-button') : $('next-level-button')).focus({ preventScroll: true });
    announce(`遊戲結束，${result.score} 分，命中率 ${Math.round(result.accuracy)}%。`);
  }
  function updateHud() {
    const signature = [engine.score, Math.ceil(engine.remaining), engine.combo, engine.phase].join(':');
    if (signature !== lastHud) {
      $('score-value').textContent = engine.score.toLocaleString();
      $('time-value').textContent = Math.ceil(engine.remaining);
      $('combo-value').replaceChildren(document.createTextNode(String(engine.combo)));
      const suffix = document.createElement('small'); suffix.textContent = ' COMBO'; $('combo-value').append(suffix);
      $('multiplier-value').textContent = `×${engine.multiplier}`;
      document.querySelector('.time-item').classList.toggle('urgent', engine.phase === 'playing' && engine.remaining <= 5);
      lastHud = signature;
    }
    $('time-progress').style.width = `${Math.min(100, engine.remaining / (engine.duration + engine.bonusSeconds) * 100)}%`;
    $('combo-progress').style.width = `${engine.comboRemaining / 3 * 100}%`;
    if (engine.mode === 'challenge') {
      const goals = engine.goals(), text = goals.map(goal => `${goal.met}:${Math.floor(goal.value)}`).join(',');
      if (text !== lastGoals) {
        $('mission-strip').replaceChildren();
        goals.forEach(goal => {
          const chip = document.createElement('span'); chip.className = `mission-chip${goal.met ? ' met' : ''}`;
          chip.textContent = `${goal.met ? '✓' : '○'} ${goal.label} · ${goal.type === 'accuracy' ? `${Math.round(goal.value)}%` : Math.round(goal.value)}`;
          $('mission-strip').append(chip);
        });
        lastGoals = text;
      }
    }
    const tick = Math.ceil(engine.remaining);
    if (engine.phase === 'playing' && tick > 0 && tick <= 5 && tick !== lastTick) audio.play('tick');
    lastTick = tick;
  }
  function renderEntities() {
    const alive = new Set(engine.balloons.map(balloon => balloon.id));
    for (const [id, node] of balloonNodes) if (!alive.has(id)) { node.remove(); balloonNodes.delete(id); }
    for (const balloon of engine.balloons) {
      let node = balloonNodes.get(balloon.id);
      if (!node) {
        node = document.createElement('button'); node.type = 'button'; node.className = `balloon ${balloon.kind}`;
        node.dataset.balloonId = String(balloon.id); node.dataset.kind = balloon.kind;
        node.setAttribute('aria-label', balloon.kind === 'bomb' ? '炸彈，扣 20 分，請避開' : balloon.kind === 'gold' ? '金色氣球，25 分並增加 2 秒' : `${balloon.colorName}氣球，${balloon.points} 分`);
        node.style.setProperty('--balloon-color', balloon.kind === 'gold' ? '#edbd57' : balloon.kind === 'bomb' ? '#344653' : balloon.color);
        node.innerHTML = '<span class="balloon-symbol" aria-hidden="true"></span><i class="balloon-knot" aria-hidden="true"></i><i class="balloon-string" aria-hidden="true"></i>';
        node.firstElementChild.textContent = balloon.kind === 'gold' ? '✦' : balloon.kind === 'bomb' ? '✕' : '';
        node.addEventListener('click', event => {
          if (event.detail === 0 && engine.hit(balloon.id)) { handleEvents(); renderEntities(); updateHud(); stage.focus({ preventScroll: true }); }
        });
        entities.append(node); balloonNodes.set(balloon.id, node);
      }
      node.disabled = engine.phase !== 'playing';
      node.style.width = `${balloon.size}px`; node.style.height = `${balloon.size * 1.14}px`;
      node.style.transform = `translate3d(${balloon.x - balloon.size / 2}px,${balloon.y - balloon.size * 0.57}px,0)`;
    }
    const flying = new Set(engine.bullets.map(bullet => bullet.id));
    for (const [id, node] of bulletNodes) if (!flying.has(id)) { node.remove(); bulletNodes.delete(id); }
    for (const bullet of engine.bullets) {
      let node = bulletNodes.get(bullet.id);
      if (!node) { node = document.createElement('i'); node.className = 'bullet'; node.setAttribute('aria-hidden', 'true'); entities.append(node); bulletNodes.set(bullet.id, node); }
      node.style.transform = `translate3d(${bullet.x - 3}px,${bullet.y - 3}px,0)`;
    }
  }
  function popEffect(event) {
    const { balloon, points, bonus } = event;
    const label = document.createElement('span'); label.className = `floating-score${balloon.kind === 'bomb' ? ' negative' : balloon.kind === 'gold' ? ' gold-text' : ''}`;
    label.textContent = balloon.kind === 'bomb' ? '炸彈 −20' : `+${points}${bonus ? ` · +${bonus} 秒` : ''}`;
    label.style.left = `${Math.max(45, Math.min(engine.width - 55, balloon.x))}px`;
    label.style.top = `${Math.max(24, balloon.y - 15)}px`;
    effects.append(label); setTimeout(() => label.remove(), 850);
    if (!reducedMotion) {
      const burst = document.createElement('i'); burst.className = 'burst'; burst.style.left = `${balloon.x}px`; burst.style.top = `${balloon.y}px`;
      effects.append(burst); setTimeout(() => burst.remove(), 400);
    }
    audio.play(balloon.kind === 'regular' ? 'hit' : balloon.kind);
    if (event.combo && event.combo % 5 === 0) { audio.play('combo'); announce(`${event.combo} 連擊！`); }
  }
  function handleEvents() {
    for (const event of engine.drainEvents()) {
      if (event.type === 'hit') popEffect(event);
      if (event.type === 'shot') audio.play('shot');
      if (event.type === 'end') showResults(event.result);
    }
  }

  // Draw the backdrop locally: no external art, fonts or network requests during play.
  function drawScene(dt) {
    if (!reducedMotion && engine.phase !== 'paused') sceneTime += dt;
    const w = engine.width, h = engine.height;
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#b9e0e7'); gradient.addColorStop(1, '#ecf7ec');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff1b8'; ctx.beginPath(); ctx.arc(w * .82, h * .19, 32, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff5cb60'; ctx.beginPath(); ctx.arc(w * .82, h * .19, 45, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 5; i++) {
      const x = ((w * (i * .24 + .05) + sceneTime * (4 + i)) % (w + 160)) - 50;
      const y = h * (.16 + (i % 3) * .11);
      ctx.fillStyle = '#ffffffb8'; ctx.beginPath(); ctx.ellipse(x, y, 47, 17, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x - 19, y + 5, 33, 16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + 22, y + 5, 39, 14, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = '#6eaeae80'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 22); ctx.quadraticCurveTo(w / 2, 67, w, 22); ctx.stroke();
    ['#f5a18a', '#f3d98b', '#8fc9b8', '#aebae5'].forEach((color, i) => {
      for (let x = 30 + i * 27; x < w; x += 108) {
        const y = 22 + 23 * Math.sin(Math.PI * x / w);
        ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 17, y + 2); ctx.lineTo(x + 8, y + 22); ctx.closePath(); ctx.fill();
      }
    });
    ctx.fillStyle = '#b8d9be'; ctx.beginPath(); ctx.moveTo(0, h - 55); ctx.bezierCurveTo(w * .22, h - 170, w * .38, h - 30, w * .6, h - 83); ctx.bezierCurveTo(w * .8, h - 130, w * .92, h - 56, w, h - 93); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
    ctx.fillStyle = '#94c5a7'; ctx.beginPath(); ctx.moveTo(0, h - 31); ctx.bezierCurveTo(w * .3, h - 102, w * .65, h - 90, w, h - 29); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
    ctx.fillStyle = '#7ab497'; ctx.fillRect(0, h - 22, w, 22);
    ctx.fillStyle = '#ee8a70'; ctx.beginPath(); ctx.arc(w / 2, h - 10, 24, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#3f665a'; ctx.beginPath(); ctx.arc(w / 2, h - 28, 7, 0, Math.PI * 2); ctx.fill();
    if (engine.phase === 'menu') {
      [[w * .1, h * .48, '#ee8a85'], [w * .91, h * .4, '#eac271'], [w * .87, h * .7, '#8da9ce']].forEach(([x, y, color], index) => {
        const float = reducedMotion ? 0 : Math.sin(sceneTime + index) * 7;
        ctx.strokeStyle = '#59787655'; ctx.beginPath(); ctx.moveTo(x, y + float + 42); ctx.quadraticCurveTo(x - 8, y + float + 70, x + 2, y + float + 105); ctx.stroke();
        ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y + float, 31, 40, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff70'; ctx.beginPath(); ctx.ellipse(x - 10, y - 14 + float, 5, 10, -.3, 0, Math.PI * 2); ctx.fill();
      });
    }
  }
  function resize() {
    const rect = stage.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    engine.resize(rect.width, rect.height);
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    aim.x = Math.min(rect.width - 15, Math.max(15, aim.x || rect.width / 2));
    aim.y = Math.min(rect.height - 15, Math.max(15, aim.y || rect.height / 2));
    updateAim(); renderEntities(); drawScene(0);
  }
  function updateAim() { $('aim').style.left = `${aim.x}px`; $('aim').style.top = `${aim.y}px`; }
  function frame(timestamp) {
    const dt = lastFrame === null ? 0 : Math.max(0, (timestamp - lastFrame) / 1000);
    lastFrame = timestamp;
    engine.advance(dt); handleEvents(); drawScene(Math.min(dt, .05)); renderEntities();
    if (engine.phase !== 'menu') updateHud();
    requestAnimationFrame(frame);
  }
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { settings.mode = button.dataset.mode; updateSelection(); saveSettings(); }));
  document.querySelectorAll('[data-difficulty]').forEach(button => button.addEventListener('click', () => { settings.difficulty = button.dataset.difficulty; updateSelection(); saveSettings(); }));
  $('start-button').addEventListener('click', startRound);
  $('replay-button').addEventListener('click', startRound);
  $('next-level-button').addEventListener('click', () => { settings.levelIndex = Math.min(settings.levelIndex + 1, settings.unlocked - 1); saveSettings(); updateSelection(); startRound(); });
  $('resume-button').addEventListener('click', resumeRound);
  $('pause-button').addEventListener('click', () => pauseRound('manual'));
  $('pause-menu-button').addEventListener('click', returnToMenu);
  $('result-menu-button').addEventListener('click', returnToMenu);
  $('sound-button').addEventListener('click', () => { settings.sound = !settings.sound; updateSound(); saveSettings(); audio.unlock(); });
  $('fullscreen-button').hidden = !document.fullscreenEnabled;
  $('fullscreen-button').addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('game-shell').requestFullscreen(); }
    catch (_) { announce('目前無法進入全螢幕，仍可正常遊玩。'); }
  });
  stage.addEventListener('pointerdown', event => {
    if (engine.phase !== 'playing' || event.button > 0 || event.target.closest('.screen')) return;
    event.preventDefault(); keyboardAim = false; $('aim').hidden = true;
    const balloon = event.target.closest('[data-balloon-id]');
    if (balloon) engine.hit(Number(balloon.dataset.balloonId));
    else {
      const rect = stage.getBoundingClientRect(); engine.shoot(event.clientX - rect.left, event.clientY - rect.top);
    }
    stage.focus({ preventScroll: true }); handleEvents(); renderEntities(); updateHud();
  });
  document.addEventListener('keydown', event => {
    const modal = !$('pause-screen').hidden ? $('pause-screen') : !$('result-screen').hidden ? $('result-screen') : null;
    if (modal && event.key === 'Tab') {
      const buttons = [...modal.querySelectorAll('button')].filter(button => !button.disabled && !button.hidden);
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
    }
    if (event.repeat && ['Escape', 'p', 'P'].includes(event.key)) return;
    if (['Escape', 'p', 'P'].includes(event.key) && ['playing', 'paused'].includes(engine.phase)) {
      event.preventDefault(); engine.phase === 'playing' ? pauseRound('manual') : resumeRound(); return;
    }
    if (engine.phase !== 'playing' || event.target.closest('button,a') || document.activeElement !== stage) return;
    const moves = { ArrowLeft: [-18, 0], ArrowRight: [18, 0], ArrowUp: [0, -18], ArrowDown: [0, 18] };
    if (moves[event.key]) {
      event.preventDefault(); keyboardAim = true; $('aim').hidden = false;
      aim.x = Math.max(0, Math.min(engine.width, aim.x + moves[event.key][0]));
      aim.y = Math.max(0, Math.min(engine.height, aim.y + moves[event.key][1])); updateAim();
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault(); if (event.repeat) return;
      keyboardAim = true; $('aim').hidden = false; updateAim(); engine.shoot(aim.x, aim.y); handleEvents(); renderEntities(); updateHud();
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseRound('visibility'); lastFrame = null; });
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage); else window.addEventListener('resize', resize);
  updateSelection(); updateSound(); resize(); requestAnimationFrame(frame);
})();
