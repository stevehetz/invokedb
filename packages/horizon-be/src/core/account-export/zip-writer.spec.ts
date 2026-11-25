import { Writable } from 'stream';
import * as zlib from 'zlib';
import { ZipWriter, dos_date_time } from './zip-writer';

// Collects what's written, slowly (a tiny buffer), so the writer has to wait for 'drain'
function sink() {
    const chunks: Buffer[] = [];
    const out = new Writable({
        highWaterMark: 16,
        write(chunk, _enc, cb) {
            chunks.push(chunk);
            setImmediate(cb);
        }
    });
    return { out, data: () => Buffer.concat(chunks) };
}

// Reads a zip the way an unzip tool does: end record, central directory, then each local entry
function read_zip(buf: Buffer) {
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(eocd).toBeGreaterThan(-1);
    const count = buf.readUInt16LE(eocd + 10);
    const cd_size = buf.readUInt32LE(eocd + 12);
    const cd_offset = buf.readUInt32LE(eocd + 16);
    expect(cd_offset + cd_size).toBe(eocd);
    const entries: Record<string, string> = {};
    let p = cd_offset;
    for (let i = 0; i < count; i++) {
        expect(buf.readUInt32LE(p)).toBe(0x02014b50);
        const flags = buf.readUInt16LE(p + 8);
        const method = buf.readUInt16LE(p + 10);
        const crc = buf.readUInt32LE(p + 16);
        const csize = buf.readUInt32LE(p + 20);
        const size = buf.readUInt32LE(p + 24);
        const name_len = buf.readUInt16LE(p + 28);
        const extra_len = buf.readUInt16LE(p + 30);
        const comment_len = buf.readUInt16LE(p + 32);
        const offset = buf.readUInt32LE(p + 42);
        const name = buf.subarray(p + 46, p + 46 + name_len).toString('utf8');
        expect(flags & 0x0800).toBe(0x0800); // UTF-8 names
        expect(method).toBe(8);

        expect(buf.readUInt32LE(offset)).toBe(0x04034b50);
        const local_name_len = buf.readUInt16LE(offset + 26);
        const local_extra = buf.readUInt16LE(offset + 28);
        expect(buf.subarray(offset + 30, offset + 30 + local_name_len).toString('utf8')).toBe(name);
        const start = offset + 30 + local_name_len + local_extra;
        const data = zlib.inflateRawSync(buf.subarray(start, start + csize));
        expect(data.length).toBe(size);
        expect(zlib.crc32(data)).toBe(crc);
        // The data descriptor repeats the CRC and sizes
        const d = start + csize;
        expect(buf.readUInt32LE(d)).toBe(0x08074b50);
        expect(buf.readUInt32LE(d + 4)).toBe(crc);
        expect(buf.readUInt32LE(d + 8)).toBe(csize);
        expect(buf.readUInt32LE(d + 12)).toBe(size);

        entries[name] = data.toString('utf8');
        p += 46 + name_len + extra_len + comment_len;
    }
    return entries;
}

describe('ZipWriter', () => {
    it('writes entries from strings, buffers and async sources that unzip back', async () => {
        const { out, data } = sink();
        const zip = new ZipWriter(out, new Date(Date.UTC(2026, 10, 25, 13, 45, 30)));
        async function* lines() {
            for (let i = 0; i < 2000; i++) yield `line ${i}\n`;
        }
        await zip.add('a.txt', 'hello');
        await zip.add('dir/ünïcode.csv', Buffer.from('x,y\r\n1,2\r\n'));
        await zip.add('big.txt', lines());
        await zip.add('empty.json', '');
        await zip.finish();
        const buf = data();
        expect(zip.bytes).toBe(buf.length);

        const entries = read_zip(buf);
        expect(Object.keys(entries)).toEqual(['a.txt', 'dir/ünïcode.csv', 'big.txt', 'empty.json']);
        expect(entries['a.txt']).toBe('hello');
        expect(entries['dir/ünïcode.csv']).toBe('x,y\r\n1,2\r\n');
        expect(entries['big.txt'].split('\n')).toHaveLength(2001);
        expect(entries['big.txt'].startsWith('line 0\nline 1\n')).toBe(true);
        expect(entries['empty.json']).toBe('');
    });

    it('writes an empty archive', async () => {
        const { out, data } = sink();
        const zip = new ZipWriter(out);
        await zip.finish();
        expect(data().length).toBe(22);
        expect(read_zip(data())).toEqual({});
    });

    it('refuses an entry while another is being written, or after finish', async () => {
        const { out } = sink();
        const zip = new ZipWriter(out);
        const first = zip.add('a', 'x'.repeat(10000));
        await expect(zip.add('b', 'y')).rejects.toThrow('one entry at a time');
        await first;
        await zip.finish();
        await expect(zip.add('c', 'z')).rejects.toThrow();
    });

    it('passes on an error from the source', async () => {
        const { out } = sink();
        const zip = new ZipWriter(out);
        async function* failing() {
            yield 'a';
            throw new Error('mongo went away');
        }
        await expect(zip.add('a', failing())).rejects.toThrow('mongo went away');
    });

    it('encodes MS-DOS dates', () => {
        const { time, date } = dos_date_time(new Date(Date.UTC(2026, 10, 25, 13, 45, 31)));
        expect(time).toBe((13 << 11) | (45 << 5) | 15);
        expect(date).toBe(((2026 - 1980) << 9) | (11 << 5) | 25);
        expect(dos_date_time(new Date(Date.UTC(1970, 0, 1))).date).toBe((0 << 9) | (1 << 5) | 1);
    });
});
