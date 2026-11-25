// A small streaming zip writer for the account export (#215): each entry is deflated from an
// async source of chunks straight into the output, so a table is never held in memory. Sizes and
// CRCs follow each entry in a data descriptor, and the central directory is written at the end.
// No ZIP64: an archive past 4 GB (or 65535 entries) is refused rather than written wrong.
import { Writable, Readable } from 'stream';
import { pipeline } from 'stream/promises';
import * as zlib from 'zlib';

const MAX_32 = 0xffffffff;
const MAX_ENTRIES = 0xffff;
// bit 3: sizes and CRC in a data descriptor after the data; bit 11: UTF-8 names
const FLAGS = 0x0008 | 0x0800;
const DEFLATE = 8;
const VERSION = 20;

export class ZipTooLargeError extends Error {
    constructor() {
        super('The export is larger than a zip file can hold (4 GB)');
        this.name = 'ZipTooLargeError';
    }
}

interface CentralEntry {
    name: Buffer;
    crc: number;
    compressed: number;
    size: number;
    offset: number;
    time: number;
    date: number;
}

/** MS-DOS time and date fields (in UTC, 2-second steps, years 1980-2107). */
export function dos_date_time(d: Date) {
    const year = Math.min(Math.max(d.getUTCFullYear(), 1980), 2107);
    const time =
        (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
    const date = ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
    return { time, date };
}

export type ZipSource =
    string | Buffer | AsyncIterable<string | Buffer> | Iterable<string | Buffer>;

export class ZipWriter {
    private offset = 0;
    private entries: CentralEntry[] = [];
    private busy = false;
    private finished = false;

    constructor(
        private out: Writable,
        private now: Date = new Date()
    ) {}

    /** Bytes written so far. */
    get bytes() {
        return this.offset;
    }

    private async write(buf: Buffer) {
        this.offset += buf.length;
        if (this.offset > MAX_32) throw new ZipTooLargeError();
        if (!this.out.write(buf)) {
            await new Promise<void>((resolve, reject) => {
                const done = (err?: Error) => {
                    this.out.off('drain', done);
                    this.out.off('error', done);
                    if (err) reject(err);
                    else resolve();
                };
                this.out.on('drain', done);
                this.out.on('error', done);
            });
        }
    }

    /** Adds one file. Entries are written one after another: await each before the next. */
    async add(name: string, source: ZipSource) {
        if (this.busy || this.finished) throw new Error('ZipWriter: one entry at a time');
        if (this.entries.length >= MAX_ENTRIES) throw new ZipTooLargeError();
        this.busy = true;
        try {
            await this.add_entry(name, source);
        } finally {
            this.busy = false;
        }
    }

    private async add_entry(name: string, source: ZipSource) {
        const name_buf = Buffer.from(name, 'utf8');
        const { time, date } = dos_date_time(this.now);
        const offset = this.offset;

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(VERSION, 4);
        local.writeUInt16LE(FLAGS, 6);
        local.writeUInt16LE(DEFLATE, 8);
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(date, 12);
        // CRC and sizes (14-25) stay 0: they're in the data descriptor
        local.writeUInt16LE(name_buf.length, 26);
        local.writeUInt16LE(0, 28);
        await this.write(Buffer.concat([local, name_buf]));

        let crc = 0;
        let size = 0;
        let compressed = 0;
        const chunks =
            typeof source === 'string' || Buffer.isBuffer(source) ? [source] : (source as any);
        async function* measured() {
            for await (const chunk of chunks) {
                const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
                if (buf.length === 0) continue;
                crc = zlib.crc32(buf, crc);
                size += buf.length;
                if (size > MAX_32) throw new ZipTooLargeError();
                yield buf;
            }
        }
        const writer = this;
        const sink = new Writable({
            write(chunk: Buffer, _enc, cb) {
                compressed += chunk.length;
                writer.write(chunk).then(() => cb(), cb);
            }
        });
        await pipeline(Readable.from(measured()), zlib.createDeflateRaw(), sink);

        const descriptor = Buffer.alloc(16);
        descriptor.writeUInt32LE(0x08074b50, 0);
        descriptor.writeUInt32LE(crc >>> 0, 4);
        descriptor.writeUInt32LE(compressed, 8);
        descriptor.writeUInt32LE(size, 12);
        await this.write(descriptor);

        this.entries.push({ name: name_buf, crc: crc >>> 0, compressed, size, offset, time, date });
    }

    /** Writes the central directory. Doesn't end the output stream. */
    async finish() {
        if (this.busy || this.finished) throw new Error('ZipWriter: already finished');
        this.finished = true;
        const start = this.offset;
        for (const e of this.entries) {
            const h = Buffer.alloc(46);
            h.writeUInt32LE(0x02014b50, 0);
            h.writeUInt16LE(VERSION, 4); // made by
            h.writeUInt16LE(VERSION, 6); // needed
            h.writeUInt16LE(FLAGS, 8);
            h.writeUInt16LE(DEFLATE, 10);
            h.writeUInt16LE(e.time, 12);
            h.writeUInt16LE(e.date, 14);
            h.writeUInt32LE(e.crc, 16);
            h.writeUInt32LE(e.compressed, 20);
            h.writeUInt32LE(e.size, 24);
            h.writeUInt16LE(e.name.length, 28);
            // extra, comment, disk, internal attrs (30-37) and external attrs (38-41) stay 0
            h.writeUInt32LE(e.offset, 42);
            await this.write(Buffer.concat([h, e.name]));
        }
        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(this.entries.length, 8);
        end.writeUInt16LE(this.entries.length, 10);
        end.writeUInt32LE(this.offset - start, 12);
        end.writeUInt32LE(start, 16);
        await this.write(end);
    }
}
