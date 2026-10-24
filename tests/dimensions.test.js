'use strict';
// Reine Funktionen der Dimensionen (ohne Hostwerk): Eigenschaften aus dimension_type, Biome, SVG-Entschärfung.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Ohne Hostwerk: Kernbausteine und Bibliotheken als Attrappen (die Erweiterung holt sie sonst über host.core/host.lib)
require(path.join(__dirname, '..', 'server', 'hw')).init({ core: (n) => ({ download: { cached: async (k, t, fn) => fn() } })[n] || {}, lib: () => ({}) });
const { typeTraits, biomesOf, cleanSvg } = require(path.join(__dirname, '..', 'server', 'dimensions'));

test('dimension_type: neues Format mit attributes', () => {
  const t = typeTraits({ has_skylight: false, has_ceiling: true, has_fixed_time: true, skybox: 'none', attributes: { 'minecraft:gameplay/water_evaporates': true, 'minecraft:visual/fog_color': '#330808' } });
  assert.deepStrictEqual([t.sky, t.ceiling, t.hot, t.skybox, t.fogColor], [false, true, true, 'none', '#330808']);
});

test('dimension_type: altes Format (effects, fixed_time, Farbe als Zahl)', () => {
  const t = typeTraits({ effects: 'minecraft:the_end', fixed_time: 6000, has_skylight: false, attributes: { 'minecraft:visual/sky_color': 0x123456 } });
  assert.deepStrictEqual([t.skybox, t.fixedTime, t.skyColor], ['end', true, '#123456']);
});

test('Biome aus dem Generator', () => {
  assert.deepStrictEqual(biomesOf({ biome_source: { type: 'minecraft:fixed', biome: 'minecraft:cherry_grove' } }), ['minecraft:cherry_grove']);
  assert.deepStrictEqual(biomesOf({ biome_source: { type: 'minecraft:multi_noise', biomes: [{ biome: 'a:b' }, { biome: '#a:tag' }, { biome: 'a:c' }] } }), ['a:b', 'a:c']);
  assert.deepStrictEqual(biomesOf({ biome_source: { type: 'minecraft:the_end' } }), ['minecraft:the_end', 'minecraft:end_highlands']);
});

test('Katalog-SVG wird entschärft', () => {
  const out = cleanSvg('<svg viewBox="0 0 32 32"><script>alert(1)</script><rect onclick="x()" fill="url(#a)"/><image href="https://evil.example/x.png"/></svg>');
  assert.ok(!/script|onclick|evil\.example/.test(out));
  assert.ok(/url\(#a\)/.test(out));
  assert.strictEqual(cleanSvg('<div>nein</div>'), null);
});

test('mitgelieferter Katalog: drei gezeichnete Dimensionen', () => {
  const cat = require(path.join(__dirname, '..', 'catalog', 'mc-dimensions.json'));
  for (const id of ['minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end']) assert.ok(cleanSvg(cat.dimensions[id].svg), id);
});
