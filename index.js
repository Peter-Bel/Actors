// index.js
const { Worker } = require('worker_threads');

// A helper function to create and manage actor instances
function createActor(path, actorId, workerData, actorType) {
  const worker = new Worker(path, { workerData });
  worker.actorId = actorId;

  worker.on('message', (message) => {
    // Basic routing / logging for actor messages
    if (!message) return;

    if (message.type === 'balanceUpdate') {
      // Accept either `newBalance` or `balance` property, depending on actor implementation
      const bal = message.newBalance !== undefined ? message.newBalance : message.balance;
      console.log(`[${actorId}]: New balance for ${message.accountId} is ${bal}`);
      return;
    }

    if (message.type === 'balanceInfo') {
      console.log(`[${actorId}]: Balance for ${message.accountId} is ${message.balance}`);
      return;
    }

    if (message.type === 'error') {
      console.error(`[${actorId}]: Error in ${message.accountId}: ${message.error}`);
      return;
    }

    // Worker asks main for metadata about an actor (type, accountId)
    if (message.type === 'getActorInfo') {
      const { actorId: lookupId, requestId } = message;
      const info = actorMeta.get(lookupId) || null;
      worker.postMessage({ type: 'actorInfo', requestId, actorId: lookupId, info });
      return;
    }

    // Generic forward request: origin actor asks main thread to forward
    // a payload to another actor and return the reply.
    if (message.type === 'forward') {
      const { target, payload, requestId } = message;
      handleForward(worker, target, payload, requestId);
      return;
    }

    // Handle createActor requests from worker threads
    if (message.type === 'createActor') {
      const { actorId: newActorId, initialBalance, requestId, actorType } = message;
      handleCreateActor(worker, newActorId, initialBalance, requestId, actorType);
      return;
    }

    // If actor announces its metadata (actorType / accountId), store it.
    if (message && message.actorType) {
      actorMeta.set(actorId, { accountId: message.accountId, actorType: message.actorType });
      actorMeta.set(actorType, { accountId: workerData.accountId, actorType: workerData.actorType });
    }

    // Generic log for other messages
    console.log(`[${actorId}]:`, message);
  });

  worker.on('error', (err) => console.error(`[${actorId}]: Worker error:`, err));
  return worker;
}

// Registry for actor workers by ID
const actors = new Map();
// Metadata for actors (type, accountId)
const actorMeta = new Map();

function createAndRegister(path, actorId, workerData) {
  const w = createActor(path, actorId, workerData);
  actors.set(actorId, w);
  if (workerData && workerData.accountId) {
    actors.set(workerData.accountId, w);
  }
  // Determine actorType: prefer explicit, fallback to path
  let actorType = workerData && workerData.actorType;
  if (!actorType) {
    if (path.includes('funds')) actorType = 'funds';
    else if (path.includes('savings')) actorType = 'savings';
    else actorType = 'unknown';
  }
  actorMeta.set(actorId, { accountId: workerData && workerData.accountId, actorType });
  if (workerData && workerData.accountId) actorMeta.set(workerData.accountId, { accountId: workerData.accountId, actorType });
  return w;
}

function getActor(actorId) {
  return actors.get(actorId);
}
function getActorType(actorType) {
  return actors.get(actorType);
}

// Post a message to a worker and wait for its next message response.
// This is a simple helper that listens once and resolves on the first reply.
function sendAndWait(worker, message, timeout = 1500) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const onMessage = (resp) => {
      worker.off('message', onMessage);
      if (timer) clearTimeout(timer);
      resolve(resp);
    };

    timer = setTimeout(() => {
      worker.off('message', onMessage);
      reject(new Error('timeout waiting for worker response'));
    }, timeout);

    worker.on('message', onMessage);
    worker.postMessage(message);
  });
}

// Forward helper: send `payload` to actor identified by `target` and return
// the first message that actor produces in response. Replies back to the
// origin `requester` with `{ type: 'forwardResult', requestId, resp }`.
async function handleForward(requesterWorker, target, payload, requestId) {
  const targetWorker = getActor(target);
  if (!targetWorker) {
    requesterWorker.postMessage({ type: 'forwardResult', requestId, error: 'Actor not found' });
    return;
  }

  try {
    const resp = await sendAndWait(targetWorker, payload, 2000);
    requesterWorker.postMessage({ type: 'forwardResult', requestId, resp });
  } catch (err) {
    requesterWorker.postMessage({ type: 'forwardResult', requestId, error: err.message });
  }
}

// Handle actor creation requests from worker threads.
async function handleCreateActor(requesterWorker, actorId, initialBalance, requestId, actorType) {
  try {
    if (getActor(actorId)) {
      requesterWorker.postMessage({ type: 'createActorResult', requestId, success: false, error: `Actor ${actorId} already exists` });
      return;
    }
    const path = type === 'funds' ? './funds.js' : './savings.js';
    const newActor = createAndRegister(path, actorId, { accountId: actorId, initialBalance: initialBalance || 0});
    requesterWorker.postMessage({ type: 'createActorResult', requestId, success: true, actorId });
  } catch (err) {
    requesterWorker.postMessage({ type: 'createActorResult', requestId, success: false, error: err.message });
  }
}

// Create the actors (registered)
const accountA = createAndRegister('./savings.js', 'AccountA', { accountId: 'A', initialBalance: 100 });
const accountB = createAndRegister('./savings.js', 'AccountB', { accountId: 'B', initialBalance: 50 });
const actionActor = createAndRegister('./action.js', 'ActionActor', { sourceAccountId: 'A', destinationAccountId: 'B' });
const actionActor2 = createAndRegister('./action.js', 'ActionActor2', { sourceAccountId: 'A', destinationAccountId: 'C' });
const fundA = createAndRegister('./funds.js', 'fundA', { accountId: 'fA', initialBalance: 100 });
const actionActorF1 = createAndRegister('./action.js', 'fA_Transfer_A', { sourceAccountId: 'fA', destinationAccountId: 'A' });
const actionActorF2 = createAndRegister('./action.js', 'A_Transfer_fA', { sourceAccountId: 'A', destinationAccountId: 'fA' });

// calls for balance
setTimeout(() => {
  console.log('\nBalances:');
  //savings
  accountA.postMessage({ type: 'getBalance' });
  accountB.postMessage({ type: 'getBalance' });
  accountA.postMessage({ type: 'deposit', amount: 50 });
  accountB.postMessage({ type: 'withdraw', amount: 30 });
  //funds
  fundA.postMessage({ type: 'getBalance' });
}, 500);

// calls for transfers
setTimeout(() => {
  console.log('\nTransfers:');
  // Demonstrate transfers on accounts
  actionActor.postMessage({ type: 'transfer', amount: 10 });
  actionActor2.postMessage({ type: 'transfer', amount: 10 });
  actionActorF1.postMessage({ type: 'transfer', amount: 10 });
  actionActorF2.postMessage({ type: 'transfer', amount: 10 });
}, 800);

// calls for funds
setTimeout(() => {
  console.log('\nFunds:');
  fundA.postMessage({ type: 'deposit', amount: 50 });
  fundA.postMessage({ type: 'mature', toId: 'A' });
}, 1000)

// Clean up after a short wait so workers have time to respond
setTimeout(() => {
  for (const w of actors.values()) w.terminate();
}, 2000);

