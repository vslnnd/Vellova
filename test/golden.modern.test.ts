import { describe, it } from 'vitest';
import { expectParity, golden } from './golden-helpers';

// The app runs pdf.js's browser build in WebView2; it must agree with the 1.4.6 reference too.
describe('parity with Nomina 1.4.6 (browser build, as in the app)', () => {
  it.each(Object.keys(golden))('%s', (file) => expectParity('modern', file));
});
