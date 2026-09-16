/**
 * The Linux icon set, and the one line of config that installs it.
 *
 * This exists because electron-builder trusts the FILE NAME of each `NxN.png`
 * over the pixels inside it when it builds the AppImage's `hicolor` tree: the
 * name becomes the directory (`hicolor/256x256/apps/…`) and nothing re-measures.
 * A file saved at the wrong size therefore ships a blurred icon and reports
 * nothing — the failure this file is here to catch.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LINUX_ICON_DIR, LINUX_ICON_SIZES, withLinuxIcon } from '../linux-icons.mjs'

/** PNG dimensions sit at a fixed offset in the IHDR chunk — no decoder needed. */
function pngSize(file: string): { width: number; height: number } {
  const header = readFileSync(file).subarray(0, 24)
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
}

describe('the linux icon set', () => {
  it('holds exactly the sizes the builder is told to expect', () => {
    const found = readdirSync(LINUX_ICON_DIR)
      .filter(name => /^\d+x\d+\.png$/u.test(name))
      .map(name => Number.parseInt(name, 10))
      .sort((left, right) => left - right)
    expect(found).toEqual(LINUX_ICON_SIZES)
  })

  it('names every file the size its pixels actually are', () => {
    for (const size of LINUX_ICON_SIZES) {
      expect(pngSize(join(LINUX_ICON_DIR, `${size}x${size}.png`)), `${size}x${size}.png`).toEqual({ width: size, height: size })
    }
  })

  it('reaches 512, so the .desktop entry gets a launcher-sized icon', () => {
    expect(Math.max(...LINUX_ICON_SIZES)).toBeGreaterThanOrEqual(512)
  })
})

describe('the builder override', () => {
  it('adds the icon and leaves the rest of the upstream config alone', () => {
    const upstream = {
      appId: 'com.example.app',
      files: ['lib/*.js'],
      linux: { category: 'Development', target: ['AppImage'] },
    }
    expect(withLinuxIcon(upstream)).toEqual({
      appId: 'com.example.app',
      files: ['lib/*.js'],
      linux: { category: 'Development', target: ['AppImage'], icon: LINUX_ICON_DIR },
    })
  })
})
