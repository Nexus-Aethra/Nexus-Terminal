import { describe, expect, it } from 'vitest'
import { discoverChromium } from '../src/chromium.ts'
import { browserArgs, runsOnThisMachine } from '../src/index.ts'

describe('chromium discovery', () => {
  it('takes the first installed candidate in the order it is listed', () => {
    const installed = new Set(['/usr/bin/chromium', '/usr/bin/google-chrome'])
    expect(discoverChromium(path => installed.has(path))).toBe('/usr/bin/google-chrome')
  })

  it('reports nothing when the machine has no browser', () => {
    // Undefined is not a failure: the pinned server's own discovery runs next,
    // and its clear "not installed" error is what the model should read.
    expect(discoverChromium(() => false)).toBeUndefined()
  })
})

describe('the server command line', () => {
  it('always isolates the browser and redirects its output', () => {
    // Without --output-dir the server writes .playwright-mcp/ into the
    // session's working directory, which is the user's project.
    expect(browserArgs({ headless: true }, '/data/browser')).toEqual([
      '--browser', 'chromium', '--isolated', '--output-dir', '/data/browser', '--headless',
    ])
  })

  it('passes a visible window and an explicit executable through', () => {
    expect(browserArgs({ headless: false, executablePath: '/opt/chrome' }, '/data/browser')).toEqual([
      '--browser', 'chromium', '--isolated', '--output-dir', '/data/browser',
      '--executable-path', '/opt/chrome',
    ])
  })
})

describe('the local-session rule', () => {
  const agent = (cwd?: string) => ({ id: 'session-1', session: { header: cwd === undefined ? {} : { cwd } } })
  const never = (): boolean => false
  const mount = (path: string): boolean => path.startsWith('/home/u/.dsh/dshell/mnt/')

  it('refuses a session that is bound to a device', () => {
    expect(runsOnThisMachine(agent('/home/u/project'), () => true, mount)).toBe(false)
  })

  it('refuses a session whose directory is a mount, before its binding lands', () => {
    // Creation and binding are two round trips: at agent creation a brand-new
    // device session still has no assignment, and only the cwd tells them
    // apart (see router.ts, interactiveShellPlan).
    expect(runsOnThisMachine(agent('/home/u/.dsh/dshell/mnt/dev/tmp/x'), never, mount)).toBe(false)
  })

  it('keeps an ordinary local session', () => {
    expect(runsOnThisMachine(agent('/home/u/project'), never, mount)).toBe(true)
  })

  it('keeps a session whose directory the harness never set', () => {
    expect(runsOnThisMachine(agent(), never, mount)).toBe(true)
  })
})
