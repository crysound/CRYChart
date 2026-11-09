// Dedicated visible-Chrome entry for the relative-direction candidate. It also
// saves old/new raster differences and actual GPU offsets versus a Float64 oracle.
if (!process.argv.includes('--relative')) process.argv.push('--relative')
await import('./test-line-offsets-visible.mjs')
