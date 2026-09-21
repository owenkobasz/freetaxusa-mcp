import { describe, it, expect } from 'vitest';
import { evaluateGuard, isPaymentField, isDangerousButton } from '../../src/security/guards.js';

describe('evaluateGuard', () => {
  it.each(['File Your Return', 'E-File Now', 'Payment Method', 'Checkout', 'Billing Information', 'Order Summary', 'Sign and File', 'Unlock more benefits', 'Cart Summary'])(
    'refuses "%s"',
    heading => {
      expect(evaluateGuard('FreeTaxUSA', heading).refused).toBe(true);
    },
  );

  it.each(['Estimated Tax Payments', 'W-2 Information', 'Profile', 'Filing Status', 'Personal Information', 'Files'])(
    'allows "%s"',
    heading => {
      expect(evaluateGuard('FreeTaxUSA', heading).refused).toBe(false);
    },
  );

  it('checks the document title too', () => {
    expect(evaluateGuard('Checkout - FreeTaxUSA', '').refused).toBe(true);
  });

  it('prefers the heading as the reported title', () => {
    expect(evaluateGuard('Doc Title', 'Heading').title).toBe('Heading');
  });
});

describe('isPaymentField', () => {
  it.each(['Card Number', 'CVV', 'CVC', 'Security Code', 'Name on card'])('refuses "%s"', label => {
    expect(isPaymentField(label)).toBe(true);
  });

  it.each(['Routing Number', 'Account Number', 'License Expiration Date', 'Cardinal Street'])('allows "%s"', label => {
    expect(isPaymentField(label)).toBe(false);
  });
});

describe('isDangerousButton', () => {
  it.each(['File My Return', 'E-File', 'Submit', 'Pay Now', 'Upgrade to Deluxe', 'Order', 'Buy State', 'Add for $19.99', 'Add to cart', 'Cart Summary'])('refuses "%s"', name => {
    expect(isDangerousButton(name)).toBe(true);
  });

  it.each(['Edit', 'Add a W-2', 'Profile Settings', 'Back', 'Delete', 'Save and Continue'])('allows "%s"', name => {
    expect(isDangerousButton(name)).toBe(false);
  });
});
