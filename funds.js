
const { parentPort, run, workerData } = require('./message.js');

let balance = workerData.initialBalance * 1.1 || 0;
const accountId = workerData.accountId;
const actorType = workerData.actorType || 'funds';

// simple request tracking for forwarded requests
const pending = new Map();
function genId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function waitFor(requestId, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('timeout'));
    }, timeout);
    pending.set(requestId, (resp) => {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve(resp);
    });
  });
}

function handleMessage(type, value, sender, actorRef, rawMsg) {
  const msg = rawMsg || {};
  // respond to forwarded results and other replies
  if (type === 'forwardResult' && msg.requestId && pending.has(msg.requestId)) {
    const cb = pending.get(msg.requestId);
    if (cb) cb(msg);
    return;
  }
  if (type === 'deleteActorResult' && msg.requestId && pending.has(msg.requestId)) {
    const cb = pending.get(msg.requestId);
    if (cb) cb(msg);
    return;
  }
  const amount = msg.amount || value;
  const toId = msg.toId || msg.savingsId;
  switch (type) {
    case 'deposit':
      balance = (balance + amount) * 1.1; // 10% interest on deposit
      parentPort.postMessage({ accountId, balance, type: 'balanceUpdate' });
      break;
    case 'getBalance':
      parentPort.postMessage({ accountId, actorType, balance, type: 'balanceInfo' });
      break;
    case 'mature':
      (async () => {
        const depositTarget = toId;
        if (!depositTarget) {
          parentPort.postMessage({ accountId, error: 'mature requires a target savings id', type: 'error' });
          return;
        }
        if (balance <= 0) {
          parentPort.postMessage({ accountId, message: 'No balance to transfer', type: 'info' });
        }
        const depositRequestId = genId('deposit');
        parentPort.postMessage({ type: 'forward', target: depositTarget, payload: { type: 'deposit', amount: balance }, requestId: depositRequestId });
        let depositResp;
        try {
          depositResp = await waitFor(depositRequestId, 1000);
        } catch (err) {
          parentPort.postMessage({ accountId, error: `mature deposit timed out: ${err.message}`, type: 'error' });
          return;
        }
        if (depositResp && depositResp.error) {
          parentPort.postMessage({ accountId, error: `mature deposit failed: ${depositResp.error}`, type: 'error' });
          return;
        }
        const delReqId = genId('del');
        parentPort.postMessage({ type: 'deleteActor', actorId: accountId, requestId: delReqId });
        try {
          const delResp = await waitFor(delReqId, 3000);
          if (delResp && delResp.success) {
            process.exit(0);
          } else {
            parentPort.postMessage({ accountId, error: `failed to delete actor: ${delResp && delResp.error}`, type: 'error' });
          }
        } catch (err) {
          parentPort.postMessage({ accountId, error: `deleteActor timed out: ${err.message}`, type: 'error' });
        }
      })();
      break;
    default:
      parentPort.postMessage({ accountId, error: `Unknown message type: ${type}` });
  }
}

parentPort.postMessage({ accountId, actorType, message: 'Fund actor is ready.' });
run(handleMessage);
