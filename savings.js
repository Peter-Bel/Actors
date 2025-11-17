// savings.js

const { parentPort, run, workerData } = require('./message.js');

let balance = workerData.initialBalance || 0;
const accountId = workerData.accountId;
const actorType = workerData.actorType || 'savings';

function handleMessage(type, value, sender, actorRef, rawMsg) {
  // Accept both legacy and new message formats
  const msg = rawMsg || {};
  const amount = msg.amount || value;
  switch (type) {
    case 'deposit':
      balance += amount;
      parentPort.postMessage({ accountId, balance, type: 'balanceUpdate' });
      break;
    case 'withdraw':
      if (balance >= amount) {
        balance -= amount;
        parentPort.postMessage({ accountId, balance, type: 'balanceUpdate' });
      } else {
        parentPort.postMessage({ accountId, error: 'Insufficient funds', type: 'error' });
      }
      break;
    case 'getBalance':
      parentPort.postMessage({ accountId, balance, type: 'balanceInfo' });
      break;
    default:
      parentPort.postMessage({ accountId, error: `Unknown message type: ${type}` });
  }
}

parentPort.postMessage({ accountId, actorType, message: 'Account actor is ready.' });
run(handleMessage);
