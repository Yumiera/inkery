/** 有界并发：只用于文件写出等 IO 阶段，渲染阶段一律单线程顺序执行 */
export async function pool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const size = items.length;
  if (size === 0) return;

  const width = Math.max(1, Math.min(Math.floor(limit) || 1, size));
  let cursor = 0;

  const run = async (): Promise<void> => {
    while (cursor < size) {
      const index = cursor++;
      await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: width }, () => run()));
}