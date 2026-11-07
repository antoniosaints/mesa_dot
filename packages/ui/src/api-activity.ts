type ReadObserver = () => () => void;
const observers = new Set<ReadObserver>();

/** Observe reads without intercepting fetch, payloads, authentication or errors. */
export function observeApiReads(observer: ReadObserver) {
  observers.add(observer);
  return () => {
    observers.delete(observer);
  };
}

export function beginApiRead() {
  const finish = [...observers].map((observer) => observer());
  return () => finish.forEach((done) => done());
}
