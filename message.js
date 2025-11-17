// message.js (This script will be run by each worker thread)
const { parentPort, isMainThread, workerData } = require('worker_threads');

if (isMainThread) {
  throw new Error('This file is not meant to be run in the main thread.');
}


const messageQueue = [];

// Default handleMessage implementation
function handleMessage(type, value, sender, actorRef) {
  // This should be replaced or extended by the actor implementation
  // For demonstration, just log the message
  console.log(`[message.js] Received: type=${type}, value=${JSON.stringify(value)}, sender=${sender}, actorRef=${actorRef}`);
}

// Main message processing loop
function run(customHandler) {
  const handler = customHandler || handleMessage;
  const processNextMessage = () => {
    if (messageQueue.length > 0) {
      const msg = messageQueue.shift();
      // Support both {type, value, sender, actorRef} and generic messages
      if (msg && typeof msg === 'object' && msg.type) {
        handler(msg.type, msg.value, msg.sender, msg.actorRef, msg);
      } else {
        handler('unknown', msg, null, null, msg);
      }
    }
    setTimeout(processNextMessage, 10);
  };
  processNextMessage();
}

function enqueueMessage(message) {
  messageQueue.push(message);
}

parentPort.on('message', (message) => {
  enqueueMessage(message);
});

module.exports = { parentPort, run, enqueueMessage, handleMessage, workerData };

/**
 * Usage example in an actor file (e.g., savings.js):
 *
 * const { parentPort, run } = require('./message.js');
 *
 * function actorHandleMessage(type, value, sender, actorRef, rawMsg) {
 *   // Implement your actor logic here
 *   if (type === 'deposit') {
 *     // ...
 *   }
 *   // ...
 * }
 *
 * run(actorHandleMessage);
 */
