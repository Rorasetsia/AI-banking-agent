export type GreenCategory='fuel'|'public_transport'|'topup'|'ride_hail'|'charging'|'unknown'|'excluded';
export interface GreenStats { totalCents:number; counts:Record<GreenCategory,number>; amounts:Record<GreenCategory,number>; publicShare:number|null }
export interface GreenReport {
  consent:boolean;version:string;month:string;previousMonth:string;
  level:{code:'insufficient'|'starting'|'steady'|'active';label:string;reason:string};
  coverage:{eligibleCount:number;recognizedCount:number;ratedCount:number;distinctDays:number;excludedCount:number;note:string};
  current:GreenStats;previous:GreenStats;
  evidence:{transactionId:string;date:string;merchant:string;amountCents:number;category:GreenCategory;reason:string;source:'rule'|'user';rated:boolean}[];
  suggestions:{id:string;title:string;detail:string;question:string}[];
  trend:{comparable:boolean;expenseDifferenceCents:number|null;publicShareDifference:number|null;note:string};
  limitations:string[];rules:string[];
  preferences:{maxExtraMinutes?:number;requiredCarDays?:number};
  activeWatches:{id:string;title:string;status:string;expiresAt:string}[];
  goals:{id:string;title:string;amountCents:number;status:string}[];
}
