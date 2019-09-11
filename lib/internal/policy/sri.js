'use strict';
// Value of https://w3c.github.io/webappsec-subresource-integrity/#the-integrity-attribute

const {
  Object: {
    freeze,
    getPrototypeOf,
    setPrototypeOf
  },
  StringPrototype
} = primordials;

// Returns [{algorithm, value (in base64 string), options,}]
const {
  ERR_SRI_PARSE
} = require('internal/errors').codes;
const kWSP = '[\\x20\\x09]';
const kVCHAR = '[\\x21-\\x7E]';
const kHASH_ALGO = 'sha(?:256|384|512)';
// Base64
const kHASH_VALUE = '[A-Za-z0-9+/]+[=]{0,2}';
const kHASH_EXPRESSION = `(${kHASH_ALGO})-(${kHASH_VALUE})`;
// Ungrouped since unused
const kOPTION_EXPRESSION = `(?:${kVCHAR}*)`;
const kHASH_WITH_OPTIONS = `${kHASH_EXPRESSION}(?:[?](${kOPTION_EXPRESSION}))?`;
const kSRIPattern = RegExp(`(${kWSP}*)(?:${kHASH_WITH_OPTIONS})`, 'g');
freeze(kSRIPattern);

const BufferFrom = require('buffer').Buffer.from;
const RealArrayPrototype = getPrototypeOf([]);

const parse = (str) => {
  let prevIndex = 0;
  const entries = setPrototypeOf([], null);
  for (const match of StringPrototype.matchAll(
    StringPrototype.trimRight(str),
    kSRIPattern)
  ) {
    if (match.index !== prevIndex) {
      throw new ERR_SRI_PARSE(str, str.charAt(prevIndex), prevIndex);
    }
    if (entries.length > 0 && match[1] === '') {
      throw new ERR_SRI_PARSE(str, str.charAt(prevIndex), prevIndex);
    }

    // Avoid setters being fired
    entries[entries.length] = freeze({
      __proto__: null,
      algorithm: match[2],
      value: BufferFrom(match[3], 'base64'),
      // Unused / marked as non-capture group for now
      //   options: match[4] === undefined ? null : match[4],
    });
    prevIndex = prevIndex + match[0].length;
  }

  if (prevIndex !== str.length) {
    throw new ERR_SRI_PARSE(str, str.charAt(prevIndex), prevIndex);
  }
  return setPrototypeOf(entries, RealArrayPrototype);
};

module.exports = {
  parse,
};
