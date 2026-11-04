/**
 * The same surface claim, measured against ANY dsh checkout.
 *
 * scripts/tests/upstream-surface.spec.ts guards the checkout dsh-upstream.json pins.
 * That is the gate a release runs, but it cannot answer "would the NEXT dsh still
 * work?" — which is exactly the question a peer-range widening has to ask before it
 * is written, because the version gate compares numbers and a dsh release may drop
 * or rename any name dshell reaches for while the range still admits it.
 *
 * Point DSH_SURFACE_ROOT at a checkout and this asks the same question of it:
 *
 *   DSH_SURFACE_ROOT=path/to/dsh vitest run scripts/tests/upstream-surface-any.spec.ts
 *
 * The default is the pinned mirror, so a plain run reads the same checkout as the
 * release gate and the two agree.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DSHELL_SURFACE,
  UPSTREAM_SURFACE_FILES,
  missingSurface,
  readUpstreamSurface,
  type SurfaceGap,
} from '../upstream-surface.ts'

// Any dsh checkout can be measured: point DSH_SURFACE_ROOT at it. The default is
// the pinned mirror, so the plain `vitest run` reading is unchanged.
const MIRROR = process.env.DSH_SURFACE_ROOT ?? fileURLToPath(new URL('../../dsh', import.meta.url))

function readMirrorFile(p: string): string {
  return readFileSync(join(MIRROR, p), 'utf8')
}

function listMirrorSources(): readonly string[] {
  const found: string[] = []
  const skip = new Set(['node_modules', 'lib', 'dist'])
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue
      const p = join(dir, name)
      const entry = statSync(p)
      if (entry.isDirectory()) walk(p)
      else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) {
        found.push(relative(MIRROR, p).replaceAll('\\', '/'))
      }
    }
  }
  walk(join(MIRROR, 'packages'))
  return found
}

const declared = readUpstreamSurface(readMirrorFile, listMirrorSources)

function describeGap(gap: SurfaceGap): string {
  return gap.kind + " '" + gap.name + "' (used at " + gap.usedAt + ')'
}

describe('the dsh surface dshell consumes, against the checkout named by DSH_SURFACE_ROOT', () => {
  it('is declared by the 0.2.2-rc.1 mirror', () => {
    expect(missingSurface(DSHELL_SURFACE, declared).map(describeGap)).toEqual([])
  })

  it('still carries the browser-side services', () => {
    const clientOnly = ['slots', 'uiConversation', 'locale', 'sidebarRightTabs', 'inputTriggers']
    expect(clientOnly.filter(name => !declared.services.has(name))).toEqual([])
  })

  it('reads a mirror that has the catalogs it depends on', () => {
    expect(declared.services.size).toBeGreaterThan(100)
    expect(declared.slots.size).toBeGreaterThan(50)
    expect(declared.events.size).toBeGreaterThan(20)
  })

  it('reports what it measured', () => {
    // A gate that found nothing would pass silently; this makes the reading visible.
    console.log('MEASURED services=' + declared.services.size + ' slots=' + declared.slots.size + ' events=' + declared.events.size)
    expect(declared.services.size).toBeGreaterThan(0)
  })
  it('has the three catalog files the reader needs', () => {
    for (const p of Object.values(UPSTREAM_SURFACE_FILES)) {
      expect(() => readMirrorFile(p)).not.toThrow()
    }
  })
})
