// The vendored login library must be byte-for-byte what icelander.net published.
import { checkVendored } from '../vendor/icelander-auth/check.mjs';
console.log(`  ✓ vendor/icelander-auth ${checkVendored()} is unedited`);
