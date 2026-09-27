// a child for processSlot.test.ts: it replies with its pid, exits mid-message on "exit", holds
// "wait" until an abort arrives, and exits when its parent disconnects
process.on("disconnect", () => {
  process.exit();
});
process.on("message", (message) => {
  if (message.type === "exit") {
    process.exit(3);
  }
  if (message.type === "abort") {
    process.send({ type: "aborted", pid: process.pid });
  } else if (message.type !== "wait") {
    process.send({ type: "pid", pid: process.pid });
  }
});
