# Benchmarks

Reproducible performance and memory measurements for `image-slim-cli`.

The benchmarks never run in CI. They exist so performance and memory claims
can be reproduced on demand and so concurrency defaults can be validated
against real workloads.

## Usage

```bash
# All workloads, concurrency 1, 2, 4, and 8
npm run bench

# One workload at specific concurrency levels
npm run bench -- --workload normal --concurrency 1,2,4

# Rebuild fixtures from scratch
npm run bench -- --regenerate
```

## Workloads

| Workload | Fixtures                 | Approximate input |
| -------- | ------------------------ | ----------------- |
| `small`  | 100 JPEG at 256 x 256    | ~1 MB             |
| `normal` | 100 JPEG at 1024 x 768   | ~50-150 MB        |
| `large`  | 10 JPEG at 3000 x 2000   | ~50-100 MB        |
| `mixed`  | 30 JPEG, 30 PNG, 40 WebP | mixed formats     |

Fixtures are generated into `benchmarks/fixtures/<workload>` on first use and
reused afterwards. The directory is git-ignored because the images are large
and fully reproducible.

## Metrics

Each run reports:

- Total execution time and images per second
- Peak resident set size (RSS), sampled every 25 ms
- Input and output bytes, plus savings percentage
- Optimized, skipped, and failed image counts

## Why memory matters

Compressed file size is not a good proxy for memory use. A decoded
6000 x 4000 RGBA image requires roughly 96 MB before any processing buffers.
Because each job holds a decoded image, concurrency drives peak memory far more
than input size does. That is why the CLI caps configured concurrency at 64 and
defaults to 2.

## Reading the results

Peak RSS includes the benchmark process itself, and generated fixtures are
still in the page cache. Treat the numbers as relative comparisons between
concurrency settings on the same machine, not as absolute resource guarantees.
Run the suite on the machine and filesystem you care about before drawing
conclusions.
