/** Sending allows 30 requests a minute, so one step may name at most 30 numbers. */
export const MAX_RECIPIENTS = 30;

/**
 * The numbers to text, from the `to` input: one number, or several separated by commas, semicolons or new lines.
 * Each number appears once, in the order given.
 */
export function parseRecipients(value) {
  const numbers = [];
  for (const part of String(value ?? '').split(/[,;\r\n]+/)) {
    const number = part.trim();
    if (number && !numbers.includes(number)) numbers.push(number);
  }
  return numbers;
}

/** "…0123": enough to tell numbers apart in a public log. */
export function maskNumber(number) {
  const digits = String(number).replace(/\D/g, '');
  return digits.length > 4 ? `…${digits.slice(-4)}` : '…';
}
