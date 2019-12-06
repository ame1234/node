'use strict';

const {
  ArrayPrototypeJoin,
  ObjectCreate,
  MapIteratorPrototypeNext,
  RegExpPrototypeExec,
  RegExpPrototypeSymbolMatch,
  RegExpPrototypeSymbolMatchAll,
  RegExpPrototypeSymbolReplace,
  RegExpPrototypeSymbolSearch,
  RegExpPrototypeSymbolSplit,
  StringPrototypeReplace,
  StringPrototypeToLowerCase,
  StringPrototypeSlice,
  StringPrototypeCharAt,
  StringPrototypeIndexOf,
  StringPrototypeSearch,
  SymbolIterator,
  SymbolMatch,
  SymbolMatchAll,
  SymbolReplace,
  SymbolSearch,
  SymbolSplit,
  SafeMap: Map,
} = primordials;

function hardenRegExp(pattern) {
  pattern[SymbolMatch] = RegExpPrototypeSymbolMatch;
  pattern[SymbolMatchAll] = RegExpPrototypeSymbolMatchAll;
  pattern[SymbolReplace] = RegExpPrototypeSymbolReplace;
  pattern[SymbolSearch] = RegExpPrototypeSymbolSearch;
  pattern[SymbolSplit] = RegExpPrototypeSymbolSplit;
  return pattern;
}

const NotHTTPTokenCodePoint = hardenRegExp(/[^!#$%&'*+\-.^_`|~A-Za-z0-9]/g);
const NotHTTPQuotedStringCodePoint = hardenRegExp(/[^\t\u0020-~\u0080-\u00FF]/g);

const HTTP_TAB_OR_SPACE = '\t ';
const HTTP_WHITESPACE = ArrayPrototypeJoin(['\r\n', ...HTTP_TAB_OR_SPACE], '');
const BEGINNING_WHITESPACE = hardenRegExp(new RegExp(
  `^[${StringPrototypeReplace(HTTP_WHITESPACE, /\W/g, '\\$&')}]*`));
const ENDING_WHITESPACE = hardenRegExp(new RegExp(
  `[${StringPrototypeReplace(HTTP_WHITESPACE, /\W/g, '\\$&')}]*$`));

const ASCII_LOWER = hardenRegExp(/[A-Z]/g);
function toASCIILower(str) {
  return StringPrototypeReplace(str, ASCII_LOWER, (c) => StringPrototypeToLowerCase(c));
}

const SOLIDUS = '/';
const SEMICOLON = ';';
function parseTypeAndSubtype(str) {
  // Skip only HTTP whitespace from start
  str = StringPrototypeReplace(str, BEGINNING_WHITESPACE, '');
  // read until '/'
  const typeEnd = StringPrototypeIndexOf(str, SOLIDUS);
  const trimmedType = typeEnd === -1 ?
    str :
    StringPrototypeSlice(str, 0, typeEnd);
  if (trimmedType === '' ||
    StringPrototypeSearch(trimmedType, NotHTTPTokenCodePoint) !== -1) {
    throw new TypeError('Invalid MIME type');
  }
  // skip type and '/'
  let position = trimmedType.length + 1;
  const type = toASCIILower(trimmedType);
  // read until ';'
  const subtypeEnd = StringPrototypeIndexOf(str, SEMICOLON, position);
  const rawSubtype = subtypeEnd === -1 ?
    StringPrototypeSlice(str, position) :
    StringPrototypeSlice(str, position, subtypeEnd);
  position += rawSubtype.length;
  if (subtypeEnd !== -1) {
    position += 1;
  }
  const trimmedSubtype = StringPrototypeReplace(
    rawSubtype,
    ENDING_WHITESPACE,
    '');
  if (trimmedSubtype === '' ||
    StringPrototypeSearch(trimmedSubtype, NotHTTPTokenCodePoint) !== -1) {
    throw new TypeError('Invalid MIME subtype');
  }
  const subtype = toASCIILower(trimmedSubtype);
  const target = ObjectCreate(null);
  target.type = type;
  target.subtype = subtype;
  target.parametersString = StringPrototypeSlice(str, position);
  return target;
}

const UNTIL_EQUALS_OR_SEMICOLON = hardenRegExp(/^[^;=]*/);
const QUOTED_VALUE_PATTERN = hardenRegExp(/^(?:([\\]$)|[\\][\s\S]|[^"])*(?:(")|$)/u);
const QUOTED_CHARACTER = hardenRegExp(/[\\]([\s\S])/ug);
function parseParametersString(str) {
  const paramsMap = new Map();
  str = StringPrototypeReplace(str, ENDING_WHITESPACE, '');
  let position = 0;
  while (position < str.length) {
    // Skip any whitespace before parameter
    const skip = execPattern(
      BEGINNING_WHITESPACE,
      StringPrototypeSlice(str, position))[0];
    if (skip) position += skip.length;
    // Read until ';' or '='
    const parameterMatch = execPattern(
      UNTIL_EQUALS_OR_SEMICOLON,
      StringPrototypeSlice(str, position));
    const parameterString = toASCIILower(parameterMatch[0]);
    position += parameterString.length;
    // If we found a terminating character
    if (position < str.length) {
      // Safe to use because we never do special actions for surrogate pairs
      const char = StringPrototypeCharAt(str, position);
      // Skip the terminating character
      position += 1;
      // Ignore parameters without values
      if (char === ';') {
        continue;
      }
    }
    // If we are at end of the string, it cannot have a value
    if (position >= str.length) break;
    // Safe to use because we never do special actions for surrogate pairs
    const char = StringPrototypeCharAt(str, position);
    let parameterValue = null;
    if (char === '"') {
      // Handle quoted-string form of values
      // skip '"'
      position += 1;
      // Find matching closing '"' or end of string
      //   use $1 to see if we terminated on unmatched '\'
      //   use $2 to see if we terminated on a matching '"'
      //   so we can skip the last char in either case
      const insideMatch = execPattern(
        QUOTED_VALUE_PATTERN,
        StringPrototypeSlice(str, position));
      position += insideMatch[0].length;
      // Skip including last character if an unmatched '\' or '"' during
      // unescape
      const inside = insideMatch[1] || insideMatch[2] ?
        StringPrototypeSlice(insideMatch[0], 0, -1) :
        insideMatch[0];
      // Unescape '\' quoted characters
      parameterValue = StringPrototypeReplace(inside, QUOTED_CHARACTER, '$1');
      // If we did have an unmatched '\' add it back to the end
      if (insideMatch[1]) parameterValue += '\\';
    } else {
      // Handle the normal parameter value form
      const valueEnd = StringPrototypeIndexOf(str, SEMICOLON, position);
      const rawValue = valueEnd === -1 ?
        StringPrototypeSlice(str, position) :
        StringPrototypeSlice(str, position, valueEnd);
      position += rawValue.length;
      const trimmedValue = StringPrototypeReplace(rawValue, ENDING_WHITESPACE, '');
      // Ignore parameters without values
      if (trimmedValue === '') continue;
      parameterValue = trimmedValue;
    }
    if (parameterString !== '' &&
      StringPrototypeSearch(parameterString, NotHTTPTokenCodePoint) === -1 &&
      StringPrototypeSearch(parameterValue, NotHTTPQuotedStringCodePoint) === -1 &&
      paramsMap.has(parameterString) === false) {
      paramsMap.set(parameterString, parameterValue);
    }
    position++;
  }
  return paramsMap;
}

const execPattern = (pattern, value) => {
  pattern.lastIndex = 0;
  return RegExpPrototypeExec(pattern, value);
};

const QUOTE_OR_SOLIDUS = hardenRegExp(/["\\]/g);
const encode = (value) => {
  if (value.length === 0) return '""';
  NotHTTPTokenCodePoint.lastIndex = 0;
  const encode = StringPrototypeSearch(value, NotHTTPTokenCodePoint) !== -1;
  if (!encode) return value;
  const escaped = StringPrototypeReplace(value, QUOTE_OR_SOLIDUS, '\\$&');
  return `"${escaped}"`;
};

const MIMEStringify = (type, subtype, parameters) => {
  let ret = `${type}/${subtype}`;
  const paramStr = MIMEParamsStringify(parameters);
  if (paramStr.length) ret += `;${paramStr}`;
  return ret;
};

const MIMEParamsStringify = (parameters) => {
  let ret = '';
  const entries = MIMEParamsData(parameters).entries();
  let keyValuePair, done;
  // Using this to avoid prototype pollution on Map iterators
  while ({ value: keyValuePair, done } =
        MapIteratorPrototypeNext(entries)) {
    if (done) break;
    const [key, value] = keyValuePair;
    const encoded = encode(value);
    // Ensure they are separated
    if (ret.length) ret += ';';
    ret += `${key}=${encoded}`;
  }
  return ret;
};

class MIMEParams {
  #data;
  constructor(init = '') {
    this.#data = parseParametersString(`${init}`);
  }

  delete(name) {
    this.#data.delete(name);
  }

  get(name) {
    const data = this.#data;
    if (data.has(name)) {
      return data.get(name);
    }
    return null;
  }

  has(name) {
    return this.#data.has(name);
  }

  set(name, value) {
    const data = this.#data;
    NotHTTPTokenCodePoint.lastIndex = 0;
    name = `${name}`;
    value = `${value}`;
    const invalidName = StringPrototypeSearch(name, NotHTTPTokenCodePoint) !== -1;
    if (name.length === 0 || invalidName) {
      throw new Error('Invalid MIME parameter name');
    }
    NotHTTPQuotedStringCodePoint.lastIndex = 0;
    const invalidValue = StringPrototypeSearch(value, NotHTTPQuotedStringCodePoint) !== -1;
    if (invalidValue) {
      throw new Error('Invalid MIME parameter value');
    }
    data.set(name, value);
  }

  *entries() {
    return yield* this.#data.entries();
  }

  *keys() {
    return yield* this.#data.keys();
  }

  *values() {
    return yield* this.#data.values();
  }

  *[SymbolIterator]() {
    return yield* this.#data.entries();
  }

  toJSON() {
    return MIMEParamsStringify(this);
  }

  toString() {
    return MIMEParamsStringify(this);
  }

  // Used to act as a friendly class to stringifying stuff
  // not meant to be exposed to users, could inject invalid values
  static _data(o) {
    return o.#data;
  }
}

const MIMEParamsData = MIMEParams._data;
delete MIMEParams._data;

class MIME {
  #type;
  #subtype;
  #parameters;
  constructor(string) {
    string = `${string}`;
    const data = parseTypeAndSubtype(string);
    this.#type = data.type;
    this.#subtype = data.subtype;
    this.#parameters = new MIMEParams(data.parametersString);
  }

  get type() {
    return this.#type;
  }

  set type(v) {
    v = `${v}`;
    NotHTTPTokenCodePoint;
    const invalidType = StringPrototypeSearch(v, NotHTTPTokenCodePoint) !== -1;
    if (v.length === 0 || invalidType) {
      throw new Error('Invalid MIME type');
    }
    this.#type = toASCIILower(v);
  }

  get subtype() {
    return this.#subtype;
  }

  set subtype(v) {
    v = `${v}`;
    const invalidSubtype = StringPrototypeSearch(v, NotHTTPTokenCodePoint) !== -1;
    if (v.length === 0 || invalidSubtype) {
      throw new Error('Invalid MIME subtype');
    }
    this.#subtype = toASCIILower(v);
  }

  get params() {
    return this.#parameters;
  }

  toJSON() {
    return MIMEStringify(this.#type, this.#subtype, this.#parameters);
  }

  toString() {
    return MIMEStringify(this.#type, this.#subtype, this.#parameters);
  }
}
module.exports = {
  MIME,
  MIMEParams
};
