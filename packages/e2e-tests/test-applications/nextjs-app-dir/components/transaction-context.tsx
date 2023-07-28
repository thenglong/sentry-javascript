'use client';

import { createContext, PropsWithChildren, useState } from 'react';
import { Transaction } from '@sentry/types';
import { startTransaction, getCurrentHub } from '@sentry/nextjs';

export const TransactionContext = createContext<
  { transactionActive: false; start: (transactionName: string) => void } | { transactionActive: true; stop: () => void }
>({
  transactionActive: false,
  start: () => undefined,
});

export function TransactionContextProvider({ children }: PropsWithChildren) {
  const [transaction, setTransaction] = useState<Transaction | undefined>(undefined);

  return (
    <TransactionContext.Provider
      value={
        transaction
          ? {
              transactionActive: true,
              stop: () => {
                transaction.finish();
                setTransaction(undefined);
              },
            }
          : {
              transactionActive: false,
              start: (transactionName: string) => {
                const t = startTransaction({ name: transactionName });
                getCurrentHub().getScope().setSpan(t);
                setTransaction(t);
              },
            }
      }
    >
      {children}
    </TransactionContext.Provider>
  );
}
