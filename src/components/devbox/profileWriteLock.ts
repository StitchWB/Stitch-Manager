let chain: Promise<unknown> = Promise.resolve();

// Profile JSON is updated read-modify-write from several places (Connect access
// mode, Services gateway/ports, Projects editor). Serializing the whole
// GET→mutate→PUT sequence prevents a slower writer from clobbering fields that
// a faster one just saved.
export function serializeProfileWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}
