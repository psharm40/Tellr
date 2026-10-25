// a stand-in for chrome's extension apis, so the real side panel page can be drawn in a test.
// it hands the page one session: two saved items. nothing here runs in the extension.
window.chrome = {
  runtime: {
    sendMessage(message, callback) {
      const session = {
        voice: { status: "idle" },
        lastAnswer: "Saved the brown slip-on loafer.",
        shortlist: [
          { key: "1", url: "https://www.ebay.com/itm/1", title: "Loafers", description: "A brown slip-on loafer in soft leather", priceCents: 2600, fit: "good_pick", flaw: "", unknown: "the size isn't shown." },
          { key: "2", url: "https://www.ebay.com/itm/2", title: "Boots", description: "Black ankle boots with a low heel", priceCents: 4100, fit: "risky", flaw: "The toes look scuffed.", unknown: "" },
        ],
        results: [],
      };
      if (callback) callback({ session });
      return Promise.resolve({ session });
    },
    onMessage: { addListener() {} },
    getURL: (path) => path,
  },
  storage: { local: { get: async () => ({}) }, session: { get: async () => ({}) }, onChanged: { addListener() {} } },
  commands: { getAll: async () => [] },
  tabs: { create() {} },
};
