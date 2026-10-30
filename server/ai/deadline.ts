export function deadline<T>(work: Promise<T>, ms: number, fallback: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work,
    new Promise<T>((resolve) => {
      timer = setTimeout(() => {
        void fallback().then(resolve);
      }, ms);
    }),
  ])
    .catch(fallback)
    .finally(() => clearTimeout(timer));
}
