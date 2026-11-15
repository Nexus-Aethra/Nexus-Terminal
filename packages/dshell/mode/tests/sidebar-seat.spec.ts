/**
 * Where the sidebar's terminal section rides, and why it is not in the region.
 *
 * The section is mounted into a node dsh owns, so its seat is a fact about
 * dsh's sidebar tree rather than about this package. dsh 0.2.2 restructured
 * that tree: the browsing region moved out of the sidebar column into a nested
 * scroll viewport (`.scrollRegion` > `.scrollArea`, a grid whose tracks are
 * `4px | 1fr | ~6px`). An insertion that anchored on the region — "after the
 * workspace list" — then landed inside that grid as an auto-placed item in the
 * 4px gutter track, and the section rendered as a sliver: measured 4x8 pixels
 * against the real 0.2.2-rc.3 sidebar, invisible under the viewport's
 * `overflow-x: hidden`.
 *
 * The rule these pin down: the seat is the COLUMN, reached through the foot,
 * and it is the same element in both layouts. The trees below are the two
 * shapes as dsh builds them, so a layout that moves the region again fails
 * here rather than in a reader's sidebar.
 */

import { describe, expect, it } from 'vitest'
import { sidebarSeat } from '../src/client/terminal-section.js'

/** One node of a sidebar tree, with the parent link dsh gives it. */
interface FakeNode {
  readonly name: string
  readonly parentElement: FakeNode | null
}

/** Build one node of a sidebar tree. */
function node(name: string, parentElement: FakeNode | null = null): FakeNode {
  return { name, parentElement }
}

/** The node a selector would have returned, as far as `sidebarSeat` reads it. */
function asElement(fake: FakeNode | null): Element | null {
  return fake as unknown as Element | null
}

/** dsh 0.2.1: the region is the column's own `flex:1` child, right above the foot. */
function sidebar021(): { root: FakeNode; region: FakeNode; foot: FakeNode; hole: FakeNode } {
  const root = node('root')
  const region = node('regionArea', root)
  const foot = node('footArea', root)
  const hole = node('hole', region)
  return { root, region, foot, hole }
}

/** dsh 0.2.2: the region moved into the scroll viewport, a grid inside the column. */
function sidebar022(): { root: FakeNode; region: FakeNode; foot: FakeNode; hole: FakeNode } {
  const root = node('root')
  const scrollRegion = node('scrollRegion', root)
  const scrollArea = node('scrollArea', scrollRegion)
  const region = node('regionArea', scrollArea)
  const foot = node('footArea', root)
  const hole = node('hole', region)
  return { root, region, foot, hole }
}

describe('sidebarSeat — the column, reached through the foot', () => {
  it('rides in the column under dsh 0.2.1, where the region is its own child', () => {
    const { root, region, foot, hole } = sidebar021()
    const seat = sidebarSeat(asElement(hole), asElement(foot))
    expect(seat?.column).toBe(asElement(root))
    expect(seat?.column).not.toBe(asElement(region))
    expect(seat?.foot).toBe(asElement(foot))
  })

  it('rides in the same column under dsh 0.2.2, where the region is nested in the viewport', () => {
    const { root, region, foot, hole } = sidebar022()
    const seat = sidebarSeat(asElement(hole), asElement(foot))
    expect(seat?.column).toBe(asElement(root))
    expect(seat?.column).not.toBe(asElement(region))
  })

  it('has no seat before the sidebar mounts', () => {
    const { foot } = sidebar022()
    expect(sidebarSeat(null, asElement(foot))).toBeUndefined()
    expect(sidebarSeat(asElement(node('hole')), null)).toBeUndefined()
  })

  it('has no seat while the foot has no parent to ride in', () => {
    expect(sidebarSeat(asElement(node('hole')), asElement(node('footArea')))).toBeUndefined()
  })
})
