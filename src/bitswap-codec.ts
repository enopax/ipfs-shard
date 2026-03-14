import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'

/**
 * Append a varint to a buffer.
 */
export function appendVarint(buf: number[], n: number): void {
	while (n > 0x7f) {
		buf.push((n & 0x7f) | 0x80)
		n >>>= 7
	}
	buf.push(n)
}

/**
 * Read a varint from a buffer at offset.
 * Returns [value, bytes_read].
 */
export function readVarint(buf: Uint8Array, offset: number): [number, number] {
	let result = 0
	let shift = 0
	let pos = offset
	while (true) {
		const b = buf[pos++]
		result |= (b & 0x7f) << shift
		shift += 7
		if ((b & 0x80) === 0) break
	}
	return [result, pos - offset]
}

/**
 * Write a varint field (tag + value).
 */
export function writeVarintField(fieldNum: number, value: number): Uint8Array {
	const buf: number[] = []
	appendVarint(buf, (fieldNum << 3) | 0) // wire type 0
	appendVarint(buf, value)
	return new Uint8Array(buf)
}

/**
 * Write a length-delimited field (tag + length + bytes).
 */
export function writeLenField(fieldNum: number, bytes: Uint8Array): Uint8Array {
	const buf: number[] = []
	appendVarint(buf, (fieldNum << 3) | 2) // wire type 2
	appendVarint(buf, bytes.length)
	for (const b of bytes) buf.push(b)
	return new Uint8Array(buf)
}

/**
 * Concatenate multiple Uint8Arrays.
 */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
	const len = parts.reduce((s, p) => s + p.length, 0)
	const out = new Uint8Array(len)
	let off = 0
	for (const p of parts) {
		out.set(p, off)
		off += p.length
	}
	return out as Uint8Array
}

/**
 * Encode a WantBlock request for a CID.
 */
export function encodeWantBlock(cid: CID): Uint8Array {
	// WantlistEntry: block=field1, priority=field2(1), wantType=field4(0=Block), sendDontHave=field5(1)
	const entry = concatBytes(
		writeLenField(1, cid.bytes),
		writeVarintField(2, 1),
		writeVarintField(4, 0),
		writeVarintField(5, 1),
	)
	// Wantlist: entries=field1, full=field2(false)
	const wantlist = concatBytes(writeLenField(1, entry), writeVarintField(2, 0))
	// BitswapMessage: wantlist=field1
	return writeLenField(1, wantlist)
}

/**
 * Encode a Block response.
 */
export function encodeBlock(cid: CID, data: Uint8Array): Uint8Array {
	// CID prefix: [version, codec, hashAlg, digestLen] as varints
	const prefixBuf: number[] = []
	appendVarint(prefixBuf, cid.version)
	appendVarint(prefixBuf, cid.code)
	appendVarint(prefixBuf, cid.multihash.code)
	appendVarint(prefixBuf, cid.multihash.digest.length)
	const prefix = new Uint8Array(prefixBuf)
	// Block: prefix=field1, data=field2
	const block = concatBytes(writeLenField(1, prefix), writeLenField(2, data))
	// BitswapMessage: payload=field3
	return writeLenField(3, block)
}

export interface DecodedMessage {
	wantBlocks: CID[]
	blocks: Array<{ prefix: Uint8Array; data: Uint8Array }>
}

/**
 * Decode a BitswapMessage protobuf.
 */
export function decodeMessage(bytes: Uint8Array): DecodedMessage {
	const wantBlocks: CID[] = []
	const blocks: Array<{ prefix: Uint8Array; data: Uint8Array }> = []

	let offset = 0
	while (offset < bytes.length) {
		const [tag, tagLen] = readVarint(bytes, offset)
		offset += tagLen

		const fieldNum = tag >> 3
		const wireType = tag & 7

		if (wireType === 2) {
			// Length-delimited
			const [len, lenLen] = readVarint(bytes, offset)
			offset += lenLen
			const fieldBytes = bytes.slice(offset, offset + len)
			offset += len

			if (fieldNum === 1) {
				// Wantlist
				decodeWantlist(fieldBytes, wantBlocks)
			} else if (fieldNum === 3) {
				// Payload (Block)
				const block = decodePayloadBlock(fieldBytes)
				if (block) blocks.push(block)
			}
		} else {
			// Skip other wire types
			break
		}
	}

	return { wantBlocks, blocks }
}

/**
 * Decode a Wantlist field.
 */
function decodeWantlist(bytes: Uint8Array, out: CID[]): void {
	let offset = 0
	while (offset < bytes.length) {
		const [tag, tagLen] = readVarint(bytes, offset)
		offset += tagLen

		const fieldNum = tag >> 3
		const wireType = tag & 7

		if (wireType === 2 && fieldNum === 1) {
			// WantlistEntry (field 1, len-del)
			const [len, lenLen] = readVarint(bytes, offset)
			offset += lenLen
			const entryBytes = bytes.slice(offset, offset + len)
			offset += len
			const entry = decodeWantEntry(entryBytes)
			if (entry.cidBytes && !entry.cancel && entry.wantType === 0) {
				try {
					const cid = CID.decode(entry.cidBytes)
					out.push(cid)
				} catch {
					// Skip invalid CIDs
				}
			}
		} else if (wireType === 0) {
			// Varint field, skip
			const [, varLen] = readVarint(bytes, offset)
			offset += varLen
		}
	}
}

/**
 * Decode a WantlistEntry.
 */
function decodeWantEntry(bytes: Uint8Array): { cidBytes?: Uint8Array; wantType: number; cancel: boolean } {
	let cidBytes: Uint8Array | undefined
	let wantType = 0
	let cancel = false

	let offset = 0
	while (offset < bytes.length) {
		const [tag, tagLen] = readVarint(bytes, offset)
		offset += tagLen

		const fieldNum = tag >> 3
		const wireType = tag & 7

		if (wireType === 2) {
			// Length-delimited
			const [len, lenLen] = readVarint(bytes, offset)
			offset += lenLen
			const fieldBytes = bytes.slice(offset, offset + len)
			offset += len

			if (fieldNum === 1) {
				// block field
				cidBytes = fieldBytes
			}
		} else if (wireType === 0) {
			// Varint
			const [val, varLen] = readVarint(bytes, offset)
			offset += varLen
			if (fieldNum === 3) {
				// cancel
				cancel = val !== 0
			} else if (fieldNum === 4) {
				// wantType
				wantType = val
			}
		}
	}

	return { cidBytes, wantType, cancel }
}

/**
 * Decode a Block from payload.
 */
export function decodePayloadBlock(bytes: Uint8Array): { prefix: Uint8Array; data: Uint8Array } | null {
	let prefix: Uint8Array | undefined
	let data: Uint8Array | undefined

	let offset = 0
	while (offset < bytes.length) {
		const [tag, tagLen] = readVarint(bytes, offset)
		offset += tagLen

		const fieldNum = tag >> 3
		const wireType = tag & 7

		if (wireType === 2) {
			// Length-delimited
			const [len, lenLen] = readVarint(bytes, offset)
			offset += lenLen
			const fieldBytes = bytes.slice(offset, offset + len)
			offset += len

			if (fieldNum === 1) {
				prefix = fieldBytes
			} else if (fieldNum === 2) {
				data = fieldBytes
			}
		}
	}

	return prefix && data ? { prefix, data } : null
}

/**
 * Reconstruct a CID from prefix and data.
 */
export async function prefixToCID(prefix: Uint8Array, data: Uint8Array): Promise<CID | null> {
	const [version, vLen0] = readVarint(prefix, 0)
	const [codec, vLen1] = readVarint(prefix, vLen0)
	const [hashAlg] = readVarint(prefix, vLen0 + vLen1)

	// Only support sha2-256
	if (hashAlg !== sha256.code) return null

	try {
		const digest = await sha256.digest(data)
		return version === 0 ? CID.createV0(digest) : CID.createV1(codec, digest)
	} catch {
		return null
	}
}

/**
 * Encode message with varint length prefix (for sending on stream).
 */
export function encodeWithLengthPrefix(msg: Uint8Array): Uint8Array {
	const len = msg.length
	const lenBytes: number[] = []
	appendVarint(lenBytes, len)
	return concatBytes(new Uint8Array(lenBytes), msg)
}
