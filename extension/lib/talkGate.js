// a stop for one hold must not cancel the next hold.
export function createTalkGate() {
  let activeGen = 0;
  let session = null;
  let pendingGen = null;

  return {
    start(gen, open) {
      if (session) {
        session.cancel();
        session = null;
      }
      activeGen = gen;
      const stopNow = pendingGen === gen;
      if (pendingGen === gen) pendingGen = null;
      session = open();
      if (stopNow) session.stop();
      return session;
    },
    stop(gen) {
      if (session && activeGen === gen) {
        session.stop();
        return "stopped";
      }
      pendingGen = gen;
      return "pending";
    },
    clear() {
      session?.cancel();
      session = null;
      pendingGen = null;
    },
  };
}
