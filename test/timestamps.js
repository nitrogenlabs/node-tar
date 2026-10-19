import t from 'tap'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import * as esm from '@nlabs/tar'

const cjs = createRequire(import.meta.url)('@nlabs/tar')

for (const [format, tar] of [
  ['esm', esm],
  ['commonjs', cjs],
]) {
  for (const sync of [false, true]) {
    t.test(`${format} public timestamps sync=${sync}`, async t => {
      for (const ms of [
        1001, -1001, 8639999999999999, -8639999999999999, 8640000000000000,
        -8640000000000000,
      ]) {
        await t.test(`Date mtime=${ms}`, async t => {
          const cwd = t.testdir({ file: 'body' })
          const file = `${cwd}/archive.tar`
          await tar.create(
            { cwd, file, mtime: new Date(ms), portable: true, sync },
            ['file'],
          )
          const times = []
          await tar.list({
            file,
            onReadEntry: entry => {
              times.push(entry.mtime.getTime())
            },
            sync,
          })
          t.same(times, [ms], 'public root retains Date precision')
          const repacked = `${cwd}/repacked.tar`
          await tar.create({ cwd, file: repacked, sync }, [`@${file}`])
          const repackedTimes = []
          await tar.list({
            file: repacked,
            onReadEntry: entry => {
              repackedTimes.push(entry.mtime.getTime())
            },
            sync,
          })
          t.same(repackedTimes, [ms], 'repacking retains Date precision')
        })
      }
      for (const ms of [1700000000125, -1125, 1700000000000, -1000]) {
        await t.test(
          `filesystem mtime=${ms}`,
          {
            skip:
              process.platform === 'win32' &&
              'symlink fixtures require privileges',
          },
          async t => {
            const cwd = t.testdir({ dir: {}, file: 'timestamp body' })
            fs.linkSync(`${cwd}/file`, `${cwd}/hard`)
            fs.symlinkSync('file', `${cwd}/sym`)
            const date = new Date(ms)
            for (const name of ['file', 'dir', 'sym']) {
              fs.lutimesSync(`${cwd}/${name}`, date, date)
              t.equal(
                fs.lstatSync(`${cwd}/${name}`).mtime.getTime(),
                ms,
                `${name} filesystem supports the fixture milliseconds`,
              )
            }
            const file = `${cwd}/archive.tar`
            const statTimes = {}
            await tar.create(
              {
                cwd,
                file,
                onWriteEntry: entry => {
                  statTimes[entry.path] = [
                    entry.stat.atime.getTime(),
                    entry.stat.ctime.getTime(),
                  ]
                },
                sync,
              },
              ['file', 'hard', 'dir', 'sym'],
            )
            const entries = []
            const parsedTimes = {}
            await tar.list({
              file,
              onReadEntry: entry => {
                parsedTimes[entry.path] = [
                  entry.atime.getTime(),
                  entry.ctime.getTime(),
                ]
                entries.push({
                  linkpath: entry.linkpath,
                  mtime: entry.mtime.getTime(),
                  path: entry.path,
                  type: entry.type,
                })
              },
              sync,
            })
            t.same(
              parsedTimes,
              statTimes,
              'retain filesystem atime and ctime milliseconds',
            )
            t.same(entries, [
              {
                linkpath: undefined,
                mtime: ms,
                path: 'file',
                type: 'File',
              },
              { linkpath: 'file', mtime: ms, path: 'hard', type: 'Link' },
              {
                linkpath: undefined,
                mtime: ms,
                path: 'dir/',
                type: 'Directory',
              },
              {
                linkpath: 'file',
                mtime: ms,
                path: 'sym',
                type: 'SymbolicLink',
              },
            ])
            const out = `${cwd}/out`
            fs.mkdirSync(out)
            await tar.extract({ cwd: out, file, sync })
            t.equal(
              fs.readFileSync(`${out}/file`, 'utf8'),
              'timestamp body',
            )
            t.equal(
              fs.readFileSync(`${out}/hard`, 'utf8'),
              'timestamp body',
            )
            t.equal(fs.readlinkSync(`${out}/sym`), 'file')
            t.equal(
              fs.statSync(`${out}/file`).ino,
              fs.statSync(`${out}/hard`).ino,
            )
            for (const name of ['file', 'hard', 'dir']) {
              t.equal(
                fs.lstatSync(`${out}/${name}`).mtime.getTime(),
                ms,
                `${name} extracted milliseconds`,
              )
            }
            // Upstream extraction does not set symlink timestamps.
            const repacked = `${cwd}/repacked.tar`
            await tar.create({ cwd, file: repacked, sync }, [`@${file}`])
            const times = []
            await tar.list({
              file: repacked,
              onReadEntry: entry => {
                times.push(entry.mtime.getTime())
              },
              sync,
            })
            t.same(
              times,
              [ms, ms, ms, ms],
              'parsed-entry repacking preserves dates',
            )
          },
        )
      }
      for (const [options, expected, pax] of [
        [{ portable: true }, 1700000000125, true],
        [{ noPax: true, portable: true }, 1700000000000, false],
        [{ noMtime: true, portable: true }, undefined, false],
        [
          { mtime: new Date(-1125), noPax: true, portable: true },
          -2000,
          false,
        ],
        [
          { mtime: new Date(1700000000000), portable: true },
          1700000000000,
          false,
        ],
      ]) {
        await t.test(`options ${JSON.stringify(options)}`, async t => {
          const cwd = t.testdir({ dir: {}, file: 'body' })
          const file = `${cwd}/archive.tar`
          await tar.create(
            {
              cwd,
              file,
              mtime: new Date(1700000000125),
              sync,
              ...options,
            },
            ['file', 'dir'],
          )
          t.equal(
            new tar.Header(fs.readFileSync(file)).type,
            pax ? 'ExtendedHeader' : 'File',
          )
          const entries = []
          await tar.list({
            file,
            onReadEntry: entry => {
              entries.push([
                entry.mtime?.getTime(),
                entry.atime,
                entry.ctime,
              ])
            },
            sync,
          })
          t.same(
            entries,
            [
              [expected, undefined, undefined],
              [undefined, undefined, undefined],
            ],
            'portable directory omits dates',
          )
          const repacked = `${cwd}/repacked.tar`
          await tar.create(
            {
              cwd,
              file: repacked,
              mtime: new Date(1700000000125),
              sync,
              ...options,
            },
            [`@${file}`],
          )
          const times = []
          await tar.list({
            file: repacked,
            onReadEntry: entry => {
              times.push(entry.mtime?.getTime())
            },
            sync,
          })
          t.same(
            times,
            [expected, undefined],
            'repacking retains timestamp options',
          )
        })
      }
    })
  }
}
