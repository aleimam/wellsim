// M.El-Ashry head-gradient correction factor (BHP!D17 / gas-lift H17):
// empirical GOR/WC correction applied to the hydrostatic term of the
// modified-Griffith oil correlation. Piecewise in GOR with a 5000 cap.

const WC = (wc) =>
  7.27117418395078e-6 * wc ** 2 - 0.00119359442121592 * wc + 1.00062545755112;

export function ashryHeadFactor(gorScfStb, wcPct) {
  const w = WC(wcPct);
  let g;
  if (gorScfStb <= 400) {
    g = -6.5998710501415e-7 * gorScfStb ** 2 + 0.000356896044844869 * gorScfStb + 1.02495053371617;
  } else if (gorScfStb <= 5000) {
    g = 1.979148403399e-8 * gorScfStb ** 2 - 0.000161983768691971 * gorScfStb + 1.09560264752243;
  } else {
    g = 1.979148403399e-8 * 5000 ** 2 - 0.000161983768691971 * 5000 + 1.09560264752243;
  }
  return (g * w) ** 0.82;
}
