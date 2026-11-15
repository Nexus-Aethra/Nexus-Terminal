/**
 * The dsh plugin package shape dshell publishes, asserted rather than remembered.
 *
 * dsh reads a plugin's display metadata out of `locale/<lang>.json` (title and
 * description), its icon and package fields through the exported `./package.json`
 * and `./locale/*.json` subpaths, and it resolves a client plugin's upstream module
 * closure from `dsh.client.inject`. A package that ships none of that still installs
 * and boots — it simply shows a raw package name in Plugins and Settings, and its
 * browser half asks the host for modules nobody declared. None of that is a type
 * error, so it was never caught here.
 *
 * The other half is what gets PUBLISHED: `files` used to be the whole `lib`
 * directory, so every tarball carried its sourcemaps and declaration maps — dead
 * weight the upstream package contract explicitly excludes. These checks pin the
 * shape against what the build actually emits, so adding a runtime module without
 * listing it fails here instead of 404-ing inside a profile.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PACKAGES = fileURLToPath(new URL('../../packages/dshell', import.meta.url))

/** Every package directory in the workspace, by name. */
const NAMES: readonly string[] = readdirSync(PACKAGES)
  .filter(name => existsSync(join(PACKAGES, name, 'package.json')))
  .sort()

interface Manifest {
  readonly exports?: Record<string, unknown>
  readonly files?: readonly string[]
  readonly dsh?: { readonly client?: { readonly inject?: readonly string[] } }
}

function manifestOf(pkg: string): Manifest {
  return JSON.parse(readFileSync(join(PACKAGES, pkg, 'package.json'), 'utf8')) as Manifest
}

/** Every emitted runtime module under a package's lib/, sourcemaps excluded. */
function emittedModules(pkg: string): readonly string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) { walk(path); continue }
      if (!entry.endsWith('.js') || entry.endsWith('.js.map')) continue
      found.push(relative(join(PACKAGES, pkg), path).replaceAll('\\', '/'))
    }
  }
  walk(join(PACKAGES, pkg, 'lib'))
  return found.sort()
}

/**
 * Whether a `files` pattern covers a path — the segment/`**` semantics npm uses.
 * @param pattern - one entry of a package's `files` list.
 * @param file - the path being tested, relative to the package root.
 * @returns true when the pattern publishes that path.
 */
function covers(pattern: string, file: string): boolean {
  const parts = pattern.split('/')
  const target = file.split('/')
  const step = (pi: number, ti: number): boolean => {
    if (pi === parts.length) return ti === target.length
    const head = parts[pi]
    if (head === '**') return step(pi + 1, ti) || (ti < target.length && step(pi, ti + 1))
    if (ti >= target.length) return false
    const rx = new RegExp('^' + head.split('*').map(part => part.replaceAll('.', '\\.')).join('[^/]*') + '$')
    return rx.test(target[ti]) && step(pi + 1, ti + 1)
  }
  return step(0, 0)
}

describe('the published plugin shape', () => {
  it('ships display metadata in English and Chinese', () => {
    for (const pkg of NAMES) {
      for (const lang of ['en', 'zh']) {
        const file = join(PACKAGES, pkg, 'locale', lang + '.json')
        expect(existsSync(file), pkg + ' is missing locale/' + lang + '.json').toBe(true)
        const body = JSON.parse(readFileSync(file, 'utf8')) as { meta?: Record<string, unknown> }
        const meta = body.meta
        expect(meta, pkg + ' locale/' + lang + '.json has no meta').toBeTypeOf('object')
        for (const field of ['title', 'description']) {
          const value = meta?.[field]
          expect(value, pkg + ' locale/' + lang + '.json meta.' + field).toBeTypeOf('string')
          expect((value as string).trim().length, pkg + ' meta.' + field + ' is empty').toBeGreaterThan(0)
        }
      }
    }
  })

  it('exports the resource subpaths the host reads metadata through', () => {
    for (const pkg of NAMES) {
      const exports = manifestOf(pkg).exports ?? {}
      expect(Object.keys(exports), pkg).toContain('./package.json')
      expect(Object.keys(exports), pkg).toContain('./locale/*.json')
    }
  })

  it('publishes every emitted runtime module and no sourcemap', () => {
    for (const pkg of NAMES) {
      const files = manifestOf(pkg).files ?? []
      expect(files, pkg).toContain('locale/*.json')
      for (const module of emittedModules(pkg)) {
        expect(files.some(pattern => covers(pattern, module)), pkg + ' does not publish ' + module).toBe(true)
      }
      for (const pattern of files) {
        expect(pattern.endsWith('.map'), pkg + ' publishes a sourcemap: ' + pattern).toBe(false)
      }
    }
  })

  it('ships a repository-root bundle whose patch is the one the bundle package owns', () => {
    // The root is what `dsh plugin add github:Nexus-Aethra/Nexus-Terminal` installs,
    // so it has to be a bundle in its own right: a `dsh.bundle` declaration, the patch
    // file it names, and an entry module. The patch is a copy of the one the npm
    // bundle package ships — two files that must never drift apart, because a root
    // installed from GitHub and a bundle installed from npm compose the same rows.
    const root = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string } }
      exports?: Record<string, unknown>
      files?: readonly string[]
      icon?: string
      dependencies?: Record<string, string>
    }
    expect(root.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(Object.keys(root.exports ?? {})).toContain('./cordis.patch.yml')
    for (const needed of ['index.js', 'index.d.ts', 'cordis.patch.yml', 'icon.png']) {
      expect(root.files, 'root files').toContain(needed)
      expect(existsSync(join(REPO_ROOT, needed)), needed).toBe(true)
    }
    expect(root.icon).toBe('./icon.png')
    expect(Object.keys(root.dependencies ?? {})).toContain('@nexus-aethra/dshell-mode')
    const rootPatch = readFileSync(join(REPO_ROOT, 'cordis.patch.yml'), 'utf8')
    const bundlePatch = readFileSync(join(PACKAGES, 'bundle', 'cordis.patch.yml'), 'utf8')
    expect(rootPatch).toBe(bundlePatch)
  })

  it('declares the client module closure for every browser half', () => {
    for (const pkg of NAMES) {
      const manifest = manifestOf(pkg)
      const hasClient = Object.keys(manifest.exports ?? {}).includes('./client')
      const inject = manifest.dsh?.client?.inject
      if (hasClient) {
        expect(inject, pkg + ' has a ./client export but no dsh.client.inject').toBeTypeOf('object')
        expect((inject ?? []).length, pkg + ' declares an empty dsh.client.inject').toBeGreaterThan(0)
      } else {
        expect(inject, pkg + ' is host-only and must not declare dsh.client').toBeUndefined()
      }
    }
  })
})
