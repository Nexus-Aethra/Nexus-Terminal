/**
 * The device-side filesystem, against a real one.
 *
 * These run without a rig on purpose. Everything the helper decides about a
 * device is decidable from a directory: what a path canonicalizes to, what a
 * symlink is reported as, which errno becomes which code, whether a write
 * leaves a partial file behind. What needs the rig is the transport, not the
 * rules, and those rules are the part a refactor would break silently.
 */
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { stat as statPath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DeviceFileSystem, DeviceFsError } from '../src/helper/fs.js'

let root = ''
let files: DeviceFileSystem

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'dshell-device-fs-'))
  files = new DeviceFileSystem()
  await mkdir(join(root, 'sub', 'deep'), { recursive: true })
  await writeFile(join(root, 'hello.txt'), 'hello\n')
  await writeFile(join(root, 'sub', 'nested.txt'), 'nested\n')
  await symlink('hello.txt', join(root, 'link'))
  await symlink('nothing.txt', join(root, 'dangling'))
  await symlink(join(root, 'sub'), join(root, 'link-to-dir'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('resolve', () => {
  it('canonicalizes a path that does not exist yet, as `realpath -m` did', async () => {
    expect(await files.resolve(join(root, 'not', 'there', 'yet.txt'))).toBe(join(root, 'not', 'there', 'yet.txt'))
  })

  it('resolves what the device\'s own symlinks say, including inside a missing tail', async () => {
    expect(await files.resolve(join(root, 'link'))).toBe(join(root, 'hello.txt'))
    expect(await files.resolve(join(root, 'link-to-dir', 'nested.txt'))).toBe(join(root, 'sub', 'nested.txt'))
    // The prefix resolves through the link; the part that does not exist rides
    // along, which is the case a longest-prefix walk answers wrongly.
    expect(await files.resolve(join(root, 'link-to-dir', 'absent', 'x.txt'))).toBe(join(root, 'sub', 'absent', 'x.txt'))
  })

  it('normalizes a path spelled with dot segments', async () => {
    expect(await files.resolve(join(root, 'sub', '..', 'hello.txt'))).toBe(join(root, 'hello.txt'))
  })

  it('refuses to guess when a symlink cannot be followed', async () => {
    // A loop has no canonical form, and saying so is the only honest answer.
    await symlink('loop-b', join(root, 'loop-a'))
    await symlink('loop-a', join(root, 'loop-b'))
    await expect(files.resolve(join(root, 'loop-a'))).rejects.toThrow(DeviceFsError)
    await rm(join(root, 'loop-a'))
    await rm(join(root, 'loop-b'))
  })
})

describe('stat', () => {
  it('reports a file with its size and a change token', async () => {
    const info = await files.stat(join(root, 'hello.txt'), true)
    expect(info).toMatchObject({ kind: 'file', size: 6 })
    expect(info?.version).not.toBe('')
  })

  it('reports absence as null rather than as a failure', async () => {
    expect(await files.stat(join(root, 'absent.txt'), true)).toBeNull()
    // A parent that is a file is absent in the same sense; the local backend
    // reads ENOTDIR that way too.
    expect(await files.stat(join(root, 'hello.txt', 'x'), true)).toBeNull()
  })

  it('reports a symlink as a symlink only when it is not followed', async () => {
    expect(await files.stat(join(root, 'link'), false)).toMatchObject({ kind: 'symlink' })
    expect(await files.stat(join(root, 'link'), true)).toMatchObject({ kind: 'file' })
  })

  it('changes the token when the file changes', async () => {
    await writeFile(join(root, 'token.txt'), 'one\n')
    const first = await files.stat(join(root, 'token.txt'), true)
    await writeFile(join(root, 'token.txt'), 'two\n')
    const second = await files.stat(join(root, 'token.txt'), true)
    expect(first?.version).not.toBe(second?.version)
  })

  it('reports a permission failure as a code, not as a message', async () => {
    await writeFile(join(root, 'unreadable.txt'), 'x\n')
    await chmod(join(root, 'unreadable.txt'), 0o000)
    await expect(files.read(join(root, 'unreadable.txt'), 0, 8)).rejects.toMatchObject({ code: 'FS_PERMISSION_DENIED' })
    await chmod(join(root, 'unreadable.txt'), 0o600)
  })
})

describe('list', () => {
  it('lists direct children only', async () => {
    const names = (await files.list(root)).map(entry => entry.name)
    expect(names).toContain('hello.txt')
    expect(names).toContain('sub')
    expect(names).not.toContain('nested.txt')
  })

  it('reports a child through a followed probe, and a dangling link as other', async () => {
    const byName = new Map((await files.list(root)).map(entry => [entry.name, entry]))
    // What the local backend reports: a symlink to a file is a file.
    expect(byName.get('link')).toMatchObject({ kind: 'file', size: 6 })
    expect(byName.get('link-to-dir')).toMatchObject({ kind: 'directory' })
    expect(byName.get('dangling')).toMatchObject({ kind: 'other' })
    expect(byName.get('dangling')?.version).toBeUndefined()
  })

  it('reports size only for files', async () => {
    const byName = new Map((await files.list(root)).map(entry => [entry.name, entry]))
    expect(byName.get('hello.txt')?.size).toBe(6)
    expect(byName.get('sub')?.size).toBeUndefined()
  })

  it('names the failure when the target is not a directory', async () => {
    await expect(files.list(join(root, 'hello.txt'))).rejects.toMatchObject({ code: 'FS_NOT_DIRECTORY' })
    await expect(files.list(join(root, 'absent'))).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
  })
})

describe('read', () => {
  it('reads a window and comes back short at the end of the file', async () => {
    expect((await files.read(join(root, 'hello.txt'), 0, 5)).toString()).toBe('hello')
    expect((await files.read(join(root, 'hello.txt'), 3, 100)).toString()).toBe('lo\n')
    expect((await files.read(join(root, 'hello.txt'), 6, 100)).byteLength).toBe(0)
  })

  it('reports a directory as not a regular file', async () => {
    await expect(files.read(join(root, 'sub'), 0, 8)).rejects.toMatchObject({ code: 'FS_NOT_REGULAR_FILE' })
  })
})

describe('write', () => {
  it('creates a file with the owner-only mode the local backend uses', async () => {
    await files.write(join(root, 'created.txt'), Buffer.from('created\n'))
    expect((await statPath(join(root, 'created.txt'))).mode & 0o777).toBe(0o600)
    expect(await readFile(join(root, 'created.txt'), 'utf8')).toBe('created\n')
  })

  it('carries an existing file\'s mode over', async () => {
    await writeFile(join(root, 'kept.txt'), 'before\n')
    await chmod(join(root, 'kept.txt'), 0o640)
    await files.write(join(root, 'kept.txt'), Buffer.from('after\n'))
    expect((await statPath(join(root, 'kept.txt'))).mode & 0o777).toBe(0o640)
  })

  it('creates missing parents, as the assembled path did', async () => {
    await files.write(join(root, 'made', 'up', 'path', 'file.txt'), Buffer.from('x\n'))
    expect(await readFile(join(root, 'made', 'up', 'path', 'file.txt'), 'utf8')).toBe('x\n')
  })

  it('reports the version a following stat reports', async () => {
    const path = join(root, 'versioned.txt')
    const written = await files.write(path, Buffer.from('v1\n'))
    // Read after the rename, or the token would describe the inode's state
    // before the rename changed its own change time.
    expect(written.version).toBe((await files.stat(path, true))?.version)
  })

  it('leaves nothing behind when it cannot publish', async () => {
    const directory = join(root, 'read-only')
    await mkdir(directory, { recursive: true })
    await chmod(directory, 0o500)
    await expect(files.write(join(directory, 'file.txt'), Buffer.from('x\n')))
      .rejects.toMatchObject({ code: 'FS_PERMISSION_DENIED' })
    await chmod(directory, 0o700)
    // No staging name survives, and the destination was never there.
    expect(await files.list(directory)).toEqual([])
  })

  it('replaces a directory\'s name with nothing', async () => {
    await mkdir(join(root, 'a-directory'), { recursive: true })
    await expect(files.write(join(root, 'a-directory'), Buffer.from('x\n')))
      .rejects.toMatchObject({ code: 'FS_NOT_REGULAR_FILE' })
    expect((await files.stat(join(root, 'a-directory'), true))?.kind).toBe('directory')
  })
})
