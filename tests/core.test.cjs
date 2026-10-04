const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GameEngine, segmentCircleT, LEVELS, multiplierFor } = require('../game-core.js');
function game(options = {}) {
  const engine = new GameEngine({ random: () => .5, reducedMotion: true });
  engine.start(options);
  return engine;
}
function hitRegular(engine) { const target = engine.spawnBalloon('regular'); assert.ok(engine.hit(target.id)); }

test('movement and remaining time agree at 30 and 120 frames per second', () => {
  const run = fps => {
    const engine = game(); engine.spawnAccum = -100;
    for (let i = 0; i < fps; i++) engine.advance(1 / fps);
    return engine;
  };
  const slow = run(30), fast = run(120);
  assert.ok(Math.abs(slow.remaining - fast.remaining) < 1e-8);
  assert.ok(Math.abs(slow.balloons[0].y - fast.balloons[0].y) < 1e-8);
});
test('pausing freezes the clock and entities; resuming continues the same round', () => {
  const engine = game(); const y = engine.balloons[0].y;
  engine.pause(); engine.advance(500);
  assert.equal(engine.remaining, 30); assert.equal(engine.balloons[0].y, y);
  assert.equal(engine.hit(engine.balloons[0].id), false);
  engine.resume(); engine.advance(1);
  assert.equal(engine.remaining, 29); assert.ok(engine.balloons[0].y < y);
});
test('a delayed frame finishes once and counts unresolved shots as misses', () => {
  const engine = game(); engine.shoot(0, 0); engine.advance(90);
  assert.equal(engine.phase, 'ended'); assert.equal(engine.remaining, 0);
  assert.equal(engine.stats.shots, engine.stats.hits + engine.stats.misses);
  assert.equal(engine.drainEvents().filter(event => event.type === 'end').length, 1);
  engine.advance(90); assert.equal(engine.drainEvents().length, 0);
});
test('hitting the same balloon twice cannot award points or count a second shot', () => {
  const engine = game(), target = engine.balloons[0];
  assert.equal(engine.hit(target.id), true); const score = engine.score;
  assert.equal(engine.hit(target.id), false); assert.equal(engine.score, score);
  assert.equal(engine.stats.hits, 1); assert.equal(engine.stats.shots, 1);
});
test('gold balloons add score and time with a ten-second round cap', () => {
  const engine = game({ mode: 'arcade' });
  for (let i = 0; i < 7; i++) engine.hit(engine.spawnBalloon('gold').id);
  assert.equal(engine.stats.gold, 7); assert.equal(engine.bonusSeconds, 10);
  assert.equal(engine.remaining, 40); assert.ok(engine.score > 7 * 25);
});
test('bombs break a combo, count as misses, and never make the score negative', () => {
  const engine = game({ mode: 'arcade' }); hitRegular(engine);
  engine.hit(engine.spawnBalloon('bomb').id);
  assert.equal(engine.score, 0); assert.equal(engine.combo, 0); assert.equal(engine.stats.bombs, 1);
  assert.equal(engine.stats.misses, 1); assert.equal(engine.accuracy, 50);
});
test('combos expire after three seconds and the multiplier is bounded', () => {
  const engine = game(); for (let i = 0; i < 5; i++) hitRegular(engine);
  assert.equal(engine.multiplier, 1.25); assert.equal(engine.maxCombo, 5);
  engine.advance(3.1); assert.equal(engine.combo, 0); assert.equal(engine.multiplier, 1);
  assert.equal(multiplierFor(1000), 2);
});
test('a shot at its own origin is a safe miss, never a NaN projectile', () => {
  const engine = game(); assert.ok(engine.shoot(engine.width / 2, engine.height - 28));
  assert.equal(engine.bullets.length, 0); assert.equal(engine.stats.misses, 1);
  assert.equal(engine.shoot(NaN, 0), false); assert.equal(engine.stats.shots, 1);
});
test('swept collision finds the first target even if one frame crosses two balloons', () => {
  assert.equal(segmentCircleT(0, 0, 100, 0, 50, 0, 10), .4);
  assert.equal(segmentCircleT(0, 30, 100, 30, 50, 0, 10), null);
  const engine = game(), near = engine.balloons[0], far = engine.spawnBalloon('regular');
  Object.assign(near, { x: 480, baseX: 480, y: 490, speed: 0, size: 40 });
  Object.assign(far, { x: 480, baseX: 480, y: 425, speed: 0, size: 40 });
  engine.shoot(480, 0); engine.advance(.25);
  assert.equal(engine.stats.hits, 1); assert.ok(engine.balloons.some(balloon => balloon.id === far.id));
  assert.ok(!engine.balloons.some(balloon => balloon.id === near.id));
});
test('classic spawns only ordinary balloons, while the gold mission guarantees golden targets', () => {
  const classic = game(); for (let i = 0; i < 20; i++) classic.spawnBalloon();
  assert.ok(classic.balloons.every(balloon => balloon.kind === 'regular'));
  const mission = game({ mode: 'challenge', levelIndex: 2 }); mission.random = () => .99;
  for (let i = 0; i < 4; i++) mission.spawnBalloon();
  assert.ok(mission.balloons.some(balloon => balloon.kind === 'gold'));
});
test('mission success requires all goals, including accuracy and bomb limits', () => {
  const warmup = game({ mode: 'challenge', levelIndex: 0 });
  for (let i = 0; i < 8; i++) hitRegular(warmup);
  assert.equal(warmup.summary().passed, true);
  const precision = game({ mode: 'challenge', levelIndex: 3 });
  for (let i = 0; i < 12; i++) hitRegular(precision);
  for (let i = 0; i < 8; i++) precision.shoot(precision.width / 2, precision.height - 28);
  assert.equal(precision.summary().passed, false);
  const final = game({ mode: 'challenge', levelIndex: 4 });
  final.score = 999; final.maxCombo = 10; final.stats.bombs = 2;
  assert.equal(final.summary().passed, false); assert.equal(LEVELS.length, 5);
});
test('restarting clears previous targets, bullets, bonuses and statistics', () => {
  const engine = game({ mode: 'arcade' }); engine.hit(engine.spawnBalloon('gold').id); engine.shoot(0, 0);
  engine.start({ mode: 'classic', difficulty: 'easy' });
  assert.equal(engine.score, 0); assert.equal(engine.remaining, 40); assert.equal(engine.bonusSeconds, 0);
  assert.equal(engine.bullets.length, 0); assert.equal(engine.balloons.length, 1); assert.equal(engine.stats.shots, 0);
});
test('invalid difficulty names fall back safely and entity counts remain bounded', () => {
  const engine = game({ difficulty: 'toString' }); assert.equal(engine.difficulty, 'normal');
  for (let i = 0; i < 200; i++) { engine.spawnBalloon(); engine.shoot(0, 0); }
  assert.ok(engine.balloons.length <= 28); assert.ok(engine.bullets.length <= 40);
  engine.resize(360, 530);
  assert.ok(engine.balloons.every(balloon => Number.isFinite(balloon.x) && balloon.size >= 30));
});
test('all five missions can be completed through real hits before their time limits', () => {
  for (let levelIndex = 0; levelIndex < LEVELS.length; levelIndex++) {
    const engine = game({ mode: 'challenge', levelIndex });
    while (engine.phase === 'playing' && !engine.summary().passed) {
      const target = engine.balloons.find(balloon => balloon.kind !== 'bomb');
      if (target) engine.hit(target.id);
      else for (let i = 0; i < Math.ceil(engine.config.spawn / .05); i++) engine.advance(.05);
    }
    assert.equal(engine.phase, 'playing', `Mission ${levelIndex + 1} timed out`);
    engine.advance(engine.remaining + 1);
    assert.equal(engine.summary().passed, true, `Mission ${levelIndex + 1} failed`);
  }
});
