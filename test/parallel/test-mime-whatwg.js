'use strict';

require('../common');
const assert = require('assert');
const { MIME } = require('util');
const fixtures = require('../common/fixtures');

function test(mimes) {
  for (const entry of mimes) {
    if (typeof entry === 'string') continue;
    const { input, output } = entry;
    if (output === null) {
      assert.throws(() => new MIME(input), /ERR_INVALID_MIME_SYNTAX/i);
    } else {
      const str = `${new MIME(input)}`;
      assert.strictEqual(str, output);
    }
  }
}

// These come from https://github.com/web-platform-tests/wpt/tree/master/mimesniff/mime-types/resources
test(require(fixtures.path('./mime-whatwg.js')));
test(require(fixtures.path('./mime-whatwg-generated.js')));
