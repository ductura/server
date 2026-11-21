// Public interface of server/database/receipts (SRV-1502): the worker's
// read of the segment object a pending receipt names.
export {
  createPendingReceiptObjectSource,
  type PendingReceiptObject,
  type PendingReceiptObjectRead,
  type PendingReceiptObjectSource,
} from "./receipt-object.ts";
