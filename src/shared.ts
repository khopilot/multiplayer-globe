// Messages that we'll send to the client

// Representing a person's position and loan details
export type Position = {
  lat: number;
  lng: number;
  id: string;
};

export type DebtorInfo = {
  position: Position;
  loanAmount: number;
  outstandingBalance: number;
  missedPayments: number;
  lastPaymentDate?: string;
  dueDate: string;
  phoneNumber?: string;
  name?: string;
  interestRate: number;
  status: 'active' | 'defaulted' | 'paid' | 'legal';
};

export type OutgoingMessage =
  | {
      type: "add-debtor";
      debtor: DebtorInfo;
    }
  | {
      type: "update-debtor";
      debtor: DebtorInfo;
    }
  | {
      type: "remove-debtor";
      id: string;
    };
