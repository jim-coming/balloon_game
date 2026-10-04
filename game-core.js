/* Pure game rules shared by the browser and Node tests. */
(function (root) {
  'use strict';
  const DIFFICULTIES = Object.freeze({
    easy: { label: '簡單', spawn: 1.4, speed: [38, 70], sizes: [54, 64, 74], duration: 40, bombRate: 0 },
    normal: { label: '普通', spawn: 1.05, speed: [55, 105], sizes: [38, 44, 54, 64], duration: 30, bombRate: 0.06 },
    hard: { label: '困難', spawn: 0.7, speed: [85, 150], sizes: [28, 34, 40, 50], duration: 25, bombRate: 0.1 },
    insane: { label: '地獄', spawn: 0.42, speed: [125, 210], sizes: [20, 24, 30, 36], duration: 20, bombRate: 0.14 },
  });
  const LEVELS = Object.freeze([
    { name: '暖身派對', difficulty: 'easy', duration: 40, goals: [{ type: 'hits', target: 8 }] },
    { name: '找回節奏', difficulty: 'normal', duration: 35, goals: [{ type: 'score', target: 200 }, { type: 'combo', target: 5 }] },
    { name: '黃金時刻', difficulty: 'normal', duration: 35, goals: [{ type: 'gold', target: 2 }, { type: 'score', target: 250 }] },
    { name: '精準出擊', difficulty: 'hard', duration: 35, goals: [{ type: 'hits', target: 12 }, { type: 'accuracy', target: 70 }] },
    { name: '派對冠軍', difficulty: 'insane', duration: 35, goals: [{ type: 'score', target: 500 }, { type: 'combo', target: 8 }, { type: 'bombs', target: 1 }] },
  ]);
  const COLORS = [
    { value: '#f16a69', name: '珊瑚紅' }, { value: '#58b9a4', name: '薄荷綠' },
    { value: '#798ee3', name: '天空藍' }, { value: '#e59ac5', name: '粉紅' },
    { value: '#f0b859', name: '橙黃' },
  ];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const pointsForSize = size => size <= 34 ? 30 : size <= 48 ? 20 : size <= 64 ? 10 : 5;
  const multiplierFor = combo => Math.min(2, 1 + Math.floor(combo / 5) * 0.25);

  // Return the first intersection along a shot, including fast shots that cross a target.
  function segmentCircleT(x1, y1, x2, y2, cx, cy, radius) {
    const dx = x2 - x1, dy = y2 - y1, fx = x1 - cx, fy = y1 - cy;
    const c = fx * fx + fy * fy - radius * radius;
    if (c <= 0) return 0;
    const a = dx * dx + dy * dy;
    if (a === 0) return null;
    const b = 2 * (fx * dx + fy * dy), discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const t = (-b - Math.sqrt(discriminant)) / (2 * a);
    return t >= 0 && t <= 1 ? t : null;
  }

  class GameEngine {
    constructor({ random = Math.random, width = 960, height = 600, reducedMotion = false } = {}) {
      this.random = random;
      this.width = width;
      this.height = height;
      this.reducedMotion = reducedMotion;
      this.phase = 'menu';
      this.mode = 'classic';
      this.difficulty = 'normal';
      this.levelIndex = 0;
      this.balloons = [];
      this.bullets = [];
      this.events = [];
      this.score = 0;
      this.remaining = 30;
      this.combo = 0;
      this.comboRemaining = 0;
      this.maxCombo = 0;
      this.stats = { shots: 0, hits: 0, misses: 0, escaped: 0, gold: 0, bombs: 0 };
    }
    get scale() { return clamp(this.width / 900, 0.65, 1.2); }
    get accuracy() { return this.stats.shots ? this.stats.hits / this.stats.shots * 100 : 0; }
    get multiplier() { return multiplierFor(this.combo); }
    get config() { return DIFFICULTIES[this.difficulty]; }
    start({ mode = 'classic', difficulty = 'normal', levelIndex = 0 } = {}) {
      this.mode = ['classic', 'arcade', 'challenge'].includes(mode) ? mode : 'classic';
      this.levelIndex = clamp(Math.floor(Number(levelIndex) || 0), 0, LEVELS.length - 1);
      this.difficulty = this.mode === 'challenge' ? LEVELS[this.levelIndex].difficulty : (Object.hasOwn(DIFFICULTIES, difficulty) ? difficulty : 'normal');
      this.duration = this.mode === 'challenge' ? LEVELS[this.levelIndex].duration : this.config.duration;
      this.remaining = this.duration;
      this.score = this.combo = this.maxCombo = this.elapsed = this.bonusSeconds = this.spawnAccum = this.spawnCount = this.nextId = 0;
      this.comboRemaining = 0;
      this.stats = { shots: 0, hits: 0, misses: 0, escaped: 0, gold: 0, bombs: 0 };
      this.balloons = [];
      this.bullets = [];
      this.events = [{ type: 'start' }];
      this.phase = 'playing';
      this.spawnBalloon('regular');
    }
    spawnBalloon(forcedKind) {
      if (this.phase !== 'playing' || this.balloons.length >= 28) return null;
      const cfg = this.config, baseSize = cfg.sizes[Math.floor(this.random() * cfg.sizes.length)];
      let kind = forcedKind || 'regular';
      this.spawnCount++;
      if (!forcedKind && this.mode !== 'classic') {
        const roll = this.random();
        kind = roll < cfg.bombRate ? 'bomb' : roll < cfg.bombRate + 0.12 ? 'gold' : 'regular';
        // Every fifth spawn in the gold mission is golden: the objective is always available.
        if (this.mode === 'challenge' && this.levelIndex === 2 && this.spawnCount % 5 === 0) kind = 'gold';
      }
      const size = Math.max(30, (kind === 'regular' ? baseSize : 48) * this.scale);
      const radius = size / 2, x = radius + this.random() * Math.max(0, this.width - size);
      const color = COLORS[Math.floor(this.random() * COLORS.length)];
      const balloon = {
        id: ++this.nextId, kind, size, x, baseX: x, y: this.height - 42 - radius,
        speed: (cfg.speed[0] + this.random() * (cfg.speed[1] - cfg.speed[0])) * this.scale,
        drift: (this.random() - 0.5) * 12 * this.scale,
        age: 0, wobble: this.random() * Math.PI * 2,
        points: kind === 'gold' ? 25 : pointsForSize(baseSize), color: color.value, colorName: color.name,
      };
      this.balloons.push(balloon);
      return balloon;
    }
    resetCombo() { this.combo = this.comboRemaining = 0; }
    hit(id) {
      if (this.phase !== 'playing') return false;
      const balloon = this.balloons.find(item => item.id === id);
      if (!balloon) return false;
      this.stats.shots++;
      this.resolveHit(balloon);
      return true;
    }
    resolveHit(balloon) {
      this.balloons = this.balloons.filter(item => item.id !== balloon.id);
      let points, bonus = 0;
      if (balloon.kind === 'bomb') {
        const oldScore = this.score;
        this.score = Math.max(0, this.score - 20);
        points = this.score - oldScore;
        this.stats.bombs++;
        this.stats.misses++;
        this.resetCombo();
      } else {
        this.stats.hits++;
        this.combo++;
        this.comboRemaining = 3;
        this.maxCombo = Math.max(this.maxCombo, this.combo);
        points = Math.round(balloon.points * this.multiplier);
        this.score += points;
        if (balloon.kind === 'gold') {
          this.stats.gold++;
          bonus = Math.min(2, 10 - this.bonusSeconds);
          this.bonusSeconds += bonus;
          this.remaining += bonus;
        }
      }
      this.events.push({ type: 'hit', balloon: { ...balloon }, points, bonus, combo: this.combo });
    }
    shoot(x, y) {
      if (this.phase !== 'playing' || !Number.isFinite(x) || !Number.isFinite(y) || this.bullets.length >= 40) return false;
      const sx = this.width / 2, sy = this.height - 28, distance = Math.hypot(x - sx, y - sy);
      this.stats.shots++;
      if (distance < 1) {
        this.stats.misses++;
        this.resetCombo();
        this.events.push({ type: 'miss' });
        return true;
      }
      const speed = 780 * this.scale;
      this.bullets.push({ id: ++this.nextId, x: sx, y: sy, vx: (x - sx) / distance * speed, vy: (y - sy) / distance * speed, ttl: 2.5 });
      this.events.push({ type: 'shot' });
      return true;
    }
    advance(seconds) {
      if (this.phase !== 'playing' || !Number.isFinite(seconds) || seconds <= 0) return;
      const elapsed = Math.min(seconds, this.remaining);
      this.remaining = Math.max(0, this.remaining - elapsed);
      this.elapsed += elapsed;
      this.comboRemaining = Math.max(0, this.comboRemaining - elapsed);
      if (!this.comboRemaining) this.combo = 0;
      // The clock uses real elapsed time; cap catch-up movement after a stalled frame.
      const dt = Math.min(elapsed, 0.25);
      this.spawnAccum += dt;
      while (this.spawnAccum >= this.config.spawn) {
        this.spawnAccum -= this.config.spawn;
        this.spawnBalloon();
      }
      for (const balloon of this.balloons) {
        balloon.age += dt;
        balloon.baseX += balloon.drift * dt;
        const wobble = this.reducedMotion ? 0 : Math.sin(balloon.age * 2 + balloon.wobble) * 12 * this.scale;
        balloon.x = clamp(balloon.baseX + wobble, balloon.size / 2, this.width - balloon.size / 2);
        balloon.y -= balloon.speed * dt;
      }
      this.balloons = this.balloons.filter(balloon => {
        if (balloon.y + balloon.size / 2 >= -20) return true;
        if (balloon.kind !== 'bomb') this.stats.escaped++;
        return false;
      });
      const survivors = [];
      for (const bullet of this.bullets) {
        const previousX = bullet.x, previousY = bullet.y;
        bullet.x += bullet.vx * dt;
        bullet.y += bullet.vy * dt;
        bullet.ttl -= dt;
        let nearest = null, nearestT = Infinity;
        for (const balloon of this.balloons) {
          const t = segmentCircleT(previousX, previousY, bullet.x, bullet.y, balloon.x, balloon.y, balloon.size / 2 + 3);
          if (t !== null && t < nearestT) { nearest = balloon; nearestT = t; }
        }
        if (nearest) this.resolveHit(nearest);
        else if (bullet.ttl <= 0 || bullet.x < -8 || bullet.x > this.width + 8 || bullet.y < -8 || bullet.y > this.height + 8) {
          this.stats.misses++;
          this.resetCombo();
          this.events.push({ type: 'miss' });
        } else survivors.push(bullet);
      }
      this.bullets = survivors;
      if (this.remaining <= 0) this.finish();
    }
    pause(reason = 'manual') {
      if (this.phase !== 'playing') return false;
      this.phase = 'paused';
      this.events.push({ type: 'pause', reason });
      return true;
    }
    resume() {
      if (this.phase !== 'paused') return false;
      this.phase = 'playing';
      this.events.push({ type: 'resume' });
      return true;
    }
    menu() {
      this.phase = 'menu';
      this.balloons = [];
      this.bullets = [];
      this.events = [];
      this.resetCombo();
    }
    finish() {
      if (this.phase !== 'playing') return false;
      this.phase = 'ended';
      this.stats.misses += this.bullets.length;
      this.bullets = [];
      this.balloons = [];
      this.events.push({ type: 'end', result: this.summary() });
      return true;
    }
    resize(width, height) {
      if (!(width > 0 && height > 0)) return;
      const rx = width / this.width, ry = height / this.height;
      for (const balloon of this.balloons) {
        balloon.x *= rx; balloon.baseX *= rx; balloon.y *= ry;
        balloon.size = Math.max(30, balloon.size * rx); balloon.speed *= ry; balloon.drift *= rx;
      }
      for (const bullet of this.bullets) { bullet.x *= rx; bullet.y *= ry; bullet.vx *= rx; bullet.vy *= ry; }
      this.width = width; this.height = height;
    }
    goals() {
      if (this.mode !== 'challenge') return [];
      return LEVELS[this.levelIndex].goals.map(goal => {
        const values = { hits: this.stats.hits, score: this.score, combo: this.maxCombo, gold: this.stats.gold, accuracy: this.accuracy, bombs: this.stats.bombs };
        const labels = { hits: `命中 ${goal.target} 顆氣球`, score: `得分 ${goal.target} 分`, combo: `最高連擊 ${goal.target}`, gold: `命中 ${goal.target} 顆金球`, accuracy: `命中率至少 ${goal.target}%`, bombs: `炸彈命中不超過 ${goal.target} 次` };
        const value = values[goal.type];
        return { ...goal, label: labels[goal.type], value, met: goal.type === 'bombs' ? value <= goal.target : value >= goal.target };
      });
    }
    summary() {
      const goals = this.goals();
      return { score: this.score, mode: this.mode, difficulty: this.difficulty, levelIndex: this.levelIndex,
        stats: { ...this.stats }, accuracy: this.accuracy, maxCombo: this.maxCombo, elapsed: this.elapsed,
        goals, passed: goals.length > 0 && goals.every(goal => goal.met),
        rank: this.score >= 500 ? '神射手' : this.score >= 250 ? '精準射手' : this.score >= 100 ? '氣球獵人' : '越玩越上手' };
    }
    drainEvents() { const events = this.events; this.events = []; return events; }
  }
  const api = Object.freeze({ DIFFICULTIES, LEVELS, COLORS, GameEngine, segmentCircleT, pointsForSize, multiplierFor });
  root.BalloonGameCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
