/**
 * The augmented one-sided compensation curve F~_M from Otter (eprint 2026/1877, eq. 12).
 *
 * The two-sided mechanism is symmetric under X <-> Y, F <-> H, sigma0 <-> rho0.
 * For constant product, H(x) = -F^{-1}(-x) = y0 - k/(x0+x), which is exactly F with
 * the reserves swapped. So we implement ONE curve, parameterised by
 *   out = the reserve of the token the dominant side receives   (x0 in the sell-Y case)
 *   inp = the reserve of the token the dominant side supplies   (y0 in the sell-Y case)
 * and get the sell-X-dominant case for free by passing (y0, x0).
 */
export class AugmentedCurve {
  readonly out: number;
  readonly inp: number;
  readonly k: number;
  readonly sigma0: number;
  /** M = crossing length: the first M units of dominant-side input clear at spot. */
  readonly M: number;

  constructor(out: number, inp: number, M: number) {
    if (!(out > 0 && inp > 0)) throw new Error("reserves must be positive");
    if (!(M >= 0)) throw new Error("M must be nonnegative");
    this.out = out;
    this.inp = inp;
    this.k = out * inp;
    this.sigma0 = out / inp;
    this.M = M;
  }

  /** F~(y): total output token available for y units of input sold. */
  F(y: number): number {
    if (y <= this.M) return this.sigma0 * y;
    const z = y - this.M;
    return this.sigma0 * this.M + (this.out - this.k / (this.inp + z));
  }

  /** F~'(y): marginal price, nonincreasing. */
  Fprime(y: number): number {
    if (y < this.M) return this.sigma0;
    const d = this.inp + (y - this.M);
    return this.k / (d * d);
  }

  /**
   * K(t) = sup{ y >= 0 : F~'(y) >= t }, the inverse marginal.
   * Defined for 0 < t <= sigma0, where it is >= M and strictly decreasing.
   */
  K(t: number): number {
    if (t <= 0) return Infinity;
    if (t > this.sigma0) return 0;
    return this.M - this.inp + Math.sqrt(this.k / t);
  }

  /** Antiderivative of K: IK'(t) = K(t). Used for the layer-cake pivots. */
  IK(t: number): number {
    if (t <= 0) return -Infinity;
    return (this.M - this.inp) * t + 2 * Math.sqrt(this.k) * Math.sqrt(t);
  }

  /**
   * Inverse of K restricted to (0, sigma0]: the t at which K(t) = target.
   * Returns +Infinity if K(t) >= target for every t (i.e. target is below the floor M - inp).
   */
  Kinv(target: number): number {
    const base = target - this.M + this.inp;
    if (base <= 0) return Infinity;
    return this.k / (base * base);
  }
}
