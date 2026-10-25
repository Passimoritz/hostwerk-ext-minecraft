'use strict';
// HostwerkBridge: die eingecheckte JAR passt zu den Quellen (Version aus pom.xml, Java 17, Symbol dabei) –
// sonst wurde nach einer Änderung „node tools/bridge.js“ vergessen.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readZip, verify, pomVersion } = require(path.join(__dirname, '..', 'tools', 'bridge'));

const DIR = path.join(__dirname, '..', 'server', 'bridge');
const JAR = path.join(DIR, 'HostwerkBridge.jar');
const lf = (s) => s.replace(/\r\n/g, '\n');

test('eingecheckte JAR: Version aus pom.xml, Java 17, Symbol', () => {
  const { version, icon } = verify(JAR);
  assert.strictEqual(version, pomVersion());
  assert.strictEqual(icon, 'hostwerk-icon.svg');
});

test('Symbol und plugin.yml in der JAR entsprechen den Quellen', () => {
  const zip = readZip(JAR);
  const src = (f) => lf(fs.readFileSync(path.join(DIR, 'src', 'main', 'resources', f), 'utf8'));
  assert.strictEqual(lf(zip.get('hostwerk-icon.svg')().toString('utf8')), src('hostwerk-icon.svg'));
  assert.strictEqual(lf(zip.get('plugin.yml')().toString('utf8')), src('plugin.yml').replace('${project.version}', pomVersion()));
});

test('Beschreibung: übersetzt und ohne veralteten Text', () => {
  const de = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', 'de.json'), 'utf8'));
  const live = fs.readFileSync(path.join(__dirname, '..', 'server', 'liveupdate.js'), 'utf8');
  const en = (live.match(/bridgeDescription\(\) \{ return T\('([^']+)'\)/) || [])[1];
  assert.ok(en, 'bridgeDescription() in liveupdate.js');
  assert.ok(de[en], 'deutsche Übersetzung in locales/de.json');
  assert.ok(!Object.keys(de).some((k) => k.startsWith('Connection to Hostwerk')), 'alter Text entfernt');
});
