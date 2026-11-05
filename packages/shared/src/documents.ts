/** Document numbers. The server numbers BTL-000123; an offline PC numbers BTL-D2-000014. */

export const DOC_PREFIX = { BOTTLES: 'BTL', RICE: 'RIC', RECEIPT: 'RCP' } as const;
export type DocPrefix = (typeof DOC_PREFIX)[keyof typeof DOC_PREFIX];

export const billPrefix = (line: 'BOTTLES' | 'RICE') => DOC_PREFIX[line];

/** Offline bill numbers, BTL-D2-000014 or RIC-D2-000014. */
export const OFFLINE_BILL_NO = /^(BTL|RIC)-D\d{1,4}-\d{6}$/;
/** Offline receipt numbers, RCP-D2-000014. */
export const OFFLINE_RECEIPT_NO = /^RCP-D\d{1,4}-\d{6}$/;
/** Either of the above. */
export const OFFLINE_DOC_NO = /^(BTL|RIC|RCP)-D\d{1,4}-\d{6}$/;

export const offlineNumber = (prefix: DocPrefix, device: string, n: number) => `${prefix}-${device}-${String(n).padStart(6, '0')}`;
export const serverNumber = (prefix: string, n: number) => `${prefix}-${String(n).padStart(6, '0')}`;
