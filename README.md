# stl-bench

Benchmark for testing LLMs in STL file generation.

This is WIP and pretty terrible atm:
- The model often makes way to big or small models, because it just doesn't know the scale from the scraped data.
- Comparison metrics are hand-wavy. Functionality and/or aesthetics of original piece may or may not be present:
  - Volume Ratio: check if generated model is roughly the correct size. `1` is best
  - Surface area ratio: same but different. `1` is best
  - AABB IoU (Intersection-over-Union of axis-aligned bounding boxes): check if generated model is roughly the aspect ration (sensitive to translation & rotation, which sucks). higher is better
  - Chamfer distance (average nearest-surface distance) lower is better

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run bench.ts
```

This project was created using `bun init` in bun v1.2.21. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Bench using OpenRouter

```bash
export OPENROUTER_API_KEY=sk-or-...

# Process downloaded models (from downloads/), generate AI STL, compare metrics
bun run bench.ts --downloads downloads --pattern "" --model openai/gpt-4o-mini --limit 3 --samples 2000
```

Environment variables:

- `OPENROUTER_API_KEY`: required

Notes:

- Bench logs metrics (AABB IoU, surface/volume ratios, Chamfer) and writes `bench_results.json`.
