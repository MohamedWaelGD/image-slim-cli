import { ImageSlimError } from "../errors/image-slim-error";

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new ImageSlimError(
      "INVALID_OPTIONS",
      "concurrency must be an integer greater than zero.",
    );
  }

  const results = new Array<R>(values.length);
  let next = 0;
  let failure: unknown;

  const worker = async (): Promise<void> => {
    while (failure === undefined && !signal?.aborted) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      try {
        results[index] = await mapper(values[index] as T, index);
      } catch (error) {
        failure = error;
        return;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () =>
      worker(),
    ),
  );

  if (signal?.aborted) {
    throw new ImageSlimError("ABORTED", "Image optimization was interrupted.", {
      cause: signal.reason,
    });
  }
  if (failure !== undefined) throw failure;
  return results;
}
