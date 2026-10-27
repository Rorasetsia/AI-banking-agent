// Only initial, read-only requests participate in reconnection. Business writes
// and confirmation proofs are never replayed by this connector.
export function createExperienceConnector<S, T, A>(read: {
  session: () => Promise<S>;
  state: () => Promise<T>;
  settings: () => Promise<A>;
  unauthorized: (error: unknown) => boolean;
}) {
  let pending: Promise<{ session: S; state: T; settings: A | null }> | null = null;
  async function connect() {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const session = await read.session();
        const [state, settings] = await Promise.all([
          read.state(),
          read.settings().catch(error => {
            if (read.unauthorized(error)) throw error;
            return null;
          }),
        ]);
        return { session, state, settings };
      } catch (error) {
        if (attempt === 1 || !read.unauthorized(error)) throw error;
      }
    }
    throw new Error('无法建立模拟环境连接');
  }
  return () => {
    if (!pending) pending = connect().finally(() => { pending = null; });
    return pending;
  };
}
