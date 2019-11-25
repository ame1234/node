'use strict';
const {
  Object: {
    entries: ObjectEntries
  },
  MapIteratorPrototype: { next: MapIteratorPrototypeNext },
  // RegExp,
  RegExpPrototype: {
    test: RegExpPrototypeTest,
    exec: RegExpPrototypeExec
  },
  StringPrototype: {
    replace: StringPrototypeReplace,
    toLowerCase: StringPrototypeToLowerCase,
    slice: StringPrototypeSlice
  },
  Symbol: {
    replace: SymbolReplace,
    iterator: SymbolIterator,
  },
  SafeMap: Map,
} = primordials;

const NotHTTPTokenCodePoint = /[^\!\#\$\%\&\'\*\+\-\.\^\_\`\|\~A-Za-z0-9]/g;
const NotHTTPQuotedStringCodePoint = /[^\t\u0020-\~\u0080-\u00FF]/g;
NotHTTPQuotedStringCodePoint[SymbolReplace] = null;

const HTTP_TAB_OR_SPACE = '\t ';
const HTTP_WHITESPACE = ['\r\n', ...HTTP_TAB_OR_SPACE].join('');
const BEGINNING_WHITESPACE = new RegExp(`^[${HTTP_WHITESPACE.replace(/\W/g, '\\$&')}]*`);
const ENDING_WHITESPACE = new RegExp(`[${HTTP_WHITESPACE.replace(/\W/g, '\\$&')}]*$`);
function toASCIILower(str) {
  return StringPrototypeReplace(str, /[A-Z]/g, c => StringPrototypeToLowerCase(c))
}
function parse(str, target) {
  str = StringPrototypeReplace(str, BEGINNING_WHITESPACE, '');
  str = StringPrototypeReplace(str, ENDING_WHITESPACE, '');
  let position = 0;
  let type = exec(/^[^\/]*/, str);
  if (!type || type[0] === '' || test(NotHTTPTokenCodePoint, type[0])) {
    throw new TypeError('Error parsing MIME: invalid type');
  }
  type = type[0];
  position = type.length;
  position += 1;
  let subtype = exec(/^[^;]*/, StringPrototypeSlice(str, position));
  if (subtype) {
    position = position += subtype[0].length;
    subtype[0] = StringPrototypeReplace(subtype[0], ENDING_WHITESPACE, '');
  }
  if (!subtype || subtype[0] === '' ||test(NotHTTPTokenCodePoint, subtype[0])) {
    throw new TypeError('Error parsing MIME: invalid subtype');
  }
  subtype = subtype[0];
  target.type = toASCIILower(type);
  target.subtype = toASCIILower(subtype);
  const parameters = { __proto__: null };
  while (position < str.length) {
    position++;
    const skip = exec(BEGINNING_WHITESPACE, StringPrototypeSlice(str, position));
    if (skip) position += skip[0].length;
    let parameterName = exec(/^[^;=]*/, StringPrototypeSlice(str, position));
    parameterName = parameterName[0];
    position += parameterName.length;
    parameterName = toASCIILower(parameterName);
    if (position < str.length) {
      const [codePoint] = StringPrototypeSlice(str, position);
      if (codePoint === ';') {
        continue;
      } else {
        position += 1;
      }
    }
    if (position >= str.length) {
      break;
    }
    const [codePoint] = StringPrototypeSlice(str, position);
    let parameterValue = null;
    if (codePoint === '"') {
      position += 1;
      const inside = exec(/^(?:([\\]$)|[\\][\s\S]|[^"])*(?:(")|$)/u, StringPrototypeSlice(str, position));
      position += inside[0].length;
      // Trailing \ at end of string
      parameterValue = StringPrototypeReplace(StringPrototypeSlice(
        inside[0],
        0,
        inside[1] || inside[2] ? -1 : undefined
      ), /[\\]([\s\S])/ug, '$1');
      if (inside[1]) parameterValue += '\\';
    } else {
      let value = exec(/[^;]*/, StringPrototypeSlice(str, position))[0];
      position += value.length;
      value = StringPrototypeReplace(value, ENDING_WHITESPACE, '');
      if (value === '') continue;
      parameterValue = value;
    }
    if (parameterName !== '' &&
      test(NotHTTPTokenCodePoint, parameterName) === false &&
      test(NotHTTPQuotedStringCodePoint, parameterValue) === false &&
      parameterName in parameters === false) {
      parameters[parameterName] = parameterValue;
    }
  }
  target.parameters = ObjectEntries(parameters);
  return target;
}

const test = (pattern, value) => {
  pattern.lastIndex = 0;
  const ret = pattern.test(value);
  // console.dir({
  //   pattern,
  //   value,
  //   _: [...value].map((c) => c.codePointAt(0)),
  //   ret,
  //   _1: (pattern.lastIndex = 0, NotHTTPTokenCodePoint.exec(value))
  // });
  return ret;
};
const exec = (pattern, value) => {
  pattern.lastIndex = 0;
  const ret = pattern.exec(value);
  // console.dir({
  //   pattern,
  //   value,
  //   _: [...value].map((c) => c.codePointAt(0)),
  //   ret,
  //   _1: (pattern.lastIndex = 0, NotHTTPTokenCodePoint.exec(value))
  // });
  return ret;
};

const encode = (value) => {
  if (value.length === 0) return '""';
  NotHTTPTokenCodePoint.lastIndex = 0;
  const encode = test(NotHTTPTokenCodePoint, value);
  if (!encode) return value;
  const escaped = StringPrototypeReplace(value, /["\\]/g, '\\$&');
  const ret = `"${escaped}"`;
  return ret;
};

const MIMEStringify = (type, subtype, parameters) => {
  let ret = `${type}/${subtype}`;
  const entries = MIMEParamsData(parameters).entries();
  let keyValuePair, done;
  for (;;) {
    ({ value: keyValuePair, done } =
        MapIteratorPrototypeNext(entries));
    if (done) break;
    const [key, value] = keyValuePair;
    const encoded = encode(value);
    ret += `;${key}=${encoded}`;
  }
  return ret;
};

class MIMEParams {
  #data;
  constructor() {
    this.#data = new Map();
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
    const invalidName = test(NotHTTPTokenCodePoint, name);
    if (name.length === 0 || invalidName) {
      throw new Error('Invalid MIME parameter name');
    }
    NotHTTPQuotedStringCodePoint.lastIndex = 0;
    const invalidValue = test(NotHTTPQuotedStringCodePoint, value);
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
    const data = parse(string, { __proto__: null });
    this.#type = data.type;
    this.#subtype = data.subtype;
    this.#parameters = new MIMEParams();
    const paramsMap = MIMEParamsData(this.#parameters);
    for (var i = 0; i < data.parameters.length; i++) {
      const [k, v] = data.parameters[i];
      paramsMap.set(k, v);
    }
  }

  get type() {
    return this.#type;
  }

  set type(v) {
    v = `${v}`;
    NotHTTPTokenCodePoint;
    const invalidType = test(NotHTTPTokenCodePoint, v);
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
    const invalidSubtype = test(NotHTTPTokenCodePoint, v);
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
};
