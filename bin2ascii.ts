type Vec3 = [number, number, number];

type Triangle = {
  normal: Vec3;
  vertices: [Vec3, Vec3, Vec3];
};

function isLikelyBinaryStl(fileSize: number, headerAndCount: DataView): boolean {
  if (fileSize < 84) return false;
  const triangleCount = headerAndCount.getUint32(80, true);
  const expected = 84 + triangleCount * 50;
  return expected === fileSize;
}

function readFloat3(view: DataView, offset: number): Vec3 {
  const x = view.getFloat32(offset + 0, true);
  const y = view.getFloat32(offset + 4, true);
  const z = view.getFloat32(offset + 8, true);
  return [x, y, z];
}

export function parseBinaryStl(buffer: ArrayBuffer): Triangle[] {
  const view = new DataView(buffer);
  const fileSize = buffer.byteLength;
  if (fileSize < 84) {
    throw new Error('File too small to be a valid binary STL.');
  }
  if (!isLikelyBinaryStl(fileSize, view)) {
    throw new Error('Input does not look like a binary STL (size/count mismatch).');
  }

  const triangleCount = view.getUint32(80, true);
  const triangles: Triangle[] = new Array(triangleCount);

  let offset = 84;
  for (let i = 0; i < triangleCount; i++) {
    const normal = readFloat3(view, offset);
    const v1 = readFloat3(view, offset + 12);
    const v2 = readFloat3(view, offset + 24);
    const v3 = readFloat3(view, offset + 36);
    // skip attribute byte count (2 bytes)
    offset += 50;
    triangles[i] = { normal, vertices: [v1, v2, v3] };
  }

  return triangles;
}

function trimTrailingZeros(numStr: string): string {
  if (numStr.indexOf('.') === -1) return numStr;
  return numStr.replace(/\.0+$/u, '').replace(/(\.\d*?)0+$/u, '$1');
}

function formatFloat(value: number, precision: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Object.is(value, -0)) value = 0;
  const fixed = value.toFixed(precision);
  return trimTrailingZeros(fixed);
}

export function trianglesToAscii(triangles: Triangle[], solidName: string, precision: number): string {
  const lines: string[] = [];
  lines.push(`solid ${solidName}`);
  for (const tri of triangles) {
    const [nx, ny, nz] = tri.normal;
    lines.push(
      `  facet normal ${formatFloat(nx, precision)} ${formatFloat(ny, precision)} ${formatFloat(nz, precision)}`
    );
    lines.push('    outer loop');
    for (const vertex of tri.vertices) {
      const [x, y, z] = vertex;
      lines.push(
        `      vertex ${formatFloat(x, precision)} ${formatFloat(y, precision)} ${formatFloat(z, precision)}`
      );
    }
    lines.push('    endloop');
    lines.push('  endfacet');
  }
  lines.push(`endsolid ${solidName}`);
  return lines.join('\n');
}

export function isBinaryStl(buffer: ArrayBuffer): boolean {
  return isLikelyBinaryStl(buffer.byteLength, new DataView(buffer));
}

export function binaryStlToAscii(buffer: ArrayBuffer, solidName: string, precision: number): string {
  const triangles = parseBinaryStl(buffer);
  return trianglesToAscii(triangles, solidName, precision);
}
