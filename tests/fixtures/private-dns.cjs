module.exports = {
  ...require("node:dns"),
  lookup(...args) {
    return globalThis.__securityLookup(...args);
  },
};
