const Utility = require('./utility');

 class FastTTL {
  constructor(options) {
    this._keys = new Map();
    const _options = { defaultTTL: 3600, refreshInterval: 2, ...options };
    this._options = _options;
    this.clean();
  }

  set(key, value, ttl) {
    this._keys.set(key, {
      value,
      expiredAfter: new Date().getTime() + (ttl || this._options.defaultTTL * 1000)
    });
  }

  delete(key) {
    this._keys.delete(key);
  }

  get(key) {
    const item = this._keys.get(key);
    if (item === undefined) {
      return undefined;
    }

    return item.value;
  }

  has(key) {
    return this._keys.has(key);
  }

   async clean() {
    const now = new Date().getTime();
    const expiredKeys = [];
    this._keys.forEach((data, key) => {
      if (data.expiredAfter >= now) {
        expiredKeys.push(key);
      }
    });
    expiredKeys.forEach((key) => {
      this._keys.delete(key);
    });

    await Utility.wait(this._options.refreshInterval * 1000);
    this.clean();
  }
}

module.exports = FastTTL;
