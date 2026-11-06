import { describe, expect, it } from 'vitest'
import { crc32, zip } from './zip'

const enc = new TextEncoder()

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array())).toBe(0)
  })

  it('writes a well-formed archive with UTF-8 names', () => {
    const files = [
      { path: 'Engineering/Offline mode — design review.md', data: enc.encode('# Offline\n') },
      { path: 'Q4 roadmap.md', data: enc.encode('# Q4\n') },
    ]
    const out = zip(files)
    const view = new DataView(out.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    // End of central directory: last 22 bytes.
    const end = out.length - 22
    expect(view.getUint32(end, true)).toBe(0x06054b50)
    expect(view.getUint16(end + 10, true)).toBe(2)
    const cdOffset = view.getUint32(end + 16, true)
    expect(view.getUint32(cdOffset, true)).toBe(0x02014b50)
    const nameLen = view.getUint16(cdOffset + 28, true)
    expect(new TextDecoder().decode(out.slice(cdOffset + 46, cdOffset + 46 + nameLen))).toBe(files[0]!.path)
  })
})
