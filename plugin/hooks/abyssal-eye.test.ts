import { expect, test } from 'claude-code/testing'

import { analyze, computeEdges, isTracked } from './analyzer'
import { looksOnly, LOOK_TOOL } from './classify'
import { parseTranscript, projectSlug } from './backfill'
import { Tracker } from './tracker'

const PLAYER = `using UnityEngine;
// class Fake {}
public class Player : MonoBehaviour
{
    [SerializeField] float speed = 3f;
    void Update() { Move(); }
    void Move()
    {
        var s = "class NotReal {";
        Health.Damage(1);
    }
    public int Score => 3;
}
public struct Health
{
    public static void Damage(int n) { }
}`

const SAVE_TS = `import { Player } from './player'
export class SaveSystem extends Store {
  save(p: Player): void { write(p) }
  async load() { return 1 }
}
export function write(x: unknown) { return x }
export const helper = (a: number) => a + 1
`

const MODULE_TS = `export type Shape = { kind: string }
export interface Spell { cast(): void }
export const DEFAULTS = {
  speed: 3,
}
export const fast = (a: number) => a * 2
export function slow(a: number) {
  return a
}
`

const PS1 = `# a script
function Start-Server {
  if ($x) { Write-Host 'hi' }
}
<# block
comment #>
filter Only-Odd { $_ % 2 }
`

const PY = `class Ritual(Base):
    def chant(self):
        pass
    def bind(self, other):
        return Tome()

def summon():
    return Ritual()
`

test('the analyzer finds types, members and bindings across languages', async () => {
  const cs = analyze('Assets/Player.cs', PLAYER)
  expect(cs.types.map(t => t.name)).toEqual(['Player', 'Health'])
  expect(cs.types[0].kind).toBe('behaviour')
  expect(cs.types[0].members.map(m => m.name)).toEqual(['Update', 'Move'])
  expect(cs.types[0].members[0].callback).toBe(true)
  expect(cs.types[1].kind).toBe('struct')

  const ts = analyze('src/save.ts', SAVE_TS)
  const names = ts.types.map(t => t.name)
  expect(names).toContain('SaveSystem')
  expect(ts.types.find(t => t.name === 'SaveSystem')?.members.map(m => m.name)).toEqual(['save', 'load'])
  expect(ts.types[0].members.map(m => m.name)).toEqual(['write', 'helper'])

  // modules without classes: type aliases are types, exported objects and arrow consts are members
  const mod = analyze('src/module.ts', MODULE_TS)
  expect(mod.types[0].kind).toBe('function')
  expect(mod.types[0].members.map(m => m.name)).toEqual(['DEFAULTS', 'fast', 'slow'])
  expect(mod.types.find(t => t.name === 'Shape')?.kind).toBe('interface')
  expect(mod.types.find(t => t.name === 'Spell')?.members.map(m => m.name)).toEqual(['cast'])
  const ps = analyze('tools/server.ps1', PS1)
  expect(ps.types[0].kind).toBe('function')
  expect(ps.types[0].members.map(m => [m.name, m.start, m.end])).toEqual([['Start-Server', 2, 4], ['Only-Odd', 7, 7]])
  expect(isTracked('tools/server.ps1')).toBe(true)

  const py = analyze('py/ritual.py', PY)
  expect(py.types.find(t => t.name === 'Ritual')?.members.map(m => m.name)).toEqual(['chant', 'bind'])

  const files = new Map([[cs.rel, cs], [ts.rel, ts]])
  const edges = computeEdges(files)
  expect(edges.has('Assets/Player.cs#Player\nAssets/Player.cs#Health')).toBe(true)
  expect(edges.has('src/save.ts#SaveSystem\nAssets/Player.cs#Player')).toBe(true)

  expect(isTracked('Library/x.cs')).toBe(false)
  expect(isTracked('Assets/Scripts/a.cs')).toBe(true)
  expect(isTracked('src/types.d.ts')).toBe(false)
})


test('the map grows from touched files, and an edit that ties two classes goes pending, then live', async () => {
  const tr = new Tracker()
  tr.root = 'C:\\proj'
  expect(tr.rel('C:\\proj\\A\\Player.cs')).toBe('A/Player.cs')
  tr.setFile('A/Player.cs', 'class Player { void Go() { } }', true)
  tr.setFile('B/Save.cs', 'class Save { void Write() { } }', true)
  expect(tr.log.filter(e => e.type === 'node').length).toBe(2)
  expect(tr.log.some(e => e.type === 'edge')).toBe(false)

  const next = 'class Player { void Go() { Save.Write(); } }'
  const pending = tr.propose('A/Player.cs', next)
  expect(pending).toEqual(['A/Player.cs#Player\nB/Save.cs#Save'])
  const p = tr.log[tr.log.length - 1]
  expect(p.type === 'edge' && p.state === 'pending' && p.cross).toBe(true)

  tr.setFile('A/Player.cs', next, false)
  tr.settle(pending)
  const live = tr.log.filter(e => e.type === 'edge' && e.state === 'live')
  expect(live.length).toBe(1)
  expect(live[0].type === 'edge' && live[0].baseline).toBeUndefined()
  expect(tr.log.some(e => e.type === 'edge' && e.state === 'gone')).toBe(false)
  expect(tr.locate('A/Player.cs', 1)).toEqual({ node: 'A/Player.cs#Player', member: 'Go' })

  // a binding that already existed when a file came onto the map is baseline, not new
  tr.setFile('C/Hud.cs', 'class Hud { void Show() { Player.Go(); } }', true)
  const hud = tr.log[tr.log.length - 1]
  expect(hud.type === 'edge' && hud.baseline).toBe(true)

  // denied edit: pending withdrawn
  const p2 = tr.propose('B/Save.cs', 'class Save { void Write() { Hud.Show(); } }')
  tr.settle(p2)
  expect(tr.log[tr.log.length - 1]).toMatchObject({ type: 'edge', state: 'gone' })

  // the batch is JSON lines without seq (the server numbers them)
  const lines = (tr.takeBatch() ?? '').split('\n')
  expect(lines.length).toBe(tr.log.length)
  expect(lines[0].startsWith('{"type":"node"')).toBe(true)
  expect(lines.some(l => l.includes('"seq"'))).toBe(false)
  expect(new Set(tr.log.map(e => e.seq)).size).toBe(tr.log.length)
})

test('read-only commands and lookup tools are looks, changes are not', async () => {
  for (const c of ['ls -la src', 'cat a.txt | grep foo | wc -l', 'git status', 'git log --oneline -5', 'grep -rn x . 2>/dev/null',
    'curl -s http://127.0.0.1:7311/ping', 'Get-ChildItem -Recurse | Select-Object Name', 'sed -n 1,20p file.ts', 'X=1 head -5 f']) {
    expect([c, looksOnly(c)]).toEqual([c, true])
  }
  for (const c of ['rm -rf build', 'echo hi > out.txt', 'git commit -m x', 'npm install', 'sed -i s/a/b/ f', 'ls && rm x',
    'curl -X POST http://x', 'cat a | tee b', 'dotnet build', 'mkdir -p x']) {
    expect([c, looksOnly(c)]).toEqual([c, false])
  }
  expect(LOOK_TOOL.test('mcp__Claude_Browser__read_page')).toBe(true)
  expect(LOOK_TOOL.test('ToolSearch')).toBe(true)
  expect(LOOK_TOOL.test('mcp__Claude_Browser__navigate')).toBe(false)
  expect(LOOK_TOOL.test('mcp__gmail__send_message')).toBe(false)
})

test('a transcript replays into prompts, tool uses and results', async () => {
  const lines = [
    { type: 'user', timestamp: '2026-10-14T10:00:00.000Z', message: { role: 'user', content: 'Add a dash ability' } },
    { type: 'user', timestamp: '2026-10-14T10:00:00.500Z', isMeta: true, message: { role: 'user', content: 'meta noise' } },
    { type: 'user', timestamp: '2026-10-14T10:00:00.600Z', message: { role: 'user', content: '<command-name>/clear</command-name>' } },
    { type: 'assistant', timestamp: '2026-10-14T10:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'C:\p\A.cs' } }] } },
    { type: 'user', timestamp: '2026-10-14T10:00:02.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'x' }] } },
    { type: 'user', timestamp: '2026-10-14T10:00:03.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu2', is_error: true, content: 'no' }] } },
    { type: 'queue-operation', timestamp: '2026-10-14T10:00:04.000Z' },
  ].map(o => JSON.stringify(o)).join('\n') + '\nnot json\n'
  const m = parseTranscript(lines)
  expect(m.map(x => x.type)).toEqual(['prompt', 'use', 'result', 'result'])
  expect(m[0]).toMatchObject({ type: 'prompt', text: 'Add a dash ability' })
  expect(m[1]).toMatchObject({ type: 'use', id: 'tu1', tool: 'Read' })
  expect(m[3]).toMatchObject({ type: 'result', id: 'tu2', failed: true })
  expect(m[1].t - m[0].t).toBe(1000)
  expect(projectSlug('C:\\Projects\\Example')).toBe('C--Projects-Example')
})

test('every language family yields member blocks', async () => {
  const go = analyze('pkg/ship.go', `package ship
import "fmt"
type Hull struct {
  Mass float64
}
type Sailor interface {
  Row()
}
func (h *Hull) Weigh() float64 {
  return h.Mass
}
func Launch(h Hull) {
  fmt.Println(h)
}
`)
  expect(go.types.find(t => t.name === 'Hull')?.members.map(m => m.name)).toEqual(['Weigh'])
  expect(go.types.find(t => t.name === 'Sailor')?.kind).toBe('interface')
  expect(go.types[0].members.map(m => m.name)).toEqual(['Launch'])

  const rs = analyze('src/lib.rs', `mod util;
pub struct Crest { pub h: f32 }
impl Crest {
    pub fn new() -> Self { Crest { h: 0.0 } }
}
impl Display for Crest {
    fn fmt(&self, f: &mut Formatter) -> Result { Ok(()) }
}
pub trait Wave { fn roll(&self); }
pub fn free() -> u32 { 1 }
`)
  const crest = rs.types.find(t => t.name === 'Crest')
  expect(crest?.members.map(m => m.name)).toEqual(['new', 'fmt'])
  expect(rs.types.find(t => t.name === 'Wave')?.kind).toBe('interface')
  expect(rs.types[0].members.map(m => m.name)).toEqual(['free'])
  expect(rs.includes).toContain('util')

  const c = analyze('src/engine.cpp', `#include "engine.h"
namespace sea {
struct Tide {
  int level;
  void rise(int by) { level += by; }
};
int main(int argc, char** argv) {
  return 0;
}
}
`)
  expect(c.types.find(t => t.name === 'Tide')?.members.map(m => m.name)).toEqual(['rise'])
  expect(c.types[0].members.map(m => m.name)).toEqual(['main'])
  expect(c.includes).toEqual(['engine.h'])

  const objc = analyze('ios/Boat.m', `#import "Boat.h"
@implementation Boat
- (void)sail:(int)knots {
  x = knots;
}
+ (Boat *)make {
  return nil;
}
@end
`)
  expect(objc.types.find(t => t.name === 'Boat')?.members.map(m => m.name)).toEqual(['sail', 'make'])

  const kt = analyze('app/Main.kt', `object Registry {
  fun lookup(id: Int): String { return "" }
}
class Anchor(val w: Int) : Heavy() {
  fun drop() { }
}
fun main() { }
`)
  expect(kt.types.find(t => t.name === 'Registry')?.kind).toBe('static')
  expect(kt.types.find(t => t.name === 'Anchor')?.members.map(m => m.name)).toEqual(['drop'])
  expect(kt.types[0].members.map(m => m.name)).toEqual(['main'])

  const swift = analyze('ios/Rope.swift', `protocol Knot { func tie() }
struct Rope {
  func pull() { }
}
extension Rope {
  func coil() { }
}
`)
  expect(swift.types.find(t => t.name === 'Rope')?.members.map(m => m.name)).toEqual(['pull', 'coil'])
  expect(swift.types.find(t => t.name === 'Knot')?.kind).toBe('interface')

  const rb = analyze('lib/dock.rb', `require_relative 'pier'
module Harbor
  class Dock < Base
    def moor(ship)
      ship.each do |s|
        s.stop
      end
    end
    def self.open?; true; end
  end
end
def helper
  1
end
`)
  expect(rb.types.find(t => t.name === 'Dock')?.members.map(m => [m.name, m.start, m.end])).toEqual([['moor', 4, 8], ['open?', 9, 9]])
  expect(rb.types[0].members.map(m => m.name)).toEqual(['helper'])
  expect(rb.includes).toEqual(['pier'])

  const lua = analyze('game/boat.lua', `local M = {}
function M.float(x)
  if x then return 1 end
  return 0
end
local function hidden()
end
return M
`)
  expect(lua.types[0].members.map(m => [m.name, m.start, m.end])).toEqual([['float', 2, 5], ['hidden', 6, 7]])

  const ex = analyze('lib/fleet.ex', `defmodule Fleet do
  def sail(ships) do
    Enum.map(ships, fn s -> s end)
  end
  defp hidden, do: 1
end
`)
  expect(ex.types.find(t => t.name === 'Fleet')?.members.map(m => [m.name, m.start, m.end])).toEqual([['sail', 2, 4], ['hidden', 5, 5]])

  const hs = analyze('src/Tide.hs', `module Tide where
import Data.List
data Tide = High | Low
rise :: Int -> Int
rise x = x + 1
fall x =
  x - 1
`)
  expect(hs.types[0].members.map(m => m.name)).toEqual(['rise', 'fall'])
  expect(hs.types.find(t => t.name === 'Tide')?.kind).toBe('record')

  const sh = analyze('tools/build.sh', `#!/bin/sh
greet() {
  echo hi # {
}
function stop {
  exit 0
}
`)
  expect(sh.types[0].members.map(m => [m.name, m.start, m.end])).toEqual([['greet', 2, 4], ['stop', 5, 7]])

  const sql = analyze('db/schema.sql', `CREATE TABLE ships (id int);
CREATE OR REPLACE FUNCTION launch() RETURNS void AS $$ $$;
CREATE VIEW fleet AS SELECT * FROM ships;
`)
  expect(sql.types[0].members.map(m => m.name)).toEqual(['ships', 'launch', 'fleet'])

  const css = analyze('web/style.scss', `@use 'base';
.hull { color: red; .mast { x: 1 } }
#deck > a:hover { y: 2 }
`)
  expect(css.types[0].members.map(m => m.name)).toEqual(['.hull', '#deck > a:hover'])
  expect(css.includes).toEqual(['base'])

  const html = analyze('web/index.html', `<html><body>
<section id="intro"><p>hi</p></section>
<script>
function go() {}
</script>
</body></html>
`)
  expect(html.types[0].members.map(m => m.name)).toEqual(['body', '#intro', 'script'])

  const vue = analyze('web/Card.vue', `<template>
  <div>{{ a }}</div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
function bump() { }
const n = ref(1)
</script>
<style scoped>
.a { x: 1 }
</style>
`)
  expect(vue.types[0].members.map(m => m.name)).toEqual(['template', 'bump', 'style'])

  const json = analyze('package.json', `{
  "name": "x",
  "scripts": { "build": "tsc" },
  "deps": ["a", "b"]
}
`)
  expect(json.types[0].members.map(m => m.name)).toEqual(['name', 'scripts', 'deps'])
  const yaml = analyze('ci.yml', `name: ci
on:
  push: {}
jobs:
  build:
    runs-on: x
`)
  expect(yaml.types[0].members.map(m => m.name)).toEqual(['name', 'on', 'jobs'])
  const toml = analyze('Cargo.toml', `[package]
name = "x"
[dependencies]
serde = "1"
`)
  expect(toml.types[0].members.map(m => m.name)).toEqual(['package', 'dependencies'])

  const md = analyze('README.md', `# Title
text
## Usage
\`\`\`
# not a heading
\`\`\`
### Notes
`)
  expect(md.types[0].members.map(m => m.name)).toEqual(['Title', 'Usage', 'Notes'])

  const txt = analyze('notes/plan.txt', `Phase one
  gather wood
  build hull

Phase two
  raise mast
`)
  expect(txt.types[0].members.map(m => m.name)).toEqual(['Phase one', 'Phase two'])

  expect(isTracked('a/b.png')).toBe(false)
  expect(isTracked('package-lock.json')).toBe(false)
  expect(isTracked('vendor/x.go')).toBe(false)
  expect(isTracked('Makefile')).toBe(true)
  expect(isTracked('x.unknownext')).toBe(true)
})
