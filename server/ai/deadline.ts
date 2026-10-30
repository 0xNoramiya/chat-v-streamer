export function deadline<T>(
  work: Promise<T>,
  ms: number,
  fallback: () => Promise<T>,
  clock?: {
    setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
    clearTimeout?: (id: ReturnType<typeof setTimeout>) => void;
  },
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work,
    new Promise<T>((resolve) => {
      timer = (clock?.setTimeout ?? setTimeout)(() => {
        void fallback().then(resolve);
      }, ms);
    }),
  ])
    .catch(fallback)
    .finally(() => (clock?.clearTimeout ?? clearTimeout)(timer));
}
