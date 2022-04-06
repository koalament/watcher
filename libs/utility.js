 class Utility {
  static wait(ms) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(undefined);
      }, ms);
    });
  }
}

module.exports = Utility;