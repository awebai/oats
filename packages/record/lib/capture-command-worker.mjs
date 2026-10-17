// Fixed private entry. It accepts only the supervisor's authenticated IPC
// start; invoking this file directly cannot perform a capture operation.
import { runCaptureWorker } from "./capture-worker.mjs";
import { captureCommandOperation } from "./capture-command-operation.mjs";

await runCaptureWorker(captureCommandOperation);
