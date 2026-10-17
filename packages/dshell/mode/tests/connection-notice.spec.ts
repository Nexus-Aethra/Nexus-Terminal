/**
 * Which screen a session's terminal connection gets.
 *
 * The rules here are a precedence, and a precedence is exactly the thing a test
 * should pin: five facts decide between "nothing", "a marker on the output the
 * user is reading" and "a screen of its own", and the order they are consulted
 * in is what stops a machine with no shell from being presented as a flaky
 * network.
 */

import { describe, expect, it } from 'vitest'
import { connectionView, type ConnectionFacts } from '../src/client/connection-notice.js'

/** The facts a session is in by default: an idle local session, nothing wrong. */
function facts(over: Partial<ConnectionFacts> = {}): ConnectionFacts {
  return {
    status: 'idle', ready: false, attempt: 0, bound: false, localUnsupported: false, ...over,
  }
}

describe('a machine that cannot host a local shell', () => {
  it('gets a screen of its own, not a marker on output that does not exist', () => {
    // The case this exists for: on Windows a local spawn fails immediately, so
    // `ready` is false and there is no output behind it to append a line to.
    const view = connectionView(facts({ status: 'error', localUnsupported: true }))
    expect(view).toEqual({ kind: 'panel', phase: 'unsupported' })
  })

  it('outranks a local session still starting up', () => {
    // Otherwise a Windows reader gets the "waiting for a device" screen for a
    // session that is not on a device at all.
    const view = connectionView(facts({
      status: 'connecting', bound: false, ready: false, localUnsupported: true,
    }))
    expect(view).toEqual({ kind: 'panel', phase: 'unsupported' })
  })

  it('leaves a DEVICE session alone — its shell runs on the device', () => {
    // The whole point of the bound check: Windows is a perfectly good place to
    // run an ssh client from, so a bound session must still get its normal
    // connecting screen and its retry.
    const view = connectionView(facts({
      status: 'connecting', bound: true, ready: false, localUnsupported: true,
    }))
    expect(view).toEqual({ kind: 'panel', phase: 'connecting' })
  })

  it('stays quiet while no terminal has been asked for', () => {
    // The flag is set by a failed spawn, but a reader who has not opened a
    // terminal yet should not be met by a screen about one.
    expect(connectionView(facts({ status: 'idle', localUnsupported: true })))
      .toEqual({ kind: 'none' })
  })

  it('forgets the fact for the next session', () => {
    expect(connectionView(facts({ status: 'error', localUnsupported: true })))
      .toEqual({ kind: 'panel', phase: 'unsupported' })
    // A fresh bind starts clean, so an ordinary failure is an ordinary failure.
    expect(connectionView(facts({ status: 'error' })))
      .toEqual({ kind: 'notice', tone: 'failed' })
  })
})

describe('the screens that were already there', () => {
  it('keeps a bound session that never answered on the connecting screen', () => {
    expect(connectionView(facts({ status: 'connecting', bound: true })))
      .toEqual({ kind: 'panel', phase: 'connecting' })
  })

  it('keeps a bound session that HAD answered as a marker, not a screen', () => {
    expect(connectionView(facts({ status: 'connecting', bound: true, ready: true })))
      .toEqual({ kind: 'notice', tone: 'connecting' })
  })

  it('shows a first local failure as a plain retry notice', () => {
    expect(connectionView(facts({ status: 'error' })))
      .toEqual({ kind: 'notice', tone: 'failed' })
  })

  it('says nothing at all about a local session that is merely starting', () => {
    expect(connectionView(facts({ status: 'connecting' }))).toEqual({ kind: 'none' })
  })
})
