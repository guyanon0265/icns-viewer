import * as vscode from 'vscode';
import { Icns } from '@fiahfy/icns';
import { PNG } from 'pngjs';
// @ts-ignore — jpeg2000 ships without official TS types
import { JpxImage } from 'jpeg2000';

export interface DecodedIcon {
	osType: string;
	width: number;
	height: number;
	dataUri: string;
}

export async function decodeIcnsIcons(uri: vscode.Uri): Promise<DecodedIcon[]> {
	const raw = await vscode.workspace.fs.readFile(uri);
	const icns = Icns.from(Buffer.from(raw));

	const icons: DecodedIcon[] = [];

	for (const img of icns.images) {
		// 1. Native PNG chunk (89 50 4E 47)
		if (img.image.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
			const width = img.image.readUInt32BE(16);
			const height = img.image.readUInt32BE(20);
			icons.push({
				osType: img.osType,
				width,
				height,
				dataUri: `data:image/png;base64,${img.image.toString('base64')}`,
			});
			continue;
		}

		// 2. JPEG 2000 chunk ('jP  ' box at offset 4 or raw FF 4F codestream)
		const isJp2 =
			img.image.subarray(4, 8).toString('ascii') === 'jP  ' ||
			(img.image.at(0) === 0xff && img.image.at(1) === 0x4f);

		if (isJp2) {
			const jpx = new JpxImage();
			jpx.parse(Buffer.from(img.image));

			const tile = jpx.tiles[0];
			if (!tile) {continue};

			const { width, height } = tile;
			const src: Uint8Array = tile.items;
			const components: number = jpx.componentsCount;

			const png = new PNG({ width, height });
			for (let i = 0, p = 0; i < width * height; i++, p += 4) {
				if (components >= 4) {
					png.data[p] = src[i * 4];
					png.data[p + 1] = src[i * 4 + 1];
					png.data[p + 2] = src[i * 4 + 2];
					png.data[p + 3] = src[i * 4 + 3];
				} else if (components === 3) {
					png.data[p] = src[i * 3];
					png.data[p + 1] = src[i * 3 + 1];
					png.data[p + 2] = src[i * 3 + 2];
					png.data[p + 3] = 255;
				} else {
					const v = src[i * components];
					png.data[p] = v;
					png.data[p + 1] = v;
					png.data[p + 2] = v;
					png.data[p + 3] = components === 2 ? src[i * 2 + 1] : 255;
				}
			}

			const pngBuffer = PNG.sync.write(png);
			icons.push({
				osType: img.osType,
				width,
				height,
				dataUri: `data:image/png;base64,${pngBuffer.toString('base64')}`,
			});
		}
	}

	return icons.sort((a, b) => b.width - a.width);
}

export async function getLargestIcnsDataUri(uri: vscode.Uri): Promise<string> {
	const icons = await decodeIcnsIcons(uri);
	return icons.at(0)?.dataUri ?? '';
}
