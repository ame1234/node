import worker from 'worker_threads';
const { Blob, Error, Response } = global;
import {createRPC} from './helper.mjs';
const {
  parentPort,
  workerData: {url}
} = worker;
worker.parentPort = null;
worker.workerData = null;
const {
  port1: selfSource,
  port2: selfSink,
} = new worker.MessageChannel();
createRPC(selfSource, ({
  method,
  params
}) => {
  return HANDLERS[method](params);
});
let postToParent;
const gotParentPort = new Promise(f => {
  parentPort.on('message', async function init(parentSink) {
    parentPort.removeListener('message', init);
    postToParent = createRPC(parentSink, () => {
      throw Error('PARENT SHOULD NEVER DIRECTLY TALK TO CHILD');
    });
    f();
  });
});
(async () => {
  // this must occur before initializing the loader
  await gotParentPort;
  await import(url);
  parentPort.postMessage(selfSink, [selfSink]);
  parentPort.close();
})();

delete global.process;
delete global.Buffer;
delete global.DTRACE_NET_SERVER_CONNECTION;
delete global.DTRACE_NET_STREAM_END;
delete global.DTRACE_HTTP_SERVER_REQUEST;
delete global.DTRACE_HTTP_SERVER_RESPONSE;
delete global.DTRACE_HTTP_CLIENT_REQUEST;
delete global.DTRACE_HTTP_CLIENT_RESPONSE;
const self = global.self = global;
delete self.global;
self.parent = {
  resolve(request) {
    return postToParent({
      method: 'onresolve',
      params: request
    });
  }
};

const HANDLERS = {
  __proto__: null,
  async onresolve(request) {
    let ret = await new Promise(async (respondWith, r) => {
      try {
        self.onresolve({
          request,
          respondWith
        });
        r(new Error('not declared handled synchronously'));
      } catch (e) {
        r(e);
      }
    });
    if (!ret.body) {
      return {key: ret.key};
    }
    if (ret.body instanceof Blob) {
      return {
        key: ret.key,
        buffer: await new Response(ret.body).arrayBuffer(),
        type: ret.body.type,
      };
    }
    throw new Error('invalid result');
  }
};
