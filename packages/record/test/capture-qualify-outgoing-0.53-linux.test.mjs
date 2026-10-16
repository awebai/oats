// Qualification Q1d (#1108 checkpoint Q): v0.53.0's capture beside this head's,
// first capture, first upgrade and no-op on one synthetic home of 1,300 streams.
// Runs only on the dispatched "Linux tests" runner; a skip is not evidence.
import { outgoingComparison } from "./fixtures/qualify-outgoing.mjs";

outgoingComparison("0.53.0");
