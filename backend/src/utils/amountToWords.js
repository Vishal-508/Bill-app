/**
 * Convert number to Indian English words (Rupees format).
 * Used for legal invoice "Amount in Words" field.
 *
 * Examples:
 *   123.45  -> "One Hundred Twenty Three Rupees and Forty Five Paise Only"
 *   100000  -> "One Lakh Rupees Only"
 *   1234567 -> "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees Only"
 */

const ones = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];

const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigit(n) {
  if (n < 20) return ones[n];
  return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
}

function threeDigit(n) {
  const hundred = Math.floor(n / 100);
  const remainder = n % 100;
  let result = '';

  if (hundred > 0) result += ones[hundred] + ' Hundred';
  if (remainder > 0) {
    if (hundred > 0) result += ' ';
    result += twoDigit(remainder);
  }

  return result;
}

function indianNumberToWords(num) {
  if (num === 0) return 'Zero';

  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const hundred = num % 1000;

  let result = '';

  if (crore > 0) {
    result += (crore > 99 ? threeDigit(crore) : twoDigit(crore)) + ' Crore';
  }
  if (lakh > 0) {
    if (result) result += ' ';
    result += twoDigit(lakh) + ' Lakh';
  }
  if (thousand > 0) {
    if (result) result += ' ';
    result += twoDigit(thousand) + ' Thousand';
  }
  if (hundred > 0) {
    if (result) result += ' ';
    result += threeDigit(hundred);
  }

  return result;
}

exports.amountToWords = (amount) => {
  if (amount === null || amount === undefined || isNaN(amount)) return '';

  const rounded = Math.round(amount * 100) / 100;
  const rupees = Math.floor(rounded);
  const paise = Math.round((rounded - rupees) * 100);

  let words = '';
  if (rupees > 0) {
    words = indianNumberToWords(rupees) + ' Rupees';
  }
  if (paise > 0) {
    if (rupees > 0) words += ' and ';
    words += indianNumberToWords(paise) + ' Paise';
  }
  if (!words) words = 'Zero Rupees';

  return words + ' Only';
};
