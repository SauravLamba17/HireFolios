// Money is stored as whole rupees per year and shown as LPA (lakh per annum): 350000 → "3.5 LPA".
export const lpaToRupees = (lpa: number) => Math.round(lpa * 100_000);
export const rupeesToLpa = (rupees: number) => Math.round(rupees / 1_000) / 100; // 2 decimals
export const formatLpa = (rupees: number | null) => (rupees === null ? null : `${rupeesToLpa(rupees)} LPA`);
