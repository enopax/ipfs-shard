/**
 * Minimal protobuf varint reader
 */
export function readVarint(buf: Uint8Array, offset: number): { value: number; n: number } {
	let value = 0,
		shift = 0,
		n = 0
	while (n < 10) {
		const byte = buf[offset + n++]
		value |= (byte & 0x7f) << shift
		shift += 7
		if ((byte & 0x80) === 0) break
	}
	return { value, n }
}

export interface PBLink {
	hash: Uint8Array | null
	name: string
	size: number
}

export interface PBNode {
	links: PBLink[]
	data: Uint8Array | null
}

export function decodeDagPB(block: Uint8Array): PBNode {
	const links: PBLink[] = []
	let data: Uint8Array | null = null
	let offset = 0

	while (offset < block.length) {
		const { value: tag, n: tn } = readVarint(block, offset)
		offset += tn
		const fieldNum = tag >> 3
		const wireType = tag & 0x07

		if (wireType === 2) {
			// length-delimited
			const { value: len, n: ln } = readVarint(block, offset)
			offset += ln
			const slice = block.slice(offset, offset + len)
			offset += len

			if (fieldNum === 1) {
				// PBNode.Data
				data = slice
			} else if (fieldNum === 2) {
				// PBNode.Links (repeated PBLink)
				let h: Uint8Array | null = null,
					n = '',
					sz = 0
				let lo = 0

				while (lo < slice.length) {
					const { value: lt, n: ltn } = readVarint(slice, lo)
					lo += ltn
					const lf = lt >> 3,
						lw = lt & 7

					if (lw === 2) {
						// length-delimited
						const { value: ll, n: lln } = readVarint(slice, lo)
						lo += lln
						const ls = slice.slice(lo, lo + ll)
						lo += ll

						if (lf === 1) h = ls
						// PBLink.Hash
						else if (lf === 2) n = new TextDecoder().decode(ls)
						// PBLink.Name
					} else if (lw === 0) {
						// varint
						const { value: lv, n: lvn } = readVarint(slice, lo)
						lo += lvn

						if (lf === 3) sz = lv
						// PBLink.Tsize
					} else break
				}

				links.push({ hash: h, name: n, size: sz })
			}
		} else if (wireType === 0) {
			// varint
			const { n } = readVarint(block, offset)
			offset += n
		} else break
	}

	return { links, data }
}

/**
 * Returns UnixFS type: 0=Raw, 1=Directory, 2=File, -1=unknown
 */
export function unixFSType(data: Uint8Array | null): number {
	if (!data || data.length < 2 || data[0] !== 0x08) return -1
	return data[1]
}

export interface DAGStatResult {
	Size: number
	NumBlocks: number
}

export interface BlockStatResult {
	Key: string
	Size: number
}
