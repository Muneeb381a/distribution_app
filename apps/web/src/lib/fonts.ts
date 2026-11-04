import { Noto_Nastaliq_Urdu } from 'next/font/google';

/** Urdu (Nastaliq) font for bills. Must be created once at module scope. */
export const urdu = Noto_Nastaliq_Urdu({ subsets: ['arabic'], weight: ['400'] });
