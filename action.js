// action.js

const { parentPort, run, workerData } = require('./message.js');

const { sourceAccountId, destinationAccountId } = workerData;
const actorType = 'action';

// Map to track pending forward requests to the main thread
const pending = new Map();

function genId() {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function waitForForwardResult(requestId, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('timeout waiting for forward result'));
    }, timeout);
    pending.set(requestId, { resolve: (resp) => { clearTimeout(timer); pending.delete(requestId); resolve(resp); }, reject });
  });
}

function handleMessage(type, value, sender, actorRef, rawMsg) {
  const msg = rawMsg || {};
  // Responses from the main thread for forwarded requests
  if (type === 'forwardResult') {
    const { requestId, resp, error } = msg;
    const p = pending.get(requestId);
    if (!p) return;
    if (error) p.reject(new Error(error));
    else p.resolve(resp);
    return;
  }
  // Responses from the main thread for actor creation
  if (type === 'createActorResult') {
    const { requestId, success, error } = msg;
    const p = pending.get(requestId);
    if (!p) return;
    if (!success) p.reject(new Error(error));
    else p.resolve({ success: true });
    return;
  }
  // Responses from main thread for actor info requests
  if (type === 'actorInfo') {
    const { requestId, actorId, info } = msg;
    const p = pending.get(requestId);
    if (!p) return;
    p.resolve(info);
    return;
  }
  // Incoming control to start a transfer
  if (type === 'transfer') {
    const amount = msg.amount;
    const fromId = msg.from || sourceAccountId;
    const toId = msg.to || destinationAccountId;
    performTransfer(amount, fromId, toId).catch(err => {
      parentPort.postMessage({ message: `Transfer failed: ${err.message}` });
    });
  }
}

async function performTransfer(amount, fromId, toId) {
  // Ask main thread for the `from` actor's type so we can decide whether withdraw is allowed
  const typeRequestId = genId();
  parentPort.postMessage({ type: 'getActorInfo', actorId: fromId, requestId: typeRequestId });
  let fromInfo = null;
  try {
    fromInfo = await waitForForwardResult(typeRequestId);
  } catch (err) {
    fromInfo = null;
  }

  // If actor exists and is of type 'funds', it cannot be withdrawn from
  if (fromInfo && (fromInfo.actorType === 'funds' || fromInfo.actorType === 'fund')) {
    parentPort.postMessage({ type: 'transferResult', success: false, error: `Source actor ${fromId} is a funds-only account and cannot be withdrawn from` });
    return;
  }

  // First, ensure the destination actor exists; if not, create it
  if (toId && !toId.startsWith('temp-')) {
    const checkRequestId = genId();
    parentPort.postMessage({ type: 'forward', target: toId, payload: { type: 'getBalance' }, requestId: checkRequestId });
    try {
      await waitForForwardResult(checkRequestId);
    } catch (err) {
      // Destination actor doesn't exist; create it with initial balance 0
      console.log(`[action] Destination ${toId} not found. Creating new account...`);
      const createRequestId = genId();
      parentPort.postMessage({ type: 'createActor', actorId: toId, initialBalance: 0, requestId: createRequestId });
      try {
        await waitForForwardResult(createRequestId);
        console.log(`[action] Successfully created account ${toId}`);
      } catch (createErr) {
        parentPort.postMessage({ type: 'transferResult', success: false, error: `Failed to create account ${toId}: ${createErr.message}` });
        return;
      }
    }
  }

  const withdrawRequestId = genId();
  parentPort.postMessage({ type: 'forward', target: fromId, payload: { type: 'withdraw', amount }, requestId: withdrawRequestId });
  const withdrawResp = await waitForForwardResult(withdrawRequestId);
  if (withdrawResp && withdrawResp.type === 'error') {
    parentPort.postMessage({ type: 'transferResult', success: false, requestId: withdrawRequestId, error: withdrawResp.error, from: fromId });
    return;
  }

  const depositRequestId = genId();
  parentPort.postMessage({ type: 'forward', target: toId, payload: { type: 'deposit', amount }, requestId: depositRequestId });
  const depositResp = await waitForForwardResult(depositRequestId);
  if (depositResp && depositResp.type === 'error') {
    parentPort.postMessage({ type: 'transferResult', success: false, requestId: depositRequestId, error: depositResp.error, to: toId });
    return;
  }

  parentPort.postMessage({ type: 'transferResult', success: true, requestId: `${withdrawRequestId}:${depositRequestId}`, from: fromId, to: toId });
}

run(handleMessage);
