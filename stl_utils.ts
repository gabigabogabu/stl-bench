export type Vec3 = [number, number, number];

export type Triangle = {
  normal: Vec3;
  vertices: [Vec3, Vec3, Vec3];
};

export type Aabb = { min: Vec3; max: Vec3 };

function parseFloatsFromLine(line: string): number[] {
  return line
    .trim()
    .split(/\s+/)
    .slice(2)
    .map((v) => Number(v));
}

export function parseAsciiStl(text: string): Triangle[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const triangles: Triangle[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = (lines[i] ?? '').trim();
    if (line.startsWith('facet normal')) {
      const normalVals = parseFloatsFromLine(line);
      const normal: Vec3 = [
        normalVals[0] || 0,
        normalVals[1] || 0,
        normalVals[2] || 0,
      ];
      // Expect structure:
      // facet normal nx ny nz
      //   outer loop
      //     vertex x y z
      //     vertex x y z
      //     vertex x y z
      //   endloop
      // endfacet
      i++;
      // outer loop
      while (i < lines.length && !((lines[i] ?? '').trim().startsWith('outer loop'))) i++;
      i++;
      const verts: Vec3[] = [];
      for (let k = 0; k < 3 && i < lines.length; k++, i++) {
        const vline = (lines[i] ?? '').trim();
        if (!vline.startsWith('vertex')) break;
        const vals = vline
          .split(/\s+/)
          .slice(1)
          .map((v) => Number(v));
        const v: Vec3 = [vals[0] || 0, vals[1] || 0, vals[2] || 0];
        verts.push(v);
      }
      // skip until endfacet
      while (i < lines.length && !((lines[i] ?? '').trim().startsWith('endfacet'))) i++;
      if (verts.length === 3) {
        const v0 = verts[0]!;
        const v1 = verts[1]!;
        const v2 = verts[2]!;
        triangles.push({ normal, vertices: [v0, v1, v2] });
      }
    }
    i++;
  }
  return triangles;
}

export const vectorSubtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vectorAdd = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vectorScale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

export const aabbOfTriangles = (triangles: Triangle[]): Aabb => {
  let min: Vec3 = [Infinity, Infinity, Infinity];
  let max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const t of triangles) {
    for (const v of t.vertices) {
      for (let i = 0; i < 3; i++) {
        if (v[i]! < min[i]!) min[i] = v[i]!;
        if (v[i]! > max[i]!) max[i] = v[i]!;
      }
    }
  }
  return { min, max };
};

export const aabbVolume = (box: Aabb): number => {
  const dx = Math.max(0, box.max[0] - box.min[0]);
  const dy = Math.max(0, box.max[1] - box.min[1]);
  const dz = Math.max(0, box.max[2] - box.min[2]);
  return dx * dy * dz;
};

export function aabbIntersection(a: Aabb, b: Aabb): Aabb | null {
  const min: Vec3 = [
    Math.max(a.min[0], b.min[0]),
    Math.max(a.min[1], b.min[1]),
    Math.max(a.min[2], b.min[2]),
  ];
  const max: Vec3 = [
    Math.min(a.max[0], b.max[0]),
    Math.min(a.max[1], b.max[1]),
    Math.min(a.max[2], b.max[2]),
  ];
  if (max[0] < min[0] || max[1] < min[1] || max[2] < min[2]) return null;
  return { min, max };
}

export const aabbIou = (a: Aabb, b: Aabb): number => {
  const inter = aabbIntersection(a, b);
  if (!inter) return 0;
  const vI = aabbVolume(inter);
  const vU = aabbVolume(a) + aabbVolume(b) - vI;
  return vU > 0 ? vI / vU : 0;
};

const cross = (a: Vec3, b: Vec3): Vec3 => {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
};

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const triangleArea = (t: Triangle): number => {
  const [a, b, c] = t.vertices;
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cr = cross(ab, ac);
  const mag = Math.sqrt(dot(cr, cr));
  return 0.5 * mag;
};

export const surfaceArea = (triangles: Triangle[]): number => triangles.reduce((sum, t) => sum + triangleArea(t), 0);

export const signedVolume = (triangles: Triangle[]): number => {
  const vol6 = triangles.reduce((sum, t) => {
    const [p0, p1, p2] = t.vertices;
    const cr = cross(p1, p2);
    return sum + dot(p0, cr);
  }, 0);
  return vol6 / 6;
}

export function surfaceCentroid(triangles: Triangle[]): Vec3 {
  const { cx, cy, cz, total } = triangles.reduce((acc, t) => {
    const area = triangleArea(t);
    const [a, b, c] = t.vertices;
    const tx = (a[0] + b[0] + c[0]) / 3;
    const ty = (a[1] + b[1] + c[1]) / 3;
    const tz = (a[2] + b[2] + c[2]) / 3;
    return { cx: acc.cx + tx * area, cy: acc.cy + ty * area, cz: acc.cz + tz * area, total: acc.total + area };
  }, { cx: 0, cy: 0, cz: 0, total: 0 });
  if (total === 0) return [0, 0, 0];
  return [cx / total, cy / total, cz / total];
}

export function sampleSurfacePoints(triangles: Triangle[], sampleCount: number, rng: () => number = Math.random): Vec3[] {
  const n = triangles.length;
  if (n === 0 || sampleCount <= 0) return [];
  const areas = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const tri = triangles[i]!;
    const a = triangleArea(tri);
    areas[i] = a;
    total += a;
  }
  if (total === 0) {
    // Fallback: uniform over triangles
    for (let i = 0; i < n; i++) areas[i] = 1;
    total = n;
  }
  // Prefix sums
  let cumulative = areas[0] ?? 0;
  for (let i = 1; i < n; i++) {
    const current = areas[i] ?? 0;
    cumulative += current;
    areas[i] = cumulative;
  }

  function pickTriangleIndex(): number {
    const totalArea = areas[n - 1] ?? 0;
    const r = rng() * totalArea;
    // binary search
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const cutoff = areas[mid] ?? 0;
      if (r <= cutoff) hi = mid; else lo = mid + 1;
    }
    return lo;
  }

  function samplePointInTriangle(a: Vec3, b: Vec3, c: Vec3): Vec3 {
    const r1 = Math.sqrt(rng());
    const r2 = rng();
    const u = 1 - r1;
    const v = r1 * (1 - r2);
    const w = r1 * r2;
    return [
      u * a[0] + v * b[0] + w * c[0],
      u * a[1] + v * b[1] + w * c[1],
      u * a[2] + v * b[2] + w * c[2],
    ];
  }

  const pts: Vec3[] = new Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const idx = pickTriangleIndex();
    const tri = triangles[idx]!; // idx ∈ [0, n-1] by construction
    const [a, b, c] = tri.vertices;
    pts[i] = samplePointInTriangle(a, b, c);
  }
  return pts;
}

const squaredDistance = (a: Vec3, b: Vec3): number => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

export type ChamferStats = {
  meanAB: number;
  meanBA: number;
  p95AB: number;
  p95BA: number;
  maxAB: number;
  maxBA: number;
};

export function chamferDistance(pointsA: Vec3[], pointsB: Vec3[]): ChamferStats {
  function oneWay(a: Vec3[], b: Vec3[]): { mean: number; p95: number; max: number } {
    const mins: number[] = new Array(a.length);
    for (let i = 0; i < a.length; i++) {
      let best = Infinity;
      const p = a[i]!;
      for (let j = 0; j < b.length; j++) {
        const d2 = squaredDistance(p, b[j]!);
        if (d2 < best) best = d2;
      }
      mins[i] = Math.sqrt(best);
    }
    mins.sort((x, y) => x - y);
    const mean = mins.reduce((s, x) => s + x, 0) / (mins.length || 1);
    const p95Index = Math.min(mins.length - 1, Math.floor(mins.length * 0.95));
    const p95 = mins[p95Index] ?? 0;
    const max = mins[mins.length - 1] ?? 0;
    return { mean, p95, max };
  }

  const ab = oneWay(pointsA, pointsB);
  const ba = oneWay(pointsB, pointsA);
  return { meanAB: ab.mean, meanBA: ba.mean, p95AB: ab.p95, p95BA: ba.p95, maxAB: ab.max, maxBA: ba.max };
}

export const translatePoints = (points: Vec3[], delta: Vec3): Vec3[] => points.map((p) => [p[0] + delta[0], p[1] + delta[1], p[2] + delta[2]] as Vec3);

export const scalePoints = (points: Vec3[], s: number): Vec3[] => points.map((p) => [p[0] * s, p[1] * s, p[2] * s] as Vec3);

export const aabbDiagonal = (box: Aabb): number => {
  const dx = box.max[0] - box.min[0];
  const dy = box.max[1] - box.min[1];
  const dz = box.max[2] - box.min[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}


