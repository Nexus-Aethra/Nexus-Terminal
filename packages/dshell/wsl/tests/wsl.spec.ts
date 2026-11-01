/**
 * The WSL device's pure pieces: the management output's decoding, the
 * distribution list's parsing, the argv a `wsl.exe` run is built from, and
 * the provider's registration — rows, doors, refusals — as the registry
 * reads them.
 *
 * The decoding cases come from real `wsl.exe` behavior: management output is
 * UTF-16LE with a BOM when redirected and without one in some pipes, while
 * executed Linux commands answer UTF-8. The parse cases include a localized
 * header (the columns are not always named NAME/STATE/VERSION) and both
 * spellings of the default-distribution marker.
 */
import { describe, expect, it } from 'vitest'
import { decodeWslOutput, distroOf, isWslDevice, parseWslList, wslExecArgs, WSL_EXE, WslTransport } from '../src/transport.js'
import { WslDeviceProvider } from '../src/provider.js'

function utf16le(text: string, bom = true): Buffer {
  const body = Buffer.from(text, 'utf16le')
  return bom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body
}

describe('decodeWslOutput', () => {
  it('decodes UTF-16LE with a BOM', () => {
    const raw = utf16le('NAME            STATE           VERSION\r\n')
    expect(decodeWslOutput(raw)).toContain('VERSION')
    expect(decodeWslOutput(raw)).not.toContain('\u0000')
  })

  it('decodes UTF-16LE without a BOM by the NUL-byte tell', () => {
    const raw = utf16le('Ubuntu-24.04', false)
    expect(decodeWslOutput(raw)).toBe('Ubuntu-24.04')
  })

  it('decodes UTF-8 output untouched', () => {
    const raw = Buffer.from('/root\n', 'utf8')
    // UTF-8 has no NUL run, so the heuristic must not read it as UTF-16LE.
    expect(decodeWslOutput(raw)).toBe('/root\n')
  })
})

describe('parseWslList', () => {
  it('parses the English columns, marker standalone', () => {
    const out = [
      'NAME            STATE           VERSION',
      '* Ubuntu-24.04    Running         2',
      '  Debian-12      Stopped         2',
      '  Legacy-20      Stopped         1',
    ].join('\r\n')
    expect(parseWslList(out)).toEqual([
      { name: 'Ubuntu-24.04', default: true, version: 2 },
      { name: 'Debian-12', default: false, version: 2 },
      { name: 'Legacy-20', default: false, version: 1 },
    ])
  })

  it('parses a localized header and glued marker', () => {
    // A zh-CN wsl.exe names the header in Chinese and may glue the marker
    // to the name; the states are localized words without spaces.
    const out = [
      '名称            状态            版本',
      '*Ubuntu-24.04    正在运行        2',
      '  Debian-12      已停止          2',
    ].join('\r\n')
    expect(parseWslList(out)).toEqual([
      { name: 'Ubuntu-24.04', default: true, version: 2 },
      { name: 'Debian-12', default: false, version: 2 },
    ])
  })

  it('skips lines it cannot read rather than inventing a device', () => {
    const out = [
      'NAME            STATE           VERSION',
      '  Ubuntu-24.04    Running         2',
      'Installing...', // transitional row: no trailing version digit
      '',
    ].join('\r\n')
    expect(parseWslList(out)).toHaveLength(1)
  })

  it('returns nothing for empty output', () => {
    expect(parseWslList('')).toEqual([])
  })
})

describe('wsl device identity', () => {
  it('builds the exec argv from the id', () => {
    const id = 'wsl:Ubuntu-24.04'
    expect(wslExecArgs('wsl:Ubuntu-24.04', 'echo hi')).toEqual(['-d', 'Ubuntu-24.04', '-e', 'bash', '-c', 'echo hi'])
    expect(distroOf('wsl:Ubuntu-24.04')).toBe('Ubuntu-24.04')
  })

  it('keeps a command with quotes and spaces as ONE argv element', () => {
    const args = wslExecArgs('wsl:Ubuntu-24.04', `bash -c 'printf "%s" x'`)
    expect(args[5]).toBe(`bash -c 'printf "%s" x'`)
  })

  it('recognizes built-in ids', () => {
    expect(isWslDevice('wsl:Ubuntu-24.04')).toBe(true)
    expect(isWslDevice('tencent')).toBe(false)
  })

  it('names the wsl.exe path', () => {
    expect(WSL_EXE).toMatch(/wsl\.exe$/u)
  })
})

describe('WslDeviceProvider', () => {
  const provider = new WslDeviceProvider()

  it('claims only the ids carrying the wsl prefix', () => {
    expect(provider.owns('wsl:Ubuntu-24.04')).toBe(true)
    expect(provider.owns('tencent')).toBe(false)
  })

  it('answers its doors for its own devices and nothing else', () => {
    const doors = provider.doors({ id: 'wsl:Ubuntu-24.04', name: 'Ubuntu-24.04', host: 'wsl', port: 0, user: '', remoteRoot: '~', auth: 'wsl', kind: 'wsl', secret: undefined })
    expect(doors).toBeInstanceOf(WslTransport)
    expect(provider.doors({ id: 'tencent', name: 'tencent', host: 'x', port: 22, user: 'u', remoteRoot: '~', auth: 'key', secret: undefined })).toBeUndefined()
  })

  it('refuses port forwards in its own words, for its own ids', () => {
    expect(provider.forwards).toBe(false)
    expect(provider.refusal('wsl:Ubuntu-24.04')).toContain('回环')
    expect(provider.refusal('tencent')).toBeUndefined()
  })

  it('rows carry the builtin mark and the distro name unadorned', async () => {
    // Detection runs only on Windows; elsewhere the rows are simply absent.
    const rows = await provider.rows()
    for (const row of rows) {
      expect(row.builtin).toBe(true)
      expect(row.id.startsWith('wsl:')).toBe(true)
      expect(row.name).not.toContain('wsl:')
    }
  })
})
