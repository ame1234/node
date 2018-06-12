'use strict';

const copyProps = (unsafe, safe) => {
  for (const key of [...Object.getOwnPropertyNames(unsafe),
                     ...Object.getOwnPropertySymbols(unsafe)
  ]) {
    if (!Object.getOwnPropertyDescriptor(safe, key)) {
      Object.defineProperty(
        safe,
        key,
        Object.getOwnPropertyDescriptor(unsafe, key));
    }
  }
};
const makeSafe = (unsafe, safe) => {
  copyProps(unsafe.prototype, safe.prototype);
  copyProps(unsafe, safe);
  Object.setPrototypeOf(safe.prototype, null);
  Object.freeze(safe.prototype);
  Object.freeze(safe);
  return safe;
};

exports.Apply = Reflect.apply;
exports.RegexpPrototypeTest = RegExp.prototype.test;
exports.SafeMap = makeSafe(Map, class SafeMap extends Map {});
exports.MapIteratorPrototypeNext = new Map().entries().next;
exports.SafeSet = makeSafe(Set, class SafeSet extends Set {});
exports.SafePromise = makeSafe(Promise, class SafePromise extends Promise {});
exports.SafeWeakMap = makeSafe(WeakMap, class SafeWeakMap extends WeakMap {});
exports.StringPrototypeReplace = String.prototype.replace;
exports.SymbolIterator = Symbol.iterator;
exports.SymbolReplace = Symbol.replace;
exports.TypeError = TypeError;
