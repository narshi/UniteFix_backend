/**
 * Rupees in words, Indian numbering (lakh, crore) — the way an Indian tax
 * invoice states its total: "Rupees Nine Thousand Five Hundred Fifty Eight
 * and Paise Fifty Only".
 */

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
    'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
    if (n < 20) return ONES[n];
    return `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
}

function threeDigits(n: number): string {
    const h = Math.floor(n / 100), r = n % 100;
    return [h ? `${ONES[h]} Hundred` : '', r ? twoDigits(r) : ''].filter(Boolean).join(' ');
}

function indianWords(n: number): string {
    if (n === 0) return 'Zero';
    const crore = Math.floor(n / 1_00_00_000);
    const lakh = Math.floor((n % 1_00_00_000) / 1_00_000);
    const thousand = Math.floor((n % 1_00_000) / 1000);
    const rest = n % 1000;
    return [
        crore ? `${indianWords(crore)} Crore` : '',
        lakh ? `${twoDigits(lakh)} Lakh` : '',
        thousand ? `${twoDigits(thousand)} Thousand` : '',
        rest ? threeDigits(rest) : '',
    ].filter(Boolean).join(' ');
}

export function rupeesInWords(paise: number): string {
    const sign = paise < 0 ? 'Minus ' : '';
    const abs = Math.abs(Math.round(paise));
    const rupees = Math.floor(abs / 100), p = abs % 100;
    return `${sign}Rupees ${indianWords(rupees)}${p ? ` and Paise ${twoDigits(p)}` : ''} Only`;
}
