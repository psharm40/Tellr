/* eslint-disable */
// test-only fake of @anthropic-ai/sdk. it performs NO network calls. the behavior
// of messages.create is controlled per-test via globalThis.__TELLR_FAKE__(params),
// which returns a canned Message-shaped object or throws to simulate an api error.
export default class Anthropic {
  constructor(_options) {
    this.messages = {
      create: async (params) => {
        const fake = globalThis.__TELLR_FAKE__;
        if (typeof fake !== "function") {
          throw new Error("test fake not configured: set globalThis.__TELLR_FAKE__");
        }
        return fake(params);
      },
    };
  }
}
